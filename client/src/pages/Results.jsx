import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    ResponsiveContainer, Tooltip
} from 'recharts';
import { assessmentApi } from '../api/client';
import EvidenceDrawer from '../components/EvidenceDrawer';

// ── Score Ring ─────────────────────────────────────────────────────────
function ScoreRing({ score, color }) {
    const r = 56;
    const circ = 2 * Math.PI * r;
    const offset = circ - (score / 100) * circ;

    return (
        <div className="score-ring">
            <svg width="140" height="140" viewBox="0 0 140 140">
                <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
                <circle
                    cx="70" cy="70" r={r} fill="none"
                    stroke={color} strokeWidth="10"
                    strokeDasharray={circ} strokeDashoffset={offset}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 1.5s ease', filter: `drop-shadow(0 0 8px ${color}60)` }}
                />
            </svg>
            <div className="score-center">
                <div className="score-value" style={{ color }}>{score}</div>
                <div className="score-label">/100</div>
            </div>
        </div>
    );
}

// ── Category Bar ───────────────────────────────────────────────────────
function CategoryBar({ label, value, maxValue = 100 }) {
    const pct = Math.round((value / maxValue) * 100);
    const color = value >= 70 ? 'var(--emerald-400)' : value >= 50 ? 'var(--amber-400)' : 'var(--red-400)';
    return (
        <div className="category-score">
            <div className="category-label">{label}</div>
            <div className="category-bar-wrap">
                <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
                </div>
            </div>
            <div className="category-value" style={{ color }}>{value}</div>
        </div>
    );
}

