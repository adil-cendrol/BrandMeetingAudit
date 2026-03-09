from __future__ import annotations

import asyncio
import os
from pathlib import Path

from openai import OpenAI
from pypdf import PdfReader
from unstructured.partition.auto import partition

ALLOWED_EXTS = {".pdf", ".docx", ".txt", ".mp3", ".mp4"}


def _openai_client() -> OpenAI | None:
    api_key = os.getenv("OPENAI_API_KEY")
    return OpenAI(api_key=api_key) if api_key else None


def _extract_with_unstructured(file_path: str) -> str:
    strategy = os.getenv("UNSTRUCTURED_STRATEGY", "hi_res")
    elements = partition(filename=file_path, strategy=strategy)
    text = "\n".join((getattr(item, "text", "") or "").strip() for item in elements).strip()
    if not text:
        raise ValueError("Unstructured returned empty text.")
    return text


def _extract_pdf_fast_no_ocr(file_path: str) -> str:
    reader = PdfReader(file_path)
    chunks: list[str] = []
    for page in reader.pages:
        chunks.append((page.extract_text() or "").strip())
    text = "\n".join(x for x in chunks if x).strip()
    if not text:
        raise ValueError("Fast PDF text extraction returned empty text.")
    return text


def _ensure_pdf_text_quality(text: str, filename: str) -> str:
    min_chars = int(os.getenv("PDF_MIN_TEXT_CHARS", "300"))
    if len((text or "").strip()) < min_chars:
        raise ValueError(
            f'PDF text extraction low quality for {filename}. '
            "Please upload a searchable PDF (not scanned image PDF)."
        )
    return text


async def _transcribe_audio(file_path: str) -> str:
    client = _openai_client()
    if not client:
        raise ValueError("OPENAI_API_KEY not configured for audio transcription")

    def _run() -> str:
        with open(file_path, "rb") as f:
            result = client.audio.transcriptions.create(model="whisper-1", file=f)
        return (getattr(result, "text", "") or "").strip()

    text = await asyncio.to_thread(_run)
    if not text:
        raise ValueError("Audio transcription returned empty text.")
    return text


async def extract_text_from_file(file_path: str, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise ValueError(f"Unsupported file type: {ext}. Allowed: PDF, DOCX, TXT, MP3, MP4")

    if ext == ".pdf":
        # First try a fast non-OCR extractor to avoid Tesseract dependency for digital PDFs.
        try:
            fast_text = await asyncio.to_thread(_extract_pdf_fast_no_ocr, file_path)
            if fast_text:
                return _ensure_pdf_text_quality(fast_text, filename)
        except Exception:
            pass

        # Fall back to Unstructured (may require OCR deps for scanned PDFs).
        extracted = await asyncio.to_thread(_extract_with_unstructured, file_path)
        return _ensure_pdf_text_quality(extracted, filename)

    if ext in {".docx", ".txt"}:
        return await asyncio.to_thread(_extract_with_unstructured, file_path)

    if ext in {".mp3", ".mp4"}:
        return await _transcribe_audio(file_path)

    raise ValueError(f"Unsupported file type: {ext}")


async def process_uploaded_files(files: list[dict]) -> str:
    combined_text = ""
    for file in files:
        original_name = file.get("originalname") or file.get("name") or "unknown-file"
        file_path = file.get("path")
        if not file_path:
            raise ValueError(f"Missing path for {original_name}")
        try:
            text = await extract_text_from_file(file_path, original_name)
        except Exception as exc:
            raise ValueError(f"Failed to parse {original_name}: {exc}") from exc

        combined_text += f"\n\n--- Document: {original_name} ---\n{text}\n"

    return combined_text
