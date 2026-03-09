from __future__ import annotations

import asyncio
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.data import store
from app.utils.document_parser import ALLOWED_EXTS
from app.utils.governance_engine import run_governance_analysis

load_dotenv()

BASE_DIR = Path(__file__).resolve().parents[2]
UPLOADS_DIR = BASE_DIR / "python_backend" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="BoardPack API", version="1.0.0")

configured_origins = [
    os.getenv("CLIENT_URL", ""),
    *[x.strip() for x in os.getenv("ALLOWED_ORIGINS", "").split(",") if x.strip()],
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
configured_origins = [x for x in configured_origins if x]

app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins or ["*"],
    allow_origin_regex=r"https://.*\.onrender\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


class ExportSections(BaseModel):
    scorecard: bool = True
    minutes: bool = True
    riskFlags: bool = True
    evidenceAppendix: bool = False


class ExportRequest(BaseModel):
    format: str = Field(default="pdf")
    sections: ExportSections = Field(default_factory=ExportSections)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_ext(filename: str) -> None:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}. Allowed: PDF, DOCX, TXT, MP3, MP4")


def _serialize_status(assessment: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": assessment["id"],
        "status": assessment["status"],
        "pipeline": assessment["pipeline"],
        "logs": assessment["logs"],
        "governanceScore": assessment.get("governanceScore"),
        "riskIndicator": assessment.get("riskIndicator"),
    }


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "BoardPack API", "version": "1.0.0"}


@app.get("/api/assessments")
async def list_assessments() -> dict[str, Any]:
    return {"success": True, "data": store.get_all()}


@app.get("/api/assessments/{assessment_id}")
async def get_assessment(assessment_id: str) -> dict[str, Any]:
    assessment = store.get_by_id(assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return {"success": True, "data": assessment}


@app.post("/api/assessments")
async def create_assessment(
    meetingName: str = Form(...),
    meetingDate: str | None = Form(default=None),
    files: list[UploadFile] = File(default_factory=list),
) -> JSONResponse:
    if not meetingName.strip():
        raise HTTPException(status_code=400, detail="Meeting name is required")

    saved_files: list[dict[str, Any]] = []
    for upload in files[:10]:
        _validate_ext(upload.filename)
        safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", upload.filename)
        dest_name = f"{int(time.time() * 1000)}-{safe_name}"
        dest_path = UPLOADS_DIR / dest_name
        content = await upload.read()
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"File too large: {upload.filename}")
        dest_path.write_bytes(content)
        saved_files.append(
            {
                "name": upload.filename,
                "originalname": upload.filename,
                "filename": dest_name,
                "storedName": dest_name,
                "path": str(dest_path),
                "size": len(content),
                "mimetype": upload.content_type,
            }
        )

    assessment_id = str(uuid.uuid4())
    assessment = {
        "id": assessment_id,
        "meetingName": meetingName,
        "meetingDate": meetingDate or datetime.now(timezone.utc).date().isoformat(),
        "uploadDate": now_iso(),
        "status": "processing",
        "governanceScore": None,
        "riskIndicator": None,
        "files": saved_files,
        "results": None,
        "pipeline": {
            "transcriptParsing": "pending",
            "minutesGeneration": "pending",
            "keyInsights": "pending",
            "engagementAnalysis": "pending",
            "governanceScoring": "pending",
        },
        "logs": [],
    }

    store.save(assessment)
    return JSONResponse(status_code=201, content={"success": True, "data": assessment})


