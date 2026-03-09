import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { assessmentApi } from '../api/client';
import AssessmentTable from '../components/AssessmentTable';
import UploadModal from '../components/UploadModal';

const STATS = [
    { icon: '📋', label: 'Total Reviews', valueKey: 'total', color: 'var(--blue-300)' },
    { icon: '✅', label: 'Completed', valueKey: 'completed', color: 'var(--emerald-400)' },
    { icon: '⚡', label: 'Processing', valueKey: 'processing', color: 'var(--amber-400)' },
    { icon: '🎯', label: 'Avg Score', valueKey: 'avgScore', color: 'var(--blue-300)' },
];

export default function Dashboard() {
    const navigate = useNavigate();
    const [showModal, setShowModal] = useState(false);
    const [assessments, setAssessments] = useState([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const data = await assessmentApi.getAll();
            setAssessments(data);
        } catch (e) {
            console.error('Failed to load assessments:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const interval = setInterval(load, 5000);
        return () => clearInterval(interval);
    }, [load]);

    const handleCreated = (assessment) => {
        setShowModal(false);
        navigate(`/processing/${assessment.id}`);
    };

    const stats = {
        total: assessments.length,
        completed: assessments.filter(a => a.status === 'completed').length,
        processing: assessments.filter(a => a.status === 'processing').length,
        avgScore: (() => {
            const scored = assessments.filter(a => a.governanceScore != null);
            return scored.length ? Math.round(scored.reduce((s, a) => s + a.governanceScore, 0) / scored.length) : '—';
        })(),
    };

    return (
        <div className="page-container">
            {/* Header */}
            <div className="page-header">
                <div className="page-breadcrumb">
                    <span>🏠 Home</span>
                    <span style={{ opacity: 0.4 }}>/</span>
                    <span style={{ color: 'var(--accent)' }}>Board Pack Review</span>
                </div>
                <h1 className="page-title">BoardPack – Board Pack Review System</h1>
                <div className="page-description">
                    AI-powered board pack analysis delivering structured governance insights, meeting minutes, and compliance scoring.
                </div>
            </div>

            {/* Welcome Hero */}
            <div className="welcome-hero">
                <div className="welcome-org">🏛️ Meridian Capital Group plc</div>
                <h2 className="welcome-title">
                    Board Pack Review<br />
                    <span>Powered by AI Governance</span>
                </h2>
                <p className="welcome-desc">
                    Upload board meeting transcripts or pack documents to automatically generate structured governance insights, risk flags, meeting minutes, and a weighted governance score — all backed by transcript evidence.
                </p>
                <button className="btn btn-primary btn-xl" onClick={() => setShowModal(true)}>
                    📤 Upload Board Transcript
                </button>
            </div>

            {/* Stats */}
            <div className="stat-grid mb-8">
                {STATS.map(s => (
                    <div key={s.label} className="stat-card">
                        <div className="stat-icon">{s.icon}</div>
                        <div className="stat-value" style={{ color: s.color }}>{stats[s.valueKey]}</div>
                        <div className="stat-label">{s.label}</div>
                    </div>
                ))}
            </div>

            {/* Assessments Table */}
            <div className="card">
                <div className="card-header">
                    <div>
                        <div className="card-title">Recent Assessments</div>
                        <div className="card-subtitle">All board pack reviews for your organisation</div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="btn btn-secondary btn-sm" onClick={load}>🔄 Refresh</button>
                        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ New Review</button>
                    </div>
                </div>
                {loading ? (
                    <div style={{ padding: '40px', textAlign: 'center' }}>
                        <div className="spinner" style={{ width: '32px', height: '32px', margin: '0 auto' }} />
                        <div className="text-sm text-muted" style={{ marginTop: '12px' }}>Loading assessments...</div>
                    </div>
                ) : (
                    <AssessmentTable
                        assessments={assessments}
                        onView={id => {
                            const a = assessments.find(x => x.id === id);
                            if (a?.status === 'completed') navigate(`/results/${id}`);
                            else navigate(`/processing/${id}`);
                        }}
                        onRefresh={load}
                    />
                )}
            </div>

            {showModal && (
                <UploadModal
                    onClose={() => setShowModal(false)}
                    onCreated={handleCreated}
                />
            )}
        </div>
    );
}
