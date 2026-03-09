const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const store = require('../data/store');
const { runGovernanceAnalysis } = require('../utils/governanceEngine');

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads')),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const ALLOWED_EXTS = ['.pdf', '.docx', '.txt', '.mp3', '.mp4'];

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTS.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`Unsupported file type: ${ext}. Allowed: PDF, DOCX, TXT, MP3, MP4`), false);
    }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/assessments – list all
router.get('/', (req, res) => {
    res.json({ success: true, data: store.getAll() });
});

// GET /api/assessments/:id
router.get('/:id', (req, res) => {
    const assessment = store.getById(req.params.id);
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });
    res.json({ success: true, data: assessment });
});

// POST /api/assessments – create new with file upload
router.post('/', upload.array('files', 10), (req, res) => {
    const { meetingName, meetingDate } = req.body;
    if (!meetingName) return res.status(400).json({ success: false, message: 'Meeting name is required' });

    const id = uuidv4();
    const assessment = {
        id,
        meetingName,
        meetingDate: meetingDate || new Date().toISOString().split('T')[0],
        uploadDate: new Date().toISOString(),
        status: 'processing',
        governanceScore: null,
        riskIndicator: null,
        files: (req.files || []).map(f => ({
            name: f.originalname,
            originalname: f.originalname,
            filename: f.filename,
            storedName: f.filename,
            path: f.path,
            size: f.size,
            mimetype: f.mimetype,
        })),
        results: null,
        pipeline: {
            transcriptParsing: 'pending',
            minutesGeneration: 'pending',
            keyInsights: 'pending',
            engagementAnalysis: 'pending',
            governanceScoring: 'pending',
        },
        logs: [],
    };

    store.save(assessment);
    res.status(201).json({ success: true, data: assessment });
});

// POST /api/assessments/:id/start – trigger analysis pipeline
router.post('/:id/start', (req, res) => {
    const assessment = store.getById(req.params.id);
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });
    if (assessment.status === 'completed') return res.status(400).json({ success: false, message: 'Already completed' });

    assessment.status = 'processing';
    assessment.startedAt = new Date().toISOString();
    store.save(assessment);

    // Run async pipeline simulation
    runPipelineAsync(assessment.id);

    res.json({ success: true, data: assessment, message: 'Analysis pipeline started' });
});

// GET /api/assessments/:id/status – poll pipeline status
router.get('/:id/status', (req, res) => {
    const assessment = store.getById(req.params.id);
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });
    res.json({
        success: true,
        data: {
            id: assessment.id,
            status: assessment.status,
            pipeline: assessment.pipeline,
            logs: assessment.logs,
            governanceScore: assessment.governanceScore,
            riskIndicator: assessment.riskIndicator,
        },
    });
});

// DELETE /api/assessments/:id
router.delete('/:id', (req, res) => {
    if (!store.getById(req.params.id)) return res.status(404).json({ success: false, message: 'Assessment not found' });
    store.remove(req.params.id);
    res.json({ success: true, message: 'Assessment deleted' });
});

// POST /api/assessments/:id/export
router.post('/:id/export', (req, res) => {
    const assessment = store.getById(req.params.id);
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });
    if (!assessment.results) return res.status(400).json({ success: false, message: 'Assessment results are not ready' });

    const { format = 'pdf', sections = {} } = req.body || {};
    const selectedSections = {
        scorecard: sections.scorecard !== false,
        minutes: sections.minutes !== false,
        riskFlags: sections.riskFlags !== false,
        evidenceAppendix: sections.evidenceAppendix === true,
    };

    const report = buildExportReport(assessment, format, selectedSections);
    const filenameSafe = assessment.meetingName.replace(/[^a-z0-9-_]+/gi, '-');
    const ext = format === 'detailed' ? 'md' : 'txt';
    const fileName = `BoardPack-${filenameSafe}-${format}.${ext}`;

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.type('text/plain').send(report);
});

// ── Pipeline simulation ──────────────────────────────────────────────────────

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function addLog(assessment, message) {
    assessment.logs.push({ timestamp: new Date().toISOString(), message });
    store.save(assessment);
}

