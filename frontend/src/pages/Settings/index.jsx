import React from 'react';
import { useAuth } from '../../context/AuthContext';

const AVATAR_COLORS = ['#1890ff','#52c41a','#faad14','#f5222d','#722ed1','#13c2c2','#eb2f96'];
function avatarColor(name = '') { return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length]; }
function getInitials(name = '') { return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?'; }

export default function Settings() {
  const { user } = useAuth();
  const displayName = user?.full_name || user?.username || '';

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2>Settings</h2>
          <p className="page-subtitle">Manage your account and application preferences.</p>
        </div>
      </div>

      {/* Profile card */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, padding: '20px', background: 'var(--bg)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
        <div
          className="avatar avatar-lg"
          style={{ background: avatarColor(displayName), color: '#fff', flexShrink: 0 }}
        >
          {getInitials(displayName)}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{displayName}</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>{user?.email || 'No email set'}</div>
          <span className={`badge badge-${user?.role}`} style={{ marginTop: 6 }}>{user?.role}</span>
        </div>
      </div>

      {/* Account info */}
      <div className="settings-section">
        <div className="settings-section-header">👤 Account Information</div>
        <div className="settings-row">
          <span className="settings-row-label">Username</span>
          <span className="settings-row-value">{user?.username}</span>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Full Name</span>
          <span className="settings-row-value">{user?.full_name || <span style={{color:'var(--text-3)'}}>Not set</span>}</span>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Email</span>
          <span className="settings-row-value">{user?.email || <span style={{color:'var(--text-3)'}}>Not set</span>}</span>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Account Status</span>
          <span className={`status-dot status-dot--${user?.is_active ? 'active' : 'inactive'}`}>
            {user?.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Member Since</span>
          <span className="settings-row-value">
            {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
          </span>
        </div>
      </div>

      {/* Permissions */}
      <div className="settings-section">
        <div className="settings-section-header">🔑 Permissions</div>
        <div className="settings-row">
          <span className="settings-row-label">Role</span>
          <span className={`badge badge-${user?.role}`}>{user?.role}</span>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Admin Access</span>
          <span className={`status-dot status-dot--${user?.is_admin ? 'active' : 'inactive'}`}>
            {user?.is_admin ? 'Yes' : 'No'}
          </span>
        </div>
      </div>

      {/* Coming soon */}
      <div className="settings-section">
        <div className="settings-section-header">⚙️ Preferences</div>
        <div className="settings-row">
          <span className="settings-row-label">Theme</span>
          <span className="settings-row-value" style={{ color: 'var(--text-3)' }}>Coming soon</span>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Language</span>
          <span className="settings-row-value" style={{ color: 'var(--text-3)' }}>Coming soon</span>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Change Password</span>
          <span className="settings-row-value" style={{ color: 'var(--text-3)' }}>Coming soon</span>
        </div>
      </div>
    </div>
  );
}
