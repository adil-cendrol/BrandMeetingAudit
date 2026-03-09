import React from 'react';
import { assessmentApi } from '../api/client';

function getRiskColor(level) {
    if (!level) return 'gray';
    if (level === 'green') return 'green';
    if (level === 'amber') return 'amber';
    return 'red';
}

function formatDate(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }) {
    if (status === 'completed') return <span className="badge badge-green"><span className="dot dot-green" />Completed</span>;
    if (status === 'processing') return <span className="badge badge-blue"><span className="spinner" style={{ width: '10px', height: '10px', marginRight: '4px' }} />Processing</span>;
    if (status === 'failed') return <span className="badge badge-red"><span className="dot dot-red" />Failed</span>;
    return <span className="badge badge-gray">Pending</span>;
}

export default function AssessmentTable({ assessments, onView, onRefresh }) {
    const handleDelete = async (id) => {
        if (!confirm('Delete this assessment? This cannot be undone.')) return;
        try {
            await assessmentApi.delete(id);
            onRefresh();
        } catch (e) {
            console.error(e);
        }
    };

    if (!assessments || assessments.length === 0) {
        return (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }}>??</div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>No assessments yet</div>
                <div className="text-sm text-muted">Upload your first board pack transcript to get started.</div>
            </div>
        );
    }

    return (
        <div className="table-wrapper">
            <table>
                <thead>
                    <tr>
                        <th>Meeting Name</th>
                        <th>Upload Date</th>
                        <th>Processing Status</th>
                        <th>Governance Score</th>
                        <th>Risk Flag Indicator</th>
                        <th>View Results</th>
                    </tr>
                </thead>
                <tbody>
                    {assessments.map(a => {
                        const riskColor = getRiskColor(a.riskIndicator?.level);
                        return (
                            <tr key={a.id}>
                                <td>
                                    <div style={{ fontWeight: 600 }}>{a.meetingName}</div>
                                    <div className="text-sm text-muted">{formatDate(a.meetingDate)}</div>
                                </td>
                                <td>{formatDate(a.uploadDate)}</td>
                                <td><StatusBadge status={a.status} /></td>
                                <td>
                                    {a.governanceScore != null ? (
                                        <span style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 800, color: riskColor === 'green' ? 'var(--emerald-400)' : riskColor === 'amber' ? 'var(--amber-400)' : riskColor === 'red' ? 'var(--red-400)' : 'var(--text-muted)' }}>
                                            {a.governanceScore}
                                        </span>
                                    ) : (
                                        <span className="text-muted">-</span>
                                    )}
                                </td>
                                <td>
                                    {a.riskIndicator ? (
                                        <span className={`badge badge-${riskColor}`}>
                                            <span className={`dot dot-${riskColor}`} />
                                            {a.riskIndicator.label}
                                        </span>
                                    ) : <span className="text-muted">-</span>}
                                </td>
                                <td>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        {a.status === 'completed' && (
                                            <button className="btn btn-primary btn-sm" onClick={() => onView(a.id)}>
                                                View Results
                                            </button>
                                        )}
                                        {a.status === 'processing' && (
                                            <button className="btn btn-secondary btn-sm" onClick={() => onView(a.id)}>
                                                View Progress
                                            </button>
                                        )}
                                        {a.status === 'failed' && (
                                            <button className="btn btn-secondary btn-sm" onClick={() => onView(a.id)}>
                                                View Error
                                            </button>
                                        )}
                                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(a.id)} title="Delete">
                                            ??
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
