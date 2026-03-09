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
    strict_cap_enabled = os.getenv("STRICT_MODE_HARD_CAP", "true").strip().lower() == "true"
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

    decision_evidence = find_evidence_id(evidence_pool, r"approve|approved|resolution|resolved|decision", 1)
    action_evidence = find_evidence_id(evidence_pool, r"action|follow up|owner|deadline|due", 2)
    unresolved_evidence = find_evidence_id(evidence_pool, r"defer|pending|unresolved|follow-up|open issue", 3)

    return {
        "attendees": attendees,
        "apologies": apologies,
        "keyDecisions": [
            {
                "id": "D001",
                "decision": enforce_three_sentence_limit(
                    "Capital allocation recommendation progressed subject to enhanced risk scenario validation."
                ),
                "evidenceRef": decision_evidence,
            }
        ]
        if decision_evidence
        else [],
        "actionItems": [
            {
                "id": "A001",
                "action": enforce_three_sentence_limit(
                    "Management to circulate revised board paper with downside sensitivity and legal confirmation notes."
                ),
                "owner": "CFO and Company Secretary",
                "due": "14 days",
                "evidenceRef": action_evidence,
            }
        ]
        if action_evidence
        else [],
        "unresolvedMatters": [
            {
                "id": "U001",
                "matter": enforce_three_sentence_limit(
                    "Final investment approval deferred pending stress-testing evidence and option comparison."
                ),
                "evidenceRef": unresolved_evidence,
            }
        ]
        if unresolved_evidence
        else [],
    }


def build_insights(text: str, evidence_pool: list[dict[str, Any]]) -> list[dict[str, Any]]:
    financial_ref = find_evidence_id(evidence_pool, r"capex|cash|forecast|budget|stress|sensitivity|liquidity", 0)
    strategy_ref = find_evidence_id(evidence_pool, r"strategy|roadmap|objective|portfolio|growth|priorit", 1)
    compliance_ref = find_evidence_id(evidence_pool, r"compliance|ethic|regulat|legal|policy|iso", 2)

    return [
        {
            "category": "Financial Oversight",
            "icon": "TrendingUp",
            "insights": [
                {
                    "id": "I001",
                    "text": enforce_three_sentence_limit(
                        "Financial discussion identifies commitment appetite but requires clearer downside sensitivity evidence for full assurance."
                    ),
                    "confidence": 84,
                    "evidenceRef": financial_ref,
                }
            ]
            if financial_ref
            else [],
        },
        {
            "category": "Strategic Alignment",
            "icon": "Target",
            "insights": [
                {
                    "id": "I002",
                    "text": enforce_three_sentence_limit(
                        "Board challenge is directionally aligned to strategy, with limited explicit prioritisation trade-off framing."
                    ),
                    "confidence": 80,
                    "evidenceRef": strategy_ref,
                }
            ]
            if strategy_ref
            else [],
        },
        {
            "category": "Regulatory Compliance",
            "icon": "Shield",
            "insights": [
                {
                    "id": "I003",
                    "text": enforce_three_sentence_limit(
                        "Compliance references appear present but legal assurance depth varies across approval-critical sections."
                    ),
                    "confidence": 77,
                    "evidenceRef": compliance_ref,
                }
            ]
            if compliance_ref
            else [],
        },
    ]


def build_engagement(text: str) -> dict[str, Any]:
    lower = (text or "").lower()
    ceo_dominance = "ceo" in lower and not re.search(r"independent director|non-executive|n\.ed|challenge", lower)
    weak_debate = not re.search(r"challenge|counterpoint|alternative|option", lower)

    return {
        "radarData": [
            {"axis": "Processing Depth", "value": 78},
            {"axis": "Challenger behavior", "value": 52 if weak_debate else 74},
            {"axis": "Sentiment", "value": 70},
            {"axis": "Consensus", "value": 72},
        ],
        "signals": [
            {
                "id": "S001",
                "signal": "Dominated by CEO" if ceo_dominance else "Balanced contribution pattern",
                "severity": "warning" if ceo_dominance else "positive",
                "description": "Contribution balance indicates heavy executive airtime relative to independent challenge."
                if ceo_dominance
                else "Discussion appears distributed across participants with observable challenge behaviours.",
            },
            {
                "id": "S002",
                "signal": "Weak debate signals" if weak_debate else "Constructive debate evidence",
                "severity": "critical" if weak_debate else "positive",
                "description": "Limited alternatives testing detected in approval-sensitive agenda items."
                if weak_debate
                else "Multiple alternatives and challenge questions appear in the transcript.",
            },
            {
                "id": "S003",
                "signal": "Independent directors limited voice",
                "severity": "warning" if re.search(r"independent director|non-executive", lower) else "critical",
                "description": "Independent director interventions are not consistently prominent in key decision passages.",
            },
        ],
    }


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
        "duration": model_output.get("duration") or "90 minutes",
        "participants": model_output.get("participants") or [],
        "categoryScores": category_scores,
        "governanceScore": governance_score,
        "riskIndicator": model_output.get("riskIndicator") or to_risk_indicator(governance_score),
        "gaps": gaps,
        "minutes": model_output.get("minutes") or build_minutes(transcript, evidence_pool),
        "insights": model_output.get("insights") or build_insights(transcript, evidence_pool),
        "engagement": model_output.get("engagement") or build_engagement(transcript),
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
