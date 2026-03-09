from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from threading import Lock

_assessments: dict[str, dict] = {}
_lock = Lock()


def get_all() -> list[dict]:
    with _lock:
        values = [deepcopy(v) for v in _assessments.values()]
    return sorted(values, key=lambda x: x.get("uploadDate", ""), reverse=True)


def get_by_id(assessment_id: str) -> dict | None:
    with _lock:
        value = _assessments.get(assessment_id)
        return deepcopy(value) if value else None


def save(assessment: dict) -> None:
    with _lock:
        _assessments[assessment["id"]] = deepcopy(assessment)


def update(assessment_id: str, mutate_fn) -> dict | None:
    with _lock:
        current = _assessments.get(assessment_id)
        if current is None:
            return None
        mutate_fn(current)
        _assessments[assessment_id] = current
        return deepcopy(current)


def remove(assessment_id: str) -> bool:
    with _lock:
        return _assessments.pop(assessment_id, None) is not None


def add_log(assessment_id: str, message: str) -> dict | None:
    timestamp = datetime.utcnow().isoformat() + "Z"

    def mut(a: dict) -> None:
        a.setdefault("logs", []).append({"timestamp": timestamp, "message": message})

    return update(assessment_id, mut)