async function runPipelineAsync(id) {
    const stages = [
        {
            key: 'transcriptParsing',
            logs: ['Initialising document parser...', 'OCR applied to scanned pages', 'Speaker diarization complete', 'Transcript segmented into 47 segments'],
            duration: 3000,
        },
        {
            key: 'minutesGeneration',
            logs: ['Extracting agenda items...', 'Identifying decision points', 'Action item detection complete', 'Draft minutes compiled'],
            duration: 3500,
        },
        {
            key: 'keyInsights',
            logs: ['Running semantic analysis...', 'Weak evidence warning on Item 3', 'Financial oversight signals identified', 'Regulatory compliance check complete'],
            duration: 3000,
        },
        {
            key: 'engagementAnalysis',
            logs: ['Analysing speaker distribution...', 'Challenger behaviour scoring', 'Sentiment mapping applied', 'Engagement radar computed'],
            duration: 2500,
        },
        {
            key: 'governanceScoring',
            logs: ['Applying ISO 37000 alignment rules...', 'Gap detection complete – 4 flags raised', 'Weighted score computation', 'Evidence index finalised'],
            duration: 2000,
        },
    ];

    try {
        for (const stage of stages) {
            const assessment = store.getById(id);
            if (!assessment) return;
            assessment.pipeline[stage.key] = 'processing';
            store.save(assessment);

            for (const log of stage.logs) {
                await delay(stage.duration / stage.logs.length);
                const a = store.getById(id);
                if (!a) return;
                addLog(a, log);
            }

            const a2 = store.getById(id);
            if (!a2) return;
            a2.pipeline[stage.key] = 'complete';
            store.save(a2);
        }

        // Final scoring
        const finalAssessment = store.getById(id);
        if (!finalAssessment) return;
        const results = await runGovernanceAnalysis(id, finalAssessment.meetingName, finalAssessment.files);
        finalAssessment.status = 'completed';
        finalAssessment.results = results;
        finalAssessment.governanceScore = results.governanceScore;
        finalAssessment.riskIndicator = results.riskIndicator;
        finalAssessment.completedAt = new Date().toISOString();
        addLog(finalAssessment, `Governance scoring complete. Final score: ${results.governanceScore}`);
        store.save(finalAssessment);
    } catch (error) {
        const failed = store.getById(id);
        if (!failed) return;
        failed.status = 'failed';
        Object.keys(failed.pipeline).forEach((k) => {
            if (failed.pipeline[k] === 'processing') {
                failed.pipeline[k] = 'pending';
            }
        });
        addLog(failed, `Pipeline failed: ${error.message}`);
        store.save(failed);
    }
}

function buildExportReport(assessment, format, sections) {
    const { results } = assessment;
    const lines = [];
    const title = format === 'briefing' ? 'Board Briefing' : format === 'detailed' ? 'Full Detailed Analysis' : 'PDF Report';

    lines.push(`BoardPack - Board Pack Review System`);
    lines.push(`${title}`);
    lines.push(`Meeting: ${assessment.meetingName}`);
    lines.push(`Date: ${assessment.meetingDate}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    if (sections.scorecard) {
        lines.push('Governance Scorecard');
        lines.push(`Overall Score: ${results.governanceScore}`);
        lines.push(`Risk Indicator: ${results.riskIndicator.label}`);
        lines.push(`Evidence Completeness: ${results.categoryScores.evidenceCompleteness}`);
        lines.push(`Strategic Alignment: ${results.categoryScores.strategicAlignment}`);
        lines.push(`Risk Sensitivity: ${results.categoryScores.riskSensitivity}`);
        lines.push(`Governance Hygiene: ${results.categoryScores.governanceHygiene}`);
        lines.push('');
    }

    if (sections.minutes) {
        lines.push('Meeting Minutes');
        (results.minutes.keyDecisions || []).forEach((item) => lines.push(`Decision: ${item.decision} (Ref ${item.evidenceRef})`));
        (results.minutes.actionItems || []).forEach((item) => lines.push(`Action: ${item.action} (Ref ${item.evidenceRef})`));
        (results.minutes.unresolvedMatters || []).forEach((item) => lines.push(`Unresolved: ${item.matter} (Ref ${item.evidenceRef})`));
        lines.push('');
    }

    if (sections.riskFlags) {
        lines.push('Risk Flags');
        (results.gaps || []).forEach((gap) => {
            lines.push(`- ${gap.flag} [${gap.severity}]`);
            lines.push(`  Rule: ${gap.rule}`);
            lines.push(`  Evidence: ${(gap.evidenceRefs || []).join(', ')}`);
            lines.push(`  Remediation: ${gap.remediation}`);
        });
        lines.push('');
    }

    if (sections.evidenceAppendix) {
        lines.push('Evidence Appendix');
        (results.evidencePool || []).forEach((ev) => {
            lines.push(`${ev.id} | ${ev.speaker} | ${ev.timestamp}`);
            lines.push(`"${ev.excerpt}"`);
        });
        lines.push('');
    }

    return lines.join('\n');
}

// Multer error handler
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message.includes('Unsupported')) {
        return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
});

module.exports = router;
