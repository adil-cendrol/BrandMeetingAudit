# BoardPack Engine Workflow and Limitations

## Purpose

This document explains how the current BoardPack POC engine works, how the governance score is produced, what is actually extracted from uploaded documents, and what limitations still exist before production use.

It is written so it can be shared with internal stakeholders, demo audiences, or technical reviewers.

## What the Engine Does

The engine accepts uploaded meeting-related files and produces a governance-oriented analysis. Its current outputs are:

- governance score
- category-wise score breakdown
- gap / risk flags
- evidence references
- duration if explicitly found in transcript text
- action items if explicitly found in transcript text
- model-generated minutes / insights / engagement only when the model returns them

The system is designed to avoid showing invented fallback summaries where data is not actually present.

## Supported Inputs

The engine currently accepts:

- PDF
- DOCX
- TXT
- MP3
- MP4

## End-to-End Workflow

### 1. File Upload

Users upload one or more files through the frontend. The backend stores uploaded files in `python_backend/uploads`.

### 2. Text Extraction

The backend converts files into text:

- PDF:
  - first tries direct text extraction using `pypdf`
  - if that fails, falls back to `unstructured`
- DOCX / TXT:
  - uses `unstructured`
- MP3 / MP4:
  - uses OpenAI transcription

Important:

- PDF extraction only extracts text
- it does not inherently understand meeting structure
- it does not automatically know duration, action items, or governance quality unless those are clearly present in text

### 3. Combined Transcript

All extracted text from all uploaded files is concatenated into a single combined transcript.

This means the current POC treats mixed uploads as one shared body of meeting content.

### 4. Evidence Pool Construction

The backend creates an `evidencePool` from extracted transcript lines.

Each evidence item contains:

- `id`
- `speaker`
- `timestamp`
- `excerpt`

This evidence pool is later used to justify score-related findings, action items, and identified gaps.

### 5. Model Analysis

The combined transcript is sent to the OpenAI model with a structured JSON prompt.

The model is asked to return:

- category scores
- governance score
- participants
- duration
- minutes
- insights
- engagement
- evidence pool
- risk indicator
- gaps

If the model does not return some of these fields, the backend now avoids inventing misleading placeholder content for most narrative sections.

### 6. Backend Rule Validation and Scoring

After the model response is received, the backend applies its own logic:

- builds evidence if needed
- computes category scores if not provided
- computes the governance score if not provided
- detects rule-based governance gaps
- applies strict mode adjustments
- validates evidence references

This means the final score is not purely model-generated. It is a hybrid of model output and backend logic.

## How the Governance Score Works

The score is currently based on four weighted categories:

- Evidence Completeness: 40%
- Strategic Alignment: 20%
- Risk Sensitivity: 25%
- Governance Hygiene: 15%

### Category Score Logic

At present, category scoring is heuristic. The backend checks for signals in the extracted text.

Examples:

- Strategic Alignment looks for terms such as `strategy`, `roadmap`, `objective`, `kpi`, `target`
- Risk Sensitivity looks for terms such as `risk`, `sensitivity`, `stress test`, `scenario`, `downside`, `legal`
- Governance Hygiene looks for terms such as `decision`, `approval`, `action item`, `owner`, `due date`, `compliance`, `ethics`

This means score quality depends heavily on:

- quality of extraction
- clarity of meeting language
- exact phrasing used in the document

### Weighted Score Formula

The weighted score is calculated from category scores using a backend formula. The output is rounded and clamped between 0 and 100.

## Strict Mode Behavior

Strict mode is the main governance safeguard in the current POC.

The engine checks whether the transcript contains approval-oriented discussion without corresponding legal or financial-risk support.

It specifically checks:

- `hasApproval`
- `hasSensitivity`
- `hasLegal`

If approval is present and either sensitivity evidence or legal evidence is missing, the backend raises a strict-mode governance gap.

### Current Strict Mode Outcome

If strict hard cap is enabled through environment configuration:

- score is capped at `70`

If strict hard cap is not enabled:

- a penalty is applied instead

### Important Clarification

The score is not staying at `70` by default anymore because the earlier hard-cap flag bug has been fixed.

However, the score can still remain low when:

- approval language is detected
- legal/risk wording is not detected clearly enough
- extracted text does not preserve enough governance context

## Gap / Risk Flag Logic

The backend currently checks for several rule-based gaps.

### 1. Blindspot Check

If material capex or FX exposure appears in the transcript and sensitivity analysis is missing, the engine raises a high-severity gap.

### 2. ISO 37000 Alignment Check

If ESG / operations content exists without clear compliance / ethics / governance framing, the engine raises an alignment gap.

### 3. Decision Purpose Check

If a decision request is present but options / trade-offs are not clearly structured, the engine raises a recommendation-quality gap.

### 4. Strict Mode Check