// ── Export Modal ──────────────────────────────────────────────────────
function ExportModal({ onClose, meetingName, assessmentId }) {
    const [sections, setSections] = useState({
        scorecard: true, minutes: true, riskFlags: true, evidenceAppendix: false,
    });
    const [format, setFormat] = useState('pdf');
    const [exporting, setExporting] = useState(false);

    const toggle = (key) => setSections(prev => ({ ...prev, [key]: !prev[key] }));

    const doExport = async () => {
        try {
            setExporting(true);
            const blob = await assessmentApi.exportReport(assessmentId, { format, sections });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const ext = format === 'detailed' ? 'md' : 'txt';
            a.download = `BoardPack-${meetingName.replace(/\s+/g, '-')}-${format}.${ext}`;
            a.click();
            URL.revokeObjectURL(url);
            onClose();
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal">
                <div className="modal-header">
                    <div>
                        <div className="modal-title">Export Report</div>
                        <div className="text-sm text-muted" style={{ marginTop: '4px' }}>Configure and download your governance report</div>
                    </div>
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>

                <div className="form-group mb-6">
                    <label className="form-label">Export Format</label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        {['pdf', 'briefing', 'detailed'].map(f => (
                            <button
                                key={f}
                                className={`btn ${format === f ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                                onClick={() => setFormat(f)}
                            >
                                {f === 'pdf' ? '📄 PDF' : f === 'briefing' ? '📊 Board Briefing' : '📑 Full Analysis'}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="form-group mb-6">
                    <label className="form-label">Sections to Include</label>
                    <div className="toggle-group">
                        {[
                            { key: 'scorecard', label: 'Governance Scorecard' },
                            { key: 'minutes', label: 'Meeting Minutes' },
                            { key: 'riskFlags', label: 'Risk Flags' },
                            { key: 'evidenceAppendix', label: 'Evidence Appendix' },
                        ].map(s => (
                            <div key={s.key} className="toggle-item">
                                <div className="toggle-label">{s.label}</div>
                                <div className={`toggle-switch ${sections[s.key] ? 'on' : ''}`} onClick={() => toggle(s.key)} />
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary btn-lg" onClick={doExport} disabled={exporting}>
                        {exporting ? <><span className="spinner" style={{ width: '16px', height: '16px' }} /> Generating...</> : '⬇️ Download Report'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Main Results Page ──────────────────────────────────────────────────
export default function Results() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [assessment, setAssessment] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [drawerEvidence, setDrawerEvidence] = useState([]);
    const [showExport, setShowExport] = useState(false);

    const load = useCallback(async () => {
        try {
            const data = await assessmentApi.getById(id);
            setAssessment(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { load(); }, [load]);

    const openEvidence = (refs, evidencePool) => {
        const items = refs.map(ref => evidencePool.find(e => e.id === ref)).filter(Boolean);
        setDrawerEvidence(items);
        setDrawerOpen(true);
    };

    if (loading) {
        return (
            <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                <div style={{ textAlign: 'center' }}>
                    <div className="spinner" style={{ width: '48px', height: '48px', margin: '0 auto 16px' }} />
                    <div className="text-muted">Loading governance analysis...</div>
                </div>
            </div>
        );
    }

    if (!assessment || !assessment.results) {
        return (
            <div className="page-container">
                <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
                    <h2>Analysis Not Ready</h2>
                    <p className="text-muted" style={{ marginTop: '8px' }}>This assessment may still be processing.</p>
                    <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
                        <button className="btn btn-secondary" onClick={() => navigate(`/processing/${id}`)}>View Progress</button>
                        <button className="btn btn-ghost" onClick={() => navigate('/')}>← Back to Dashboard</button>
                    </div>
                </div>
            </div>
        );
    }

    const { results } = assessment;
    const riskColor = results.riskIndicator.level === 'green' ? '#10b981' : results.riskIndicator.level === 'amber' ? '#f59e0b' : '#ef4444';
    const evidencePool = results.evidencePool;

    const TABS = ['overview', 'minutes', 'insights', 'engagement', 'risks'];

    return (
        <>
            <div className="page-container">
                {/* Header */}
                <div className="page-header">
                    <div className="page-breadcrumb">
                        <span onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>🏠 Dashboard</span>
                        <span style={{ opacity: 0.4 }}>/</span>
                        <span style={{ color: 'var(--accent)' }}>Results</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                        <div>
                            <h1 className="page-title">{assessment.meetingName}</h1>
                            <div className="page-description">Governance Analysis Complete · {new Date(results.completedAt).toLocaleString('en-GB')}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                            <button className="btn btn-secondary" onClick={() => setDrawerOpen(true)}>📎 Evidence</button>
                            <button className="btn btn-primary" onClick={() => setShowExport(true)}>⬇️ Export Report</button>
                        </div>
                    </div>
                </div>

                {/* Score Banner */}
                <div className="card mb-6" style={{
                    background: `linear-gradient(135deg, rgba(${results.riskIndicator.level === 'green' ? '16,185,129' : results.riskIndicator.level === 'amber' ? '245,158,11' : '239,68,68'},0.08), transparent)`,
                    borderColor: `${riskColor}30`,
                }}>
                    <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <ScoreRing score={results.governanceScore} color={riskColor} />
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div className="text-sm text-muted mb-3" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>Governance Score</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                                <span className={`badge badge-${results.riskIndicator.level}`}>
                                    <span className={`dot dot-${results.riskIndicator.level}`} />
                                    {results.riskIndicator.label}
                                </span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '400px' }}>
                                <CategoryBar label="Evidence Completeness (40%)" value={results.categoryScores.evidenceCompleteness} />
                                <CategoryBar label="Strategic Alignment (20%)" value={results.categoryScores.strategicAlignment} />
                                <CategoryBar label="Risk Sensitivity (25%)" value={results.categoryScores.riskSensitivity} />
                                <CategoryBar label="Governance Hygiene (15%)" value={results.categoryScores.governanceHygiene} />
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '180px' }}>
                            {[
                                ['📅 Meeting Date', assessment.meetingDate],
                                ['⏱️ Duration', results.duration],
                                ['👥 Participants', `${results.participants.filter(p => p.attendee).length} attendees`],
                                ['🚩 Risk Flags', `${results.gaps.length} detected`],
                            ].map(([label, value]) => (
                                <div key={label} style={{ fontSize: '12px' }}>
                                    <div className="text-muted">{label}</div>
                                    <div style={{ fontWeight: 600, fontSize: '14px', marginTop: '2px' }}>{value}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="tab-bar">
                    {TABS.map(t => (
                        <button
                            key={t}
                            className={`tab-btn ${activeTab === t ? 'active' : ''}`}
                            onClick={() => setActiveTab(t)}
                        >
                            {t === 'overview' ? '📋 Overview' : t === 'minutes' ? '📝 Minutes' : t === 'insights' ? '💡 Insights' : t === 'engagement' ? '📊 Engagement' : '🚩 Risk Flags'}
                        </button>
                    ))}
                </div>

                {/* ── Overview Tab ── */}
                {activeTab === 'overview' && (
                    <div>
                        <div className="card mb-6">
                            <div className="card-header">
                                <div className="card-title">Meeting Overview</div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px' }}>
                                <div><div className="text-sm text-muted">Meeting Name</div><div style={{ fontWeight: 700 }}>{assessment.meetingName}</div></div>
                                <div><div className="text-sm text-muted">Date</div><div style={{ fontWeight: 700 }}>{assessment.meetingDate}</div></div>
                                <div><div className="text-sm text-muted">Duration</div><div style={{ fontWeight: 700 }}>{results.duration}</div></div>
                                <div><div className="text-sm text-muted">Participants</div><div style={{ fontWeight: 700 }}>{results.participants.length}</div></div>
                                <div><div className="text-sm text-muted">Risk Indicator</div><div style={{ fontWeight: 700 }}>{results.riskIndicator.label}</div></div>
                            </div>
                        </div>

                        <div className="grid-2 mb-6">
                            {/* Attendees */}
                            <div className="card">
                                <div className="card-header">
                                    <div className="card-title">👥 Attendees</div>
                                    <span className="badge badge-green">{results.participants.filter(p => p.attendee).length} present</span>
                                </div>
                                <div className="participant-list">
                                    {results.participants.map((p, i) => (
                                        <div key={i} className="participant-row">
                                            <div className="participant-avatar">{p.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</div>
                                            <div>
                                                <div className="participant-name">{p.name} {!p.attendee && <span className="badge badge-gray" style={{ marginLeft: '6px' }}>Apologies</span>}</div>
                                                <div className="participant-role">{p.role}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Quick Actions */}
                            <div className="card">
                                <div className="card-title mb-4">⚡ Quick Navigation</div>
                                {[
                                    { tab: 'minutes', label: '📝 View Generated Minutes', desc: `${results.minutes.keyDecisions.length} decisions, ${results.minutes.actionItems.length} action items` },
                                    { tab: 'insights', label: '💡 Key Governance Insights', desc: `${results.insights.reduce((s, c) => s + c.insights.length, 0)} insights across 3 categories` },
                                    { tab: 'engagement', label: '📊 Engagement Analysis', desc: `${results.engagement.signals.length} signals detected` },
                                    { tab: 'risks', label: '🚩 Risk Flags', desc: `${results.gaps.length} governance flags raised` },
                                ].map(item => (
                                    <div
                                        key={item.tab}
                                        className="insight-item"
                                        onClick={() => setActiveTab(item.tab)}
                                    >
                                        <div style={{ fontWeight: 600, fontSize: '13px' }}>{item.label}</div>
                                        <div className="text-sm text-muted" style={{ marginTop: '4px' }}>{item.desc}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Minutes Tab ── */}
                {activeTab === 'minutes' && (
                    <div className="grid-2 mb-6">
                        {/* Key Decisions */}
                        <div className="card">
                            <div className="card-header">
                                <div className="card-title">✅ Key Decisions</div>
                                <span className="badge badge-blue">{results.minutes.keyDecisions.length}</span>
                            </div>
                            {results.minutes.keyDecisions.map(d => (
                                <div key={d.id} className="action-item">
                                    <div className="action-bullet">D</div>
                                    <div className="action-content">
                                        <div className="action-text">{d.decision}</div>
                                        <div className="action-meta">
                                            <span
                                                className="ev-ref"
                                                onClick={() => openEvidence([d.evidenceRef], evidencePool)}
                                                title="View evidence"
                                            >
                                                Ref {d.evidenceRef}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Action Items */}
                        <div className="card">
                            <div className="card-header">
                                <div className="card-title">📌 Action Items</div>
                                <span className="badge badge-amber">{results.minutes.actionItems.length}</span>
                            </div>
                            {results.minutes.actionItems.map(a => (
                                <div key={a.id} className="action-item">
                                    <div className="action-bullet" style={{ background: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--amber-300)' }}>A</div>
                                    <div className="action-content">
                                        <div className="action-text">{a.action}</div>
                                        <div className="action-meta">
                                            <span>Owner: {a.owner}</span>
                                            <span>Due: {a.due}</span>
                                            <span
                                                className="ev-ref"
                                                onClick={() => openEvidence([a.evidenceRef], evidencePool)}
                                            >
                                                Ref {a.evidenceRef}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Unresolved */}
                        <div className="card">
                            <div className="card-header">
                                <div className="card-title">⚠️ Unresolved Matters</div>
                                <span className="badge badge-red">{results.minutes.unresolvedMatters.length}</span>
                            </div>
                            {results.minutes.unresolvedMatters.map(u => (
                                <div key={u.id} className="action-item">
                                    <div className="action-bullet" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: 'var(--red-300)' }}>U</div>
                                    <div className="action-content">
                                        <div className="action-text">{u.matter}</div>
                                        <div className="action-meta">
                                            <span
                                                className="ev-ref"
                                                onClick={() => openEvidence([u.evidenceRef], evidencePool)}
                                            >
                                                Ref {u.evidenceRef}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Apologies */}
                        <div className="card">
                            <div className="card-header">
                                <div className="card-title">🙏 Apologies</div>
                            </div>
                            {results.minutes.apologies.map((a, i) => (
                                <div key={i} className="action-item">
                                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{a}</div>
                                </div>
                            ))}
                            {results.minutes.apologies.length === 0 && (
                                <div className="text-sm text-muted">No apologies recorded.</div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Insights Tab ── */}
                {activeTab === 'insights' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {results.insights.map(cat => (
                            <div key={cat.category} className="card">
                                <div className="card-header">
                                    <div>
                                        <div className="card-title">
                                            {cat.category === 'Financial Oversight' ? '💰' :
                                                cat.category === 'Strategic Alignment' ? '🎯' : '🛡️'} {cat.category}
                                        </div>
                                        <div className="card-subtitle">{cat.insights.length} insights identified</div>
                                    </div>
                                </div>
                                {cat.insights.map(insight => (
                                    <div
                                        key={insight.id}
                                        className="insight-item"
                                        onClick={() => openEvidence([insight.evidenceRef], evidencePool)}
                                    >
                                        <div className="insight-header">
                                            <span className="text-sm text-muted" style={{ fontFamily: 'monospace' }}>{insight.id}</span>
                                            <span
                                                className="ev-ref"
                                                onClick={e => { e.stopPropagation(); openEvidence([insight.evidenceRef], evidencePool); }}
                                            >
                                                {insight.evidenceRef}
                                            </span>
                                        </div>
                                        <div className="insight-text">{insight.text}</div>
                                        <div className="confidence-bar">
                                            <span className="confidence-label">Confidence</span>
                                            <div style={{ flex: 1 }}>
                                                <div className="progress-bar" style={{ height: '4px' }}>
                                                    <div className="progress-fill progress-fill-blue" style={{ width: `${insight.confidence}%` }} />
                                                </div>
                                            </div>
                                            <span className="confidence-value">{insight.confidence}%</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}

                {/* ── Engagement Tab ── */}
                {activeTab === 'engagement' && (
                    <div className="grid-2 mb-6">
                        <div className="card">
                            <div className="card-header">
                                <div className="card-title">📊 Engagement Radar</div>
                                <div className="card-subtitle">Board participation quality metrics</div>
                            </div>
                            <div className="radar-container">
                                <ResponsiveContainer width="100%" height={280}>
                                    <RadarChart data={results.engagement.radarData}>
                                        <PolarGrid stroke="rgba(255,255,255,0.08)" />
                                        <PolarAngleAxis dataKey="axis" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                        <Radar name="Score" dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={2} />
                                        <Tooltip
                                            contentStyle={{ background: 'var(--navy-900)', border: '1px solid var(--border-medium)', borderRadius: '8px', fontSize: '12px' }}
                                            formatter={(v) => [`${v}`, 'Score']}
                                        />
                                    </RadarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="card">
                            <div className="card-header">
                                <div className="card-title">📡 Engagement Signals</div>
                                <div className="card-subtitle">Board behaviour patterns detected</div>
                            </div>
                            {results.engagement.signals.map(s => (
                                <div key={s.id} className="risk-flag" style={
                                    s.severity === 'positive' ? { borderLeftColor: 'var(--emerald-400)', background: 'rgba(16,185,129,0.05)', borderColor: 'rgba(16,185,129,0.15)' } :
                                        s.severity === 'critical' ? {} : { borderLeftColor: 'var(--amber-400)', borderColor: 'rgba(245,158,11,0.15)', background: 'rgba(245,158,11,0.05)' }
                                }>
                                    <div className="risk-flag-header">
                                        <div className="risk-flag-title">
                                            {s.severity === 'positive' ? '✅' : s.severity === 'critical' ? '🔴' : '⚠️'} {s.signal}
                                        </div>
                                        <span className={`badge badge-${s.severity === 'positive' ? 'green' : s.severity === 'critical' ? 'red' : 'amber'}`}>
                                            {s.severity}
                                        </span>
                                    </div>
                                    <div className="risk-flag-desc">{s.description}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Risk Flags Tab ── */}
                {activeTab === 'risks' && (
                    <div>
                        <div style={{ marginBottom: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <div className="card" style={{ padding: '12px 18px', display: 'inline-flex', gap: '10px', alignItems: 'center' }}>
                                <span className="badge badge-red">High Severity</span>
                                <span style={{ fontWeight: 700 }}>{results.gaps.filter(g => g.severity === 'high').length}</span>
                            </div>
                            <div className="card" style={{ padding: '12px 18px', display: 'inline-flex', gap: '10px', alignItems: 'center' }}>
                                <span className="badge badge-amber">Medium Severity</span>
                                <span style={{ fontWeight: 700 }}>{results.gaps.filter(g => g.severity === 'medium').length}</span>
                            </div>
                        </div>

                        {results.gaps.map(gap => (
                            <div
                                key={gap.id}
                                className={`risk-flag ${gap.severity === 'medium' ? 'medium' : ''}`}
                                onClick={() => openEvidence(gap.evidenceRefs, evidencePool)}
                            >
                                <div className="risk-flag-header">
                                    <div>
                                        <div className="risk-flag-title">
                                            {gap.severity === 'high' ? '🔴' : '🟡'} {gap.flag}
                                        </div>
                                        <div className="risk-flag-rule">{gap.rule} · {gap.id}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                                        <span className={`badge badge-${gap.severity === 'high' ? 'red' : 'amber'}`}>{gap.severity}</span>
                                        {gap.evidenceRefs.map(r => (
                                            <span
                                                key={r}
                                                className="ev-ref"
                                                onClick={e => { e.stopPropagation(); openEvidence([r], evidencePool); }}
                                            >
                                                {r}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="risk-flag-desc">{gap.description}</div>
                                <div className="risk-remediation">
                                    <strong>🔧 Remediation: </strong>{gap.remediation}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Evidence Drawer */}
            <EvidenceDrawer
                isOpen={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                evidence={drawerEvidence.length > 0 ? drawerEvidence : evidencePool?.slice(0, 3)}
            />

            {/* Export Modal */}
            {showExport && (
                <ExportModal
                    onClose={() => setShowExport(false)}
                    meetingName={assessment.meetingName}
                    assessmentId={assessment.id}
                />
            )}
        </>
    );
}
