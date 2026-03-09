import React, { useEffect, useRef } from 'react';

export default function EvidenceDrawer({ isOpen, onClose, evidence }) {
    const drawerRef = useRef(null);

    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <>
            {/* Backdrop */}
            {isOpen && (
                <div
                    onClick={onClose}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 199, backdropFilter: 'blur(2px)' }}
                />
            )}
            <div ref={drawerRef} className={`evidence-drawer ${isOpen ? 'open' : ''}`}>
                <div className="evidence-header">
                    <div>
                        <div className="evidence-title">📎 Evidence Panel</div>
                        <div className="text-sm text-muted" style={{ marginTop: '2px' }}>Source transcript references</div>
                    </div>
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>

                <div className="evidence-body">
                    {!evidence || evidence.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                            <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.3 }}>🔍</div>
                            <div className="text-sm text-muted">Click any insight, flag, or evidence reference to view the source transcript excerpt.</div>
                        </div>
                    ) : (
                        evidence.map(ev => (
                            <div key={ev.id} className="evidence-card">
                                <div className="evidence-id">
                                    <span style={{ background: 'var(--accent)', color: 'white', padding: '2px 8px', borderRadius: '4px', marginRight: '8px', fontSize: '10px' }}>
                                        {ev.id}
                                    </span>
                                    Transcript Evidence
                                </div>
                                <div className="evidence-meta">
                                    <span>🎤 {ev.speaker}</span>
                                    <span>⏱️ {ev.timestamp}</span>
                                </div>
                                <div className="evidence-excerpt">"{ev.excerpt}"</div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </>
    );
}
