const fs = require('fs');
const path = require('path');
const pdfParseLib = require('pdf-parse');
const mammoth = require('mammoth');
const { OpenAI } = require('openai');
const { isPageIndexEnabled, extractPdfWithPageIndex } = require('./pageIndexClient');

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

async function extractTextFromFile(filePath, filename) {
    const ext = path.extname(filename).toLowerCase();

    if (ext === '.txt') {
        return fs.readFileSync(filePath, 'utf8');
    }

    if (ext === '.pdf') {
        if (isPageIndexEnabled()) {
            try {
                const pageIndexResult = await extractPdfWithPageIndex(filePath);
                if (pageIndexResult?.text?.trim()) {
                    return pageIndexResult.text;
                }
            } catch (err) {
                console.warn(`PageIndex fallback to local parser for ${filename}: ${err.message}`);
            }
        }

        const dataBuffer = fs.readFileSync(filePath);
        // pdf-parse v2 exports PDFParse class; v1 exports a function.
        if (typeof pdfParseLib === 'function') {
            const data = await pdfParseLib(dataBuffer);
            return data.text;
        }

        if (typeof pdfParseLib.PDFParse === 'function') {
            const parser = new pdfParseLib.PDFParse({ data: dataBuffer });
            try {
                const data = await parser.getText();
                return data.text || '';
            } finally {
                await parser.destroy();
            }
        }

        throw new Error('Unsupported pdf-parse module shape');
    }

    if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value;
    }

    if (ext === '.mp3' || ext === '.mp4') {
        try {
            if (!openai) {
                throw new Error('OPENAI_API_KEY not configured for audio transcription');
            }
            // Using OpenAI Whisper API for audio transcription
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(filePath),
                model: 'whisper-1',
            });
            return transcription.text;
        } catch (e) {
            console.error('Audio transcription error:', e);
            throw new Error('Failed to transcribe audio file');
        }
    }

    throw new Error(`Unsupported file type: ${ext}`);
}

async function processUploadedFiles(files) {
    let combinedText = '';

    for (const file of files) {
        const storedName = file.filename || file.storedName;
        const originalName = file.originalname || file.name || 'unknown-file';
        const localPath = file.path || path.join(__dirname, '../../uploads', storedName || originalName);
        try {
            const text = await extractTextFromFile(localPath, originalName);
            combinedText += `\\n\\n--- Document: ${originalName} ---\\n${text}\\n`;
        } catch (e) {
            console.error(`Failed to parse ${originalName}`, e);
      combinedText += `\\n\\n--- Document: ${originalName} (Failed to parse) ---\\n`;
    }
  }
  
  return combinedText;
}

module.exports = { processUploadedFiles };
