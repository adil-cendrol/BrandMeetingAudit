# Python Backend (FastAPI)

This replaces the Node backend API with Python while keeping the same routes.

## Run

```bash
cd python_backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload
```

## API routes

- `GET /api/health`
- `GET /api/assessments`
- `GET /api/assessments/{id}`
- `POST /api/assessments` (multipart `meetingName`, optional `meetingDate`, `files[]`)
- `POST /api/assessments/{id}/start`
- `GET /api/assessments/{id}/status`
- `DELETE /api/assessments/{id}`
- `POST /api/assessments/{id}/export`

## Extraction provider env

- Uses only open-source Python `unstructured` for `.pdf`, `.docx`, `.txt`.
- `UNSTRUCTURED_STRATEGY=hi_res`
- `OPENAI_API_KEY=`
- `OPENAI_MODEL=gpt-4o-mini`

## Notes

- Data store is in-memory (same behavior as current Node code).
- Uploads are saved to `python_backend/uploads`.
- If `OPENAI_API_KEY` is missing, analysis fails fast (no scoring fallback).