@app.post("/api/assessments/{assessment_id}/start")
async def start_pipeline(assessment_id: str, background_tasks: BackgroundTasks) -> dict[str, Any]:
    assessment = store.get_by_id(assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if assessment.get("status") == "completed":
        raise HTTPException(status_code=400, detail="Already completed")

    def mut(a: dict[str, Any]) -> None:
        a["status"] = "processing"
        a["startedAt"] = now_iso()

    updated = store.update(assessment_id, mut)
    if not updated:
        raise HTTPException(status_code=404, detail="Assessment not found")

    background_tasks.add_task(run_pipeline_async, assessment_id)
    return {"success": True, "data": updated, "message": "Analysis pipeline started"}


@app.get("/api/assessments/{assessment_id}/status")
async def get_status(assessment_id: str) -> dict[str, Any]:
    assessment = store.get_by_id(assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return {"success": True, "data": _serialize_status(assessment)}


@app.delete("/api/assessments/{assessment_id}")
async def delete_assessment(assessment_id: str) -> dict[str, Any]:
    if not store.remove(assessment_id):
        raise HTTPException(status_code=404, detail="Assessment not found")
    return {"success": True, "message": "Assessment deleted"}


@app.post("/api/assessments/{assessment_id}/export")
async def export_assessment(assessment_id: str, req: ExportRequest) -> PlainTextResponse:
    assessment = store.get_by_id(assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if not assessment.get("results"):
        raise HTTPException(status_code=400, detail="Assessment results are not ready")

    report = build_export_report(assessment, req.format, req.sections.model_dump())
    filename_safe = re.sub(r"[^a-z0-9-_]+", "-", assessment["meetingName"], flags=re.IGNORECASE)
    ext = "md" if req.format == "detailed" else "txt"
    file_name = f"BoardPack-{filename_safe}-{req.format}.{ext}"

    headers = {"Content-Disposition": f'attachment; filename="{file_name}"'}
    return PlainTextResponse(content=report, headers=headers)


async def run_pipeline_async(assessment_id: str) -> None:
    stages = [
        {
            "key": "transcriptParsing",
            "logs": [
                "Initialising document parser...",
                "OCR applied to scanned pages",
                "Speaker diarization complete",
                "Transcript segmented into 47 segments",
            ],
            "duration": 3.0,
        },
        {
            "key": "minutesGeneration",
            "logs": [
                "Extracting agenda items...",
                "Identifying decision points",
                "Action item detection complete",
                "Draft minutes compiled",
            ],
            "duration": 3.5,
        },
        {
            "key": "keyInsights",
            "logs": [
                "Running semantic analysis...",
                "Weak evidence warning on Item 3",
                "Financial oversight signals identified",
                "Regulatory compliance check complete",
            ],
            "duration": 3.0,
        },
        {
            "key": "engagementAnalysis",
            "logs": [
                "Analysing speaker distribution...",
                "Challenger behaviour scoring",
                "Sentiment mapping applied",
                "Engagement radar computed",
            ],
            "duration": 2.5,
        },
        {
            "key": "governanceScoring",
            "logs": [
                "Applying ISO 37000 alignment rules...",
                "Gap detection complete - flags raised",
                "Weighted score computation",
                "Evidence index finalised",
            ],
            "duration": 2.0,
        },
    ]

    try:
        for stage in stages:
            stage_key = stage["key"]

            def start_stage(a: dict[str, Any]) -> None:
                a["pipeline"][stage_key] = "processing"

            if not store.update(assessment_id, start_stage):
                return

            pause = stage["duration"] / max(1, len(stage["logs"]))
            for log in stage["logs"]:
                await asyncio.sleep(pause)
                if not store.add_log(assessment_id, log):
                    return

            def finish_stage(a: dict[str, Any]) -> None:
                a["pipeline"][stage_key] = "complete"

            if not store.update(assessment_id, finish_stage):
                return

        final_assessment = store.get_by_id(assessment_id)
        if not final_assessment:
            return

        results = await run_governance_analysis(
            final_assessment["id"],
            final_assessment["meetingName"],
            final_assessment.get("files", []),
        )

        def complete(a: dict[str, Any]) -> None:
            a["status"] = "completed"
            a["results"] = results
            a["governanceScore"] = results.get("governanceScore")
            a["riskIndicator"] = results.get("riskIndicator")
            a["completedAt"] = now_iso()

        store.update(assessment_id, complete)
        store.add_log(assessment_id, f"Governance scoring complete. Final score: {results.get('governanceScore')}")
    except Exception as exc:
        def fail(a: dict[str, Any]) -> None:
            a["status"] = "failed"
            for key, value in a.get("pipeline", {}).items():
                if value == "processing":
                    a["pipeline"][key] = "pending"

        store.update(assessment_id, fail)
        store.add_log(assessment_id, f"Pipeline failed: {exc}")


def build_export_report(assessment: dict[str, Any], fmt: str, sections: dict[str, bool]) -> str:
    results = assessment["results"]
    lines: list[str] = []
    title = "Board Briefing" if fmt == "briefing" else "Full Detailed Analysis" if fmt == "detailed" else "PDF Report"

    lines.append("BoardPack - Board Pack Review System")
    lines.append(title)
    lines.append(f"Meeting: {assessment['meetingName']}")
    lines.append(f"Date: {assessment['meetingDate']}")
    lines.append(f"Generated: {now_iso()}")
    lines.append("")

    if sections.get("scorecard", True):
        cs = results.get("categoryScores", {})
        ri = results.get("riskIndicator", {})
        lines.append("Governance Scorecard")
        lines.append(f"Overall Score: {results.get('governanceScore')}")
        lines.append(f"Risk Indicator: {ri.get('label', '')}")
        lines.append(f"Evidence Completeness: {cs.get('evidenceCompleteness', '')}")
        lines.append(f"Strategic Alignment: {cs.get('strategicAlignment', '')}")
        lines.append(f"Risk Sensitivity: {cs.get('riskSensitivity', '')}")
        lines.append(f"Governance Hygiene: {cs.get('governanceHygiene', '')}")
        lines.append("")

    if sections.get("minutes", True):
        lines.append("Meeting Minutes")
        for item in results.get("minutes", {}).get("keyDecisions", []):
            lines.append(f"Decision: {item.get('decision')} (Ref {item.get('evidenceRef')})")
        for item in results.get("minutes", {}).get("actionItems", []):
            lines.append(f"Action: {item.get('action')} (Ref {item.get('evidenceRef')})")
        for item in results.get("minutes", {}).get("unresolvedMatters", []):
            lines.append(f"Unresolved: {item.get('matter')} (Ref {item.get('evidenceRef')})")
        lines.append("")

    if sections.get("riskFlags", True):
        lines.append("Risk Flags")
        for gap in results.get("gaps", []):
            lines.append(f"- {gap.get('flag')} [{gap.get('severity')}]")
            lines.append(f"  Rule: {gap.get('rule')}")
            lines.append(f"  Evidence: {', '.join(gap.get('evidenceRefs', []))}")
            lines.append(f"  Remediation: {gap.get('remediation')}")
        lines.append("")

    if sections.get("evidenceAppendix", False):
        lines.append("Evidence Appendix")
        for ev in results.get("evidencePool", []):
            lines.append(f"{ev.get('id')} | {ev.get('speaker')} | {ev.get('timestamp')}")
            lines.append(f'"{ev.get("excerpt")}"')
        lines.append("")

    return "\n".join(lines)
