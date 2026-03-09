const fs = require('fs');
const path = require('path');

const PAGEINDEX_BASE_URL = process.env.PAGEINDEX_BASE_URL || 'https://api.pageindex.ai';
const POLL_INTERVAL_MS = Number(process.env.PAGEINDEX_POLL_INTERVAL_MS || 3000);
const POLL_TIMEOUT_MS = Number(process.env.PAGEINDEX_POLL_TIMEOUT_MS || 120000);

function isPageIndexEnabled() {
  return Boolean(process.env.PAGEINDEX_API_KEY);
}

async function submitDocument(filePath) {
  const apiKey = process.env.PAGEINDEX_API_KEY;
  if (!apiKey) throw new Error('PAGEINDEX_API_KEY is not configured');

  const fileName = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), fileName);

  const response = await fetch(`${PAGEINDEX_BASE_URL}/doc/`, {
    method: 'POST',
    headers: { api_key: apiKey },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PageIndex submit failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  if (!payload?.doc_id) {
    throw new Error('PageIndex submit failed: missing doc_id');
  }

  return payload.doc_id;
}

async function getOcrStatus(docId) {
  const apiKey = process.env.PAGEINDEX_API_KEY;
  const url = new URL(`${PAGEINDEX_BASE_URL}/doc/${docId}/`);
  url.searchParams.set('type', 'ocr');
  url.searchParams.set('format', 'page');

  const response = await fetch(url, {
    method: 'GET',
    headers: { api_key: apiKey },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PageIndex OCR status failed: ${response.status} ${text}`);
  }

  return response.json();
}

function ocrResultToText(result) {
  if (typeof result === 'string') return result;
  if (!Array.isArray(result)) return '';

  return result
    .map((page) => {
      const pageIndex = page?.page_index ?? '?';
      const markdown = page?.markdown || '';
      return `\n[Page ${pageIndex}]\n${markdown}`;
    })
    .join('\n');
}

async function extractPdfWithPageIndex(filePath) {
  const docId = await submitDocument(filePath);
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const statusPayload = await getOcrStatus(docId);
    if (statusPayload?.status === 'completed') {
      return {
        docId,
        text: ocrResultToText(statusPayload.result),
      };
    }
    if (statusPayload?.status === 'failed') {
      throw new Error(`PageIndex OCR failed for ${docId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`PageIndex OCR timed out after ${POLL_TIMEOUT_MS}ms`);
}

module.exports = {
  isPageIndexEnabled,
  extractPdfWithPageIndex,
};

