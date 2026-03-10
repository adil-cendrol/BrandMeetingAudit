from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any

from openai import OpenAI

from .document_parser import process_uploaded_files

WEIGHTS = {
    "evidenceCompleteness": 0.4,
    "strategicAlignment": 0.2,
    "riskSensitivity": 0.25,
    "governanceHygiene": 0.15,
}

SYSTEM_PROMPT = """
You are the BoardPack AI Governance Engine. Return a strict JSON object only.
Rules:
1) Every decision, action, insight, and gap must reference evidence IDs from evidencePool.
2) No score or insight without evidence.
3) Summary statements max 3 sentences, professional and objective.
4) Strict mode: for any item labeled Approval/Decision, if either financial risk analysis or legal confirmation is missing, overall score cannot exceed 70.
5) Gap checks:
- Blindspot Check: if capex exceeds threshold or FX exposure exists and stress/sensitivity analysis is missing => Missing financial stress test.
- ISO 37000 Alignment Check: ESG/operations with weak Principle 6 (social responsibility) or Principle 10 (risk governance) signals => ISO governance alignment gap.
- Decision Purpose Check: decision request but options/recommendation unclear => Vague recommendation.
Weights:
- Evidence Completeness 40%
- Strategic Alignment 20%
- Risk Sensitivity 25%
- Governance Hygiene 15%
Thresholds:
- 90-100 green Decision Ready
- 70-89 amber Informational gap
- below 70 red Governance risk detected
""".strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def as_id(prefix: str, index: int) -> str:
    return f"{prefix}{index + 1:03d}"


def clamp_score(value: float) -> int:
    return max(0, min(100, round(value)))


def apply_strict_mode_adjustment(score: int, gap_check: dict[str, Any]) -> int:
    """
    Replace hard cap behavior with a configurable penalty.
    Default penalty is 15 points when approval exists but risk/legal evidence gate is not satisfied.
    """
    needs_penalty = gap_check["hasApproval"] and (not gap_check["hasSensitivity"] or not gap_check["hasLegal"])
    if not needs_penalty:
        return score

    # If enabled, enforce strict rubric cap for Approval items.
    strict_cap_enabled = os.getenv("STRICT_MODE_HARD_CAP", "false").strip().lower() == "true"
    if strict_cap_enabled:
        return min(score, 70)

    penalty = int(os.getenv("STRICT_MODE_PENALTY", "15"))
    return clamp_score(score - max(0, penalty))


def split_sentences(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"(?<=[.!?])\s+", text or "") if p.strip()]


def enforce_three_sentence_limit(text: str) -> str:
    parts = split_sentences(text)
    if len(parts) <= 3:
        return text
    return " ".join(parts[:3])