If approval-oriented content exists without both legal and financial-risk support, the engine raises a high-severity governance gap.

## How Duration Works

Duration is only returned when it can be directly supported.

Current logic:

- if the model returns a duration, that value is used
- otherwise, the backend tries to infer duration from transcript text such as:
  - `Duration: 45 minutes`
  - `Meeting duration: 2 hours`
  - `10:00 AM - 11:30 AM`
- if none of these are found, duration is now left empty / null rather than showing a misleading default

### Important Clarification

Duration is not currently derived from PDF metadata, calendar metadata, or meeting platform metadata.

It is transcript-driven only.

## How Action Items Work

Action items are no longer hardcoded placeholders.

The backend now tries to extract action items from transcript lines or sentences containing signals such as:

- `action item`
- `follow up`
- `next step`
- `owner`
- `deadline`
- `due date`
- `assigned to`
- `will prepare`
- `will circulate`
- `to review`
- `to update`

For each detected action item, the backend tries best-effort extraction of:

- action text
- owner
- due date
- evidence reference

### Important Clarification

This is still heuristic extraction.

The system may:

- miss implicit actions
- misidentify owners when phrasing is unclear
- miss due dates if they are conversational rather than explicitly formatted

## Minutes, Insights, and Engagement

The backend no longer invents fallback narrative content for these sections.

Current behavior:

- if the model returns minutes, they are shown
- if the model returns insights, they are shown
- if the model returns engagement analysis, it is shown
- if the model does not return them, these sections stay empty rather than showing fabricated examples

This was changed to reduce demo confusion and avoid presenting prototype placeholders as extracted facts.

## What Is Reliable Today

The following areas are reasonably reliable for POC use:

- file upload and storage
- searchable text extraction from PDF / DOCX / TXT
- transcription of MP3 / MP4 when OpenAI API is configured
- evidence pool generation from extracted text
- rule-based gap detection
- weighted score framework
- strict-mode adjustment logic

## What Is Partially Reliable Today

The following areas work, but should still be presented carefully:

- duration inference from transcript text
- action item extraction
- participant extraction from model output
- model-generated narrative summaries
- mixed multi-file interpretation

## Current Limitations

### 1. Score Logic Is Heuristic

The scoring engine depends strongly on keyword and phrase detection.

This means:

- semantically valid governance content can be missed if phrased differently
- legal / risk evidence may exist but not match the regex patterns
- extracted text quality directly affects score quality

### 2. Strict Mode Is Useful but Brittle

Strict mode is conceptually correct for governance control, but detection is still based on simple rules.

This means false positives and false negatives are possible.

### 3. Mixed Document Handling Is Basic

All uploaded files are merged into a single transcript.

The current engine does not yet strongly preserve:

- document-by-document provenance
- section boundaries across documents
- file-level confidence

### 4. Action Item Extraction Is Not Full Minutes Intelligence

Action item extraction is keyword-based, not fully discourse-aware.

It is useful for POC demonstration, but not yet production-grade board minutes automation.

### 5. Duration Is Not Metadata-Aware

The engine does not currently use:

- PDF metadata
- meeting invite metadata
- Teams / Zoom metadata
- file creation / recording metadata

It only uses transcript content if available.

### 6. Model Dependency

Several outputs depend on the LLM returning valid structured JSON.

If the model omits fields or returns weak structure:

- those outputs may be empty
- backend heuristics may partially compensate only for limited fields

## Recommended Demo Positioning

The cleanest way to position this POC is:

"This engine is a governance-analysis prototype that extracts meeting text, identifies evidence-backed governance gaps, and calculates a governance score using weighted factors plus strict governance rules. It is strongest in document parsing, evidence-based rule checks, and score framework demonstration. Narrative sections and some extracted fields are still evolving toward production quality."

## Recommended Next Improvements

### High Priority

- add explicit debug output explaining why a score was penalized or capped
- make legal / risk / compliance detection semantic rather than keyword-only
- improve document-level provenance for mixed uploads
- improve transcript segmentation before scoring

### Medium Priority

- strengthen action-item extraction with speaker-aware parsing
- add explicit participant extraction logic
- add confidence scores per extracted field
- hide empty sections in frontend automatically

### Future Production Enhancements

- metadata-aware duration extraction
- document-type aware routing
- stronger board-paper structure parsing
- section-level evidence grounding
- human-review workflow for risk and governance outputs

## Current Implementation References

Key backend files:

- `python_backend/app/utils/document_parser.py`
- `python_backend/app/utils/governance_engine.py`
- `python_backend/app/main.py`

## Short Summary

The current engine is a hybrid system:

- extraction-driven
- evidence-backed
- rule-augmented
- partially model-generated

Its strongest current value is governance scoring logic with evidence-linked gap detection.

Its weakest current areas are narrative completeness, action-item depth, duration reliability, and multi-document reasoning.
