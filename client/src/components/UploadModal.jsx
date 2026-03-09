import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { assessmentApi } from '../api/client';

const ALLOWED_EXTS = ['.pdf', '.docx', '.txt', '.mp3', '.mp4'];
const PIPELINE_STAGES = [
    'Transcript Parsing',
    'Minutes Generation',
    'Key Insights Extraction',
    'Engagement Analysis',
    'Governance Scoring',
];

function getFileExt(name) {
    return name.slice(name.lastIndexOf('.')).toLowerCase();
}

export default function UploadModal({ onClose, onCreated }) {
    const [meetingName, setMeetingName] = useState('');
    const [meetingDate, setMeetingDate] = useState(new Date().toISOString().split('T')[0]);
    const [files, setFiles] = useState([]);
    const [rejections, setRejections] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploaded, setUploaded] = useState(false);
    const [error, setError] = useState('');

    const onDrop = useCallback((accepted, rejected) => {
        const valid = accepted.filter(f => ALLOWED_EXTS.includes(getFileExt(f.name)));
        const invalid = accepted.filter(f => !ALLOWED_EXTS.includes(getFileExt(f.name)));
        setFiles(prev => [...prev, ...valid]);
        const rejNames = [...rejected.map(r => r.file.name), ...invalid.map(f => f.name)];
        if (rejNames.length) setRejections(rejNames);
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'application/pdf': ['.pdf'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'text/plain': ['.txt'],
            'audio/mpeg': ['.mp3'],
            'video/mp4': ['.mp4'],
        },
        multiple: true,
    });

    const removeFile = (index) => setFiles(prev => prev.filter((_, i) => i !== index));

    const handleSubmit = async () => {
        if (!meetingName.trim()) { setError('Please enter a meeting name.'); return; }
        if (files.length === 0) { setError('Please upload at least one supported file.'); return; }
        setError('');
        setUploading(true);

        const fd = new FormData();
        fd.append('meetingName', meetingName.trim());
        fd.append('meetingDate', meetingDate);
        files.forEach(f => fd.append('files', f));

        // Simulate progress
        const progressInterval = setInterval(() => {
            setUploadProgress(p => Math.min(p + 12, 90));
        }, 200);

        try {
            const assessment = await assessmentApi.create(fd);
            clearInterval(progressInterval);
            setUploadProgress(100);
            setUploaded(true);
            setTimeout(() => onCreated(assessment), 600);
        } catch (e) {
            clearInterval(progressInterval);
            setError(e.response?.data?.message || 'Upload failed. Please try again.');
            setUploading(false);
            setUploadProgress(0);
        }
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal">
                <div className="modal-header">
                    <div>
                        <div className="modal-title">Create Board Pack Review</div>
                        <div className="text-sm text-muted" style={{ marginTop: '4px' }}>
                            Upload board meeting transcripts or documents for AI analysis
                        </div>
                    </div>
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>

                {/* Meeting Name */}
                <div className="form-group mb-4">
                    <label className="form-label">Meeting Name *</label>
                    <input
                        className="form-input"
                        placeholder="e.g. Q4 2024 Full Board Meeting"
                        value={meetingName}
                        onChange={e => setMeetingName(e.target.value)}
                        disabled={uploading}
                    />
                </div>

                {/* Meeting Date */}
                <div className="form-group mb-4">
                    <label className="form-label">Meeting Date</label>
                    <input
                        className="form-input"
                        type="date"
                        value={meetingDate}
                        onChange={e => setMeetingDate(e.target.value)}
                        disabled={uploading}
                    />
                </div>

                {/* Dropzone */}
                <div className="form-group mb-4">
                    <label className="form-label">Upload Transcript Files *</label>
                    <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
                        <input {...getInputProps()} />
                        <div className="dropzone-icon">📂</div>
                        <div className="dropzone-label">
                            {isDragActive ? 'Drop files here...' : 'Drag & drop files here, or click to browse'}
                        </div>
                        <div className="dropzone-sub">Supported: PDF, DOCX, TXT, MP3, MP4 · Max 50MB per file</div>
                    </div>

                    {rejections.length > 0 && (
                        <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px' }}>
                            <div className="text-sm text-red">❌ Rejected (unsupported format): {rejections.join(', ')}</div>
                        </div>
                    )}

                    {files.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                            {files.map((f, i) => (
                                <div key={i} className="file-chip">
                                    📄 {f.name}
                                    <span className="file-remove" onClick={() => removeFile(i)}>✕</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Upload Progress */}
                {uploading && (
                    <div className="mb-4">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span className="text-sm text-muted">{uploaded ? 'Upload complete' : 'Uploading files...'}</span>
                            <span className="text-sm text-accent">{uploadProgress}%</span>
                        </div>
                        <div className="progress-bar">
                            <div className="progress-fill progress-fill-blue" style={{ width: `${uploadProgress}%` }} />
                        </div>
                    </div>
                )}

                {/* Pipeline Preview */}
                <div className="mb-6">
                    <div className="form-label" style={{ marginBottom: '10px' }}>Analysis Pipeline</div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {PIPELINE_STAGES.map((s, i) => (
                            <div key={i} style={{
                                padding: '4px 10px',
                                background: 'rgba(59,130,246,0.06)',
                                border: '1px solid rgba(59,130,246,0.15)',
                                borderRadius: '20px',
                                fontSize: '11px', color: 'var(--blue-300)', fontWeight: '500',
                            }}>
                                {i + 1}. {s}
                            </div>
                        ))}
                    </div>
                </div>

                {error && (
                    <div style={{ marginBottom: '16px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px' }}>
                        <div className="text-sm text-red">{error}</div>
                    </div>
                )}

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose} disabled={uploading}>Cancel</button>
                    <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={uploading}>
                        {uploading ? <><span className="spinner" style={{ width: '16px', height: '16px' }} /> Processing...</> : '🚀 Start Analysis'}
                    </button>
                </div>
            </div>
        </div>
    );
}