def infer_duration(text: str) -> str | None:
    source = text or ""

    patterns = [
        r"\bduration\s*[:\-]?\s*(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\b",
        r"\bmeeting\s+duration\s*[:\-]?\s*(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\b",
        r"\bfor\s+(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, source, re.IGNORECASE)
        if not match:
            continue
        value = match.group(1)
        unit = match.group(2).lower()
        if unit.startswith("hour") or unit.startswith("hr"):
            unit = "hours" if value != "1" else "hour"
        else:
            unit = "minutes" if value != "1" else "minute"
        return f"{value} {unit}"

    time_range = re.search(
        r"\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\s*(?:-|to)\s*(\d{1,2})[:.](\d{2})\s*(am|pm)?\b",
        source,
        re.IGNORECASE,
    )
    if time_range:
        start_h, start_m, start_period, end_h, end_m, end_period = time_range.groups()
        if start_period and not end_period:
            end_period = start_period
        if end_period and not start_period:
            start_period = end_period

        def to_minutes(hour: str, minute: str, period: str | None) -> int:
            h = int(hour)
            m = int(minute)
            if period:
                period = period.lower()
                if period == "pm" and h != 12:
                    h += 12
                if period == "am" and h == 12:
                    h = 0
            return h * 60 + m

        start_total = to_minutes(start_h, start_m, start_period)
        end_total = to_minutes(end_h, end_m, end_period)
        if end_total < start_total:
            end_total += 24 * 60
        diff = end_total - start_total
        if diff > 0:
            hours, minutes = divmod(diff, 60)
            if hours and minutes:
                return f"{hours} hour {minutes} minutes" if hours == 1 else f"{hours} hours {minutes} minutes"
            if hours:
                return f"{hours} hour" if hours == 1 else f"{hours} hours"
            return f"{minutes} minutes"

    return None


def infer_speaker_and_timestamp(line: str) -> dict[str, str]:
    ts_match = re.search(r"(\d{1,2}:\d{2}(?::\d{2})?)", line)
    speaker_match = re.match(r"^([A-Z][A-Za-z .'-]{1,40}):", line)
    return {
        "speaker": speaker_match.group(1).strip() if speaker_match else "Unknown",
        "timestamp": ts_match.group(1) if ts_match else "unknown",
    }


def build_evidence_pool(text: str) -> list[dict[str, Any]]:
    lines = []
    for line in (text or "").splitlines():
        clean = line.strip()
        if not clean:
            continue
        if clean.startswith("--- Document:"):
            continue
        if len(clean) <= 24:
            continue
        lines.append(clean)

    selected = lines[:24]
    results = []
    for idx, line in enumerate(selected):
        meta = infer_speaker_and_timestamp(line)
        results.append(
            {
                "id": as_id("E", idx),
                "speaker": meta["speaker"],
                "timestamp": meta["timestamp"],
                "excerpt": line[:280],
            }
        )
    return results


def find_evidence_id(evidence_pool: list[dict[str, Any]], pattern: str, fallback_index: int = 0) -> str | None:
    regex = re.compile(pattern, re.IGNORECASE)
    for item in evidence_pool:
        if regex.search(item.get("excerpt", "")):
            return item.get("id")
    if 0 <= fallback_index < len(evidence_pool):
        return evidence_pool[fallback_index].get("id")
    return None


def _normalise_action_text(text: str) -> str:
    cleaned = re.sub(r"^\s*(action|action item|follow[- ]up|next steps?)\s*[:\-]\s*", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -:\t")
    return cleaned[:220]


def _extract_due_value(text: str) -> str:
    patterns = [
        r"\bdue\s+(by\s+)?([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?)\b",
        r"\bby\s+([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?)\b",
        r"\bwithin\s+(\d+\s+(?:day|days|week|weeks|month|months))\b",
        r"\bin\s+(\d+\s+(?:day|days|week|weeks|month|months))\b",
        r"\b(\d+\s+(?:day|days|week|weeks|month|months))\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        value = next((group for group in match.groups()[::-1] if group), None)
        if value:
            return value.strip()
    return "TBD"


def _extract_owner_value(text: str, default_owner: str = "Unassigned") -> str:
    patterns = [
        r"\bowner\s*[:\-]\s*([A-Z][A-Za-z&/ ,.-]{2,60})",
        r"\bassigned to\s+([A-Z][A-Za-z&/ ,.-]{2,60})",
        r"\b([A-Z][A-Za-z&/ ,.-]{2,60})\s+to\s+[a-z]",
        r"^([A-Z][A-Za-z&/ ,.-]{2,60})\s*[:\-]\s*",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        owner = re.sub(r"\s+", " ", match.group(1)).strip(" ,.-")
        if owner:
            return owner[:80]
    return default_owner


def extract_action_items(text: str, evidence_pool: list[dict[str, Any]]) -> list[dict[str, Any]]:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    candidates: list[str] = []
    keyword_re = re.compile(
        r"\b(action item|follow[- ]up|next step|owner|deadline|due date|assigned to|will prepare|will circulate|to circulate|to prepare|to provide|to submit|to review|to update)\b",
        re.IGNORECASE,
    )

    for line in lines:
        if keyword_re.search(line):
            candidates.append(line)

    sentence_candidates = []
    for sentence in split_sentences(text):
        if keyword_re.search(sentence):
            sentence_candidates.append(sentence)

    seen: set[str] = set()
    action_items: list[dict[str, Any]] = []
    for raw in candidates + sentence_candidates:
        action_text = _normalise_action_text(raw)
        if len(action_text) < 18:
            continue
        dedupe_key = action_text.lower()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        evidence_ref = find_evidence_id(evidence_pool, re.escape(raw[:80]), 0)
        if not evidence_ref:
            evidence_ref = find_evidence_id(evidence_pool, r"action|follow up|owner|deadline|due", 0)

        action_items.append(
            {
                "id": as_id("A", len(action_items)),
                "action": enforce_three_sentence_limit(action_text),
                "owner": _extract_owner_value(raw),
                "due": _extract_due_value(raw),
                "evidenceRef": evidence_ref,
            }
        )
        if len(action_items) >= 6:
            break

    return [item for item in action_items if item.get("evidenceRef")]


def compute_category_scores(text: str, evidence_pool: list[dict[str, Any]]) -> dict[str, int]:
    lower = (text or "").lower()
    evidence_completeness = clamp_score(35 + len(evidence_pool) * 2.4)

    strategic_signals = ["strategy", "roadmap", "objective", "kpi", "target"]
    risk_signals = ["risk", "sensitivity", "stress test", "scenario", "downside", "legal"]
    hygiene_signals = ["decision", "approval", "action item", "owner", "due date", "compliance", "ethics"]

    strategic_alignment = clamp_score(45 + sum(7 for token in strategic_signals if token in lower))
    risk_sensitivity = clamp_score(40 + sum(8 for token in risk_signals if token in lower))
    governance_hygiene = clamp_score(42 + sum(7 for token in hygiene_signals if token in lower))

    return {
        "evidenceCompleteness": evidence_completeness,
        "strategicAlignment": strategic_alignment,
        "riskSensitivity": risk_sensitivity,
        "governanceHygiene": governance_hygiene,
    }


def compute_weighted_score(category_scores: dict[str, int]) -> int:
    return clamp_score(
        category_scores["evidenceCompleteness"] * WEIGHTS["evidenceCompleteness"]
        + category_scores["strategicAlignment"] * WEIGHTS["strategicAlignment"]
        + category_scores["riskSensitivity"] * WEIGHTS["riskSensitivity"]
        + category_scores["governanceHygiene"] * WEIGHTS["governanceHygiene"]
    )


def to_risk_indicator(score: int) -> dict[str, str]:
    if score >= 90:
        return {"level": "green", "label": "Decision Ready"}
    if score >= 70:
        return {"level": "amber", "label": "Minor Gaps Present"}
    return {"level": "red", "label": "Governance Risk Detected"}


def build_minutes(text: str, evidence_pool: list[dict[str, Any]]) -> dict[str, Any]:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    participants = []
    for line in lines:
        match = re.match(r"^([A-Z][A-Za-z .'-]{1,40}):", line)
        if match:
            participants.append(match.group(1))
    unique_participants = list(dict.fromkeys(participants))

    attendees = [f"{name} (Board Member)" for name in unique_participants[:7]]
    apologies = unique_participants[7:9] if len(unique_participants) > 7 else ["No formal apologies captured"]

    action_items = extract_action_items(text, evidence_pool)

    return {
        "attendees": attendees,
        "apologies": apologies,
        "keyDecisions": [],
        "actionItems": action_items,
        "unresolvedMatters": [],
    }


def build_insights(text: str, evidence_pool: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return []


def build_engagement(text: str) -> dict[str, Any]:
    return {"radarData": [], "signals": []}


def detect_gaps(text: str, evidence_pool: list[dict[str, Any]]) -> dict[str, Any]:
    lower = (text or "").lower()
    gaps: list[dict[str, Any]] = []

    has_sensitivity = bool(re.search(r"sensitivity|stress test|scenario analysis|risk-adjusted", lower))
    has_legal = bool(re.search(r"legal counsel|general counsel|legal confirmation|regulatory sign[- ]off", lower))
    has_approval = bool(re.search(r"approval|approve|approved|resolution", lower))

    capex_threshold_m = float(os.getenv("CAPEX_THRESHOLD_MUSD", "10"))

    def capex_amount_m() -> float | None:
        capex_match = re.search(r"capex[^.\n]{0,50}(\d[\d,]*(?:\.\d+)?)\s?(m|million|bn|billion)?", lower)
        if not capex_match:
            return None
        raw_value = float(capex_match.group(1).replace(",", ""))
        unit = (capex_match.group(2) or "").lower()
        if unit in {"bn", "billion"}:
            return raw_value * 1000
        return raw_value

    capex_m = capex_amount_m()
    has_fx_exposure = bool(re.search(r"\bfx\b|foreign exchange|currency volatility|exchange rate", lower))
    capex_material = capex_m is not None and capex_m >= capex_threshold_m

    if (capex_material or has_fx_exposure) and has_approval and not has_sensitivity:
        ref = find_evidence_id(evidence_pool, r"capex|capital expenditure", 0)
        gaps.append(
            {
                "id": "GAP001",
                "rule": "Blindspot Check",
                "flag": "Missing financial stress test",
                "description": "Material capex/FX exposure appears present but stress or sensitivity analysis is not evidenced.",
                "severity": "high",
                "evidenceRefs": [ref] if ref else [],
                "remediation": "Management to attach Appendix with 3-year P&L forecast and downside/base-case sensitivity scenarios.",
            }
        )

    has_esg_or_ops = bool(re.search(r"esg|operations|operational", lower))
    has_ethics_or_compliance = bool(re.search(r"ethic|compliance|code of conduct|iso 37000|governance policy", lower))
    if has_esg_or_ops and not has_ethics_or_compliance:
        ref = find_evidence_id(evidence_pool, r"esg|operations|operational", 1)
        gaps.append(
            {
                "id": "GAP002",
                "rule": "ISO 37000 Alignment Check",
                "flag": "Incomplete ISO 37000 alignment",
                "description": "ESG/operations content lacks explicit Principle 6 (social responsibility) or Principle 10 (risk governance) references.",
                "severity": "medium",
                "evidenceRefs": [ref] if ref else [],
                "remediation": "Rewrite section to include explicit ISO 37000 Principle 6/10 governance and compliance framing.",
            }
        )

    has_decision_request = bool(re.search(r"decision requested|approval requested|for decision|board decision", lower))
    has_clear_options = bool(re.search(r"option 1|option 2|alternatives|recommended option|trade-offs", lower))
    if has_decision_request and not has_clear_options:
        ref = find_evidence_id(evidence_pool, r"decision requested|approval requested|for decision", 2)
        gaps.append(
            {
                "id": "GAP003",
                "rule": "Decision Purpose Check",
                "flag": "Vague recommendation",
                "description": "Decision request is present, but options and trade-offs are not clearly structured.",
                "severity": "medium",
                "evidenceRefs": [ref] if ref else [],
                "remediation": "Rewrite decision paper to include explicit options, trade-offs, and recommendation rationale.",
            }
        )

    if has_approval and (not has_sensitivity or not has_legal):
        ref = find_evidence_id(evidence_pool, r"approval|approve|resolution", 3)
        gaps.append(
            {
                "id": "GAP004",
                "rule": "Strict Mode Check",
                "flag": "Approval evidence gate not satisfied",
                "description": "Approval-linked discussion lacks complete financial risk analysis and/or legal confirmation.",
                "severity": "high",
                "evidenceRefs": [ref] if ref else [],
                "remediation": "Provide risk-adjusted financial analysis and legal counsel confirmation before final approval.",
            }
        )

    return {
        "gaps": gaps,
        "hasApproval": has_approval,
        "hasSensitivity": has_sensitivity,
        "hasLegal": has_legal,
    }


def validate_evidence_references(results: dict[str, Any]) -> None:
    evidence_ids = {item.get("id") for item in results.get("evidencePool", [])}
    if not evidence_ids:
        raise ValueError("Evidence pool is empty. Analysis cannot produce governance outputs without evidence.")

    def has_ref(ref: str | None) -> bool:
        return bool(ref and ref in evidence_ids)

    decisions_ok = all(has_ref(item.get("evidenceRef")) for item in results.get("minutes", {}).get("keyDecisions", []))
    actions_ok = all(has_ref(item.get("evidenceRef")) for item in results.get("minutes", {}).get("actionItems", []))
    unresolved_ok = all(has_ref(item.get("evidenceRef")) for item in results.get("minutes", {}).get("unresolvedMatters", []))
    insights_ok = all(
        has_ref(ins.get("evidenceRef"))
        for cat in results.get("insights", [])
        for ins in cat.get("insights", [])
    )
    gaps_ok = all(
        has_ref(ref)
        for gap in results.get("gaps", [])
        for ref in gap.get("evidenceRefs", [])
    )

    if not (decisions_ok and actions_ok and unresolved_ok and insights_ok and gaps_ok):
        raise ValueError("Evidence reference validation failed. Some outputs are missing valid evidence IDs.")


def normalise_model_output(assessment_id: str, meeting_name: str, model_output: dict[str, Any], transcript: str) -> dict[str, Any]:
    evidence_pool = model_output.get("evidencePool") if isinstance(model_output.get("evidencePool"), list) else []
    if not evidence_pool:
        evidence_pool = build_evidence_pool(transcript)

    category_scores = model_output.get("categoryScores") or compute_category_scores(transcript, evidence_pool)
    governance_score = model_output.get("governanceScore")
    if isinstance(governance_score, (int, float)):
        governance_score = clamp_score(governance_score)
    else:
        governance_score = compute_weighted_score(category_scores)

    gap_check = detect_gaps(transcript, evidence_pool)
    gaps = model_output.get("gaps") if isinstance(model_output.get("gaps"), list) else gap_check["gaps"]
    governance_score = apply_strict_mode_adjustment(governance_score, gap_check)

    return {
        "id": assessment_id,
        "meetingName": meeting_name,
        "duration": model_output.get("duration") or infer_duration(transcript),
        "participants": model_output.get("participants") if isinstance(model_output.get("participants"), list) else [],
        "categoryScores": category_scores,
        "governanceScore": governance_score,
        "riskIndicator": model_output.get("riskIndicator") or to_risk_indicator(governance_score),
        "gaps": gaps,
        "minutes": model_output.get("minutes") if isinstance(model_output.get("minutes"), dict) else build_minutes(transcript, evidence_pool),
        "insights": model_output.get("insights") if isinstance(model_output.get("insights"), list) else build_insights(transcript, evidence_pool),
        "engagement": model_output.get("engagement") if isinstance(model_output.get("engagement"), dict) else build_engagement(transcript),
        "evidencePool": evidence_pool,
        "weights": WEIGHTS,
        "completedAt": _now_iso(),
    }


async def run_governance_analysis(assessment_id: str, meeting_name: str, files: list[dict]) -> dict[str, Any]:
    transcript_text = await process_uploaded_files(files)
    if not transcript_text.strip():
        raise ValueError("No valid text could be extracted from the uploaded files.")

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is required. Fallback analysis is disabled.")

    client = OpenAI(api_key=api_key)
    try:
        response = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            response_format={"type": "json_object"},
            temperature=0,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f'Analyze this board transcript for "{meeting_name}" and return only JSON.\n\n{transcript_text[:180000]}',
                },
            ],
        )

        content = response.choices[0].message.content if response.choices else "{}"
        parsed = json.loads(content or "{}")
        normalised = normalise_model_output(assessment_id, meeting_name, parsed, transcript_text)
        validate_evidence_references(normalised)
        return normalised
    except Exception as exc:
        raise ValueError(f"Governance analysis failed: {exc}") from exc
