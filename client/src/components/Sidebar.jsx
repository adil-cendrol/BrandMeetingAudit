import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
    {
        id: 'board-pack',
        label: 'Board Pack Review',
        sub: 'Document Analysis',
        icon: '📋',
        path: '/',
        badge: 'Active',
        badgeClass: 'active-badge',
        locked: false,
    },
    {
        id: 'board-eval',
        label: 'Board Evaluation',
        sub: 'Director Performance',
        icon: '👥',
        path: '/board-evaluation',
        badge: 'Locked',
        badgeClass: 'locked-badge',
        locked: true,
    },
    {
        id: 'maturity',
        label: 'Board Maturity',
        sub: 'Governance Maturity',
        icon: '📈',
        path: '/maturity',
        badge: 'Locked',
        badgeClass: 'locked-badge',
        locked: true,
    },
];

export default function Sidebar() {
    const navigate = useNavigate();
    const location = useLocation();

    const isActive = (item) => {
        if (item.path === '/') return location.pathname === '/' || location.pathname.startsWith('/assessments') || location.pathname.startsWith('/processing') || location.pathname.startsWith('/results');
        return location.pathname.startsWith(item.path);
    };

    return (
        <aside className="sidebar">
            {/* Logo */}
            <div className="sidebar-logo">
                <div className="logo-icon">⚖️</div>
                <div className="logo-text">
                    <span className="logo-name">BoardPack</span>
                    <span className="logo-tagline">Board Pack Review System</span>
                </div>
            </div>

            {/* Navigation */}
            <div className="sidebar-nav">
                <div className="sidebar-section">Modules</div>
                {NAV_ITEMS.map(item => (
                    <div
                        key={item.id}
                        className={`nav-item ${item.locked ? 'locked' : ''} ${isActive(item) ? 'active' : ''}`}
                        onClick={() => !item.locked && navigate(item.path)}
                        title={item.locked ? 'Coming soon' : item.label}
                    >
                        <span className="nav-item-icon">{item.icon}</span>
                        <div className="nav-item-content">
                            <div className="nav-item-label">{item.label}</div>
                            <div className="nav-item-sub">{item.sub}</div>
                        </div>
                        <span className={`nav-badge ${item.badgeClass}`}>{item.badge}</span>
                    </div>
                ))}

                {/* <div className="sidebar-section" style={{ marginTop: '24px' }}>Settings</div> */}
                {/* <div className="nav-item">
                    <span className="nav-item-icon">⚙️</span>
                    <div className="nav-item-content">
                        <div className="nav-item-label">Preferences</div>
                    </div>
                </div> */}
                {/* <div className="nav-item">
                    <span className="nav-item-icon">🏢</span>
                    <div className="nav-item-content">
                        <div className="nav-item-label">Organisation</div>
                    </div>
                </div> */}
            </div>

            {/* Footer */}
            <div className="sidebar-footer">
                <div className="avatar">R</div>
                <div className="user-info">
                    <div className="user-name">Rehan</div>
                    <div className="user-role">Company Secretary</div>
                </div>
            </div>
        </aside>
    );
}

