import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { assessmentApi } from '../api/client';

const STAGES = [
    { key: 'transcriptParsing', label: 'Transcript Parsing', desc: 'OCR, speaker diarization & segmentation', icon: '📄' },
    { key: 'minutesGeneration', label: 'Meeting Minutes Generation', desc: 'Extracting decisions, actions & agenda items', icon: '📝' },
    { key: 'keyInsights', label: 'Key Insights Extraction', desc: 'Semantic analysis & evidence mapping', icon: '🔍' },
    { key: 'engagementAnalysis', label: 'Engagement Analysis', desc: 'Speaker distribution & challenger scoring', icon: '📊' },
    { key: 'governanceScoring', label: 'Governance Scoring', desc: 'ISO 37000 gap detection & weighted scoring', icon: '⚖️' },
];

function StageRow({ stage, status, index }) {
    return (
        <div className={`pipeline-stage ${status}`}>
            <div className={`stage-number ${status}`}>
                {status === 'complete' ? '✓' : status === 'processing' ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : index + 1}
            </div>
            <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{stage.icon}</span> {stage.label}
                </div>
                <div className="text-sm text-muted" style={{ marginTop: '2px' }}>{stage.desc}</div>
            </div>
            <div>
                {status === 'complete' && <span className="badge badge-green">Complete</span>}
                {status === 'processing' && <span className="badge badge-blue">Processing</span>}
                {status === 'pending' && <span className="badge badge-gray">Pending</span>}
            </div>
        </div>
    );
}

export default function Processing() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [statusData, setStatusData] = useState(null);
    const [assessment, setAssessment] = useState(null);
    const [error, setError] = useState('');
    const logRef = useRef(null);
    const startedRef = useRef(false);

    const fetchStatus = useCallback(async () => {
        try {
            const data = await assessmentApi.getStatus(id);
            setStatusData(data);
            if (data.status === 'completed') {
                setTimeout(() => navigate(`/results/${id}`), 1500);
            }
        } catch (e) {
            setError('Failed to fetch analysis status.');
        }
    }, [id, navigate]);

    useEffect(() => {
        const init = async () => {
            try {
                const a = await assessmentApi.getById(id);
                setAssessment(a);
                if (!startedRef.current && a.status !== 'completed') {
                    startedRef.current = true;
                    await assessmentApi.startAnalysis(id);
                }
            } catch (e) {
                console.error(e);
            }
        };
        init();
    }, [id]);

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 1500);
        return () => clearInterval(interval);
    }, [fetchStatus]);

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [statusData?.logs]);

    const pipeline = statusData?.pipeline || {};
    const logs = statusData?.logs || [];

    const completedCount = STAGES.filter(s => pipeline[s.key] === 'complete').length;
    const progress = Math.round((completedCount / STAGES.length) * 100);

    // Estimated time
    const pendingStages = STAGES.filter(s => pipeline[s.key] === 'pending').length;
    const processingStage = STAGES.find(s => pipeline[s.key] === 'processing');
    const etaSeconds = pendingStages * 3 + (processingStage ? 2 : 0);

    function formatLog(msg) {
        if (msg.toLowerCase().includes('warning') || msg.toLowerCase().includes('weak')) return 'warning';
        if (msg.toLowerCase().includes('complete') || msg.toLowerCase().includes('done')) return 'success';
        return 'info';
    }

    return (
        <div className="page-container">
            {/* Header */}
            <div className="page-header">
                <div className="page-breadcrumb">
                    <span onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>🏠 Dashboard</span>
                    <span style={{ opacity: 0.4 }}>/</span>
                    <span style={{ color: 'var(--accent)' }}>Analysis in Progress</span>
                </div>
                <h1 className="page-title">AI Analysis Pipeline</h1>
                <div className="page-description">
                    {assessment?.meetingName || 'Board Pack'} is being processed through the governance AI engine.
                </div>
            </div>

            {error && (
                <div style={{ marginBottom: '24px', padding: '12px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px' }}>
                    <div className="text-red">{error}</div>
                </div>
            )}

            <div className="grid-2" style={{ gap: '24px' }}>
                {/* Pipeline Stages */}
                <div>
                    <div className="card mb-6">
                        <div className="card-header">
                            <div>
                                <div className="card-title">Processing Pipeline</div>
                                <div className="card-subtitle">5-stage AI governance analysis</div>
                            </div>
                            {statusData?.status === 'completed' && (
                                <span className="badge badge-green">✓ Complete</span>
                            )}
                        </div>

                        {/* Overall progress */}
                        <div style={{ marginBottom: '24px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span className="text-sm text-muted">Overall Progress</span>
                                <span className="text-sm" style={{ fontWeight: 700, color: 'var(--accent)' }}>{progress}%</span>
                            </div>
                            <div className="progress-bar" style={{ height: '8px' }}>
                                <div className="progress-fill progress-fill-blue" style={{ width: `${progress}%` }} />
                            </div>
                            {statusData?.status !== 'completed' && etaSeconds > 0 && (
                                <div className="text-sm text-muted" style={{ marginTop: '6px' }}>
                                    ⏱️ Estimated {etaSeconds}s remaining
                                </div>
                            )}
                        </div>

                        {/* Stages */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {STAGES.map((stage, i) => (
                                <StageRow
                                    key={stage.key}
                                    stage={stage}
                                    status={pipeline[stage.key] || 'pending'}
                                    index={i}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Log Panel & Info */}
                <div>
                    <div className="card mb-6">
                        <div className="card-header">
                            <div>
                                <div className="card-title">System Log</div>
                                <div className="card-subtitle">Real-time analysis events</div>
                            </div>
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--red-400)' }} />
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--amber-400)' }} />
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--emerald-400)' }} />
                            </div>
                        </div>
                        <div className="log-panel" ref={logRef}>
                            <div className="log-entry">
                                <span className="log-time">init</span>
                                <span className="log-msg info">Analysis pipeline initialised for "{assessment?.meetingName}"</span>
                            </div>
                            {logs.map((log, i) => (
                                <div key={i} className="log-entry">
                                    <span className="log-time">{new Date(log.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                    <span className={`log-msg ${formatLog(log.message)}`}>{log.message}</span>
                                </div>
                            ))}
                            {statusData?.status === 'completed' && (
                                <div className="log-entry">
                                    <span className="log-time">done</span>
                                    <span className="log-msg success">✓ Governance analysis complete — redirecting to results...</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Meeting info card */}
                    {assessment && (
                        <div className="card">
                            <div className="card-title mb-4">📋 Meeting Details</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {[
                                    ['Meeting Name', assessment.meetingName],
                                    ['Meeting Date', assessment.meetingDate],
                                    ['Files Uploaded', `${assessment.files?.length || 0} file(s)`],
                                    ['Upload Time', new Date(assessment.uploadDate).toLocaleString('en-GB')],
                                ].map(([label, value]) => (
                                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                        <span className="text-muted">{label}</span>
                                        <span style={{ fontWeight: 600 }}>{value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
