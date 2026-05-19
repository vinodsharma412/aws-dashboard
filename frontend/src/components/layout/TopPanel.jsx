import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { userService } from '../../services/userService';
import { BACKEND_URL } from '../../utils/constants';

const AVATAR_COLORS = ['#1890ff','#52c41a','#faad14','#f5222d','#722ed1','#13c2c2','#eb2f96'];

function getInitials(name = '') {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';
}
function avatarColor(name = '') {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}

function TopPanel({ onToggleSidebar }) {
  const { user, logout, updateUser } = useAuth();
  const navigate  = useNavigate();
  const fileRef   = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [imgError,  setImgError]  = useState(false);

  const displayName = user?.full_name || user?.username || '';
  const initials    = getInitials(displayName);
  const bgColor     = avatarColor(displayName);
  const avatarSrc   = user?.avatar_url && !imgError
    ? `${BACKEND_URL}${user.avatar_url}`
    : null;

  const handleAvatarClick = () => fileRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await userService.uploadAvatar(file);
      updateUser({ avatar_url: res.data.avatar_url });
      setImgError(false);
    } catch {
      // silent — keep old avatar
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="top-panel">
      <div className="top-left">
        <button className="hamburger" onClick={onToggleSidebar} aria-label="Toggle menu">
          <span /><span /><span />
        </button>
        <span className="app-title">MyApp</span>
      </div>

      <div className="top-right">
        <div className="topbar-user">
          <span className="topbar-name">{displayName}</span>

          {/* Avatar — click to upload */}
          <div
            className={`avatar-upload-wrap${uploading ? ' avatar-upload-wrap--uploading' : ''}`}
            onClick={handleAvatarClick}
            title="Click to change photo"
          >
            {avatarSrc ? (
              <img
                className="avatar avatar-sm avatar-img"
                src={avatarSrc}
                alt={displayName}
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="avatar avatar-sm" style={{ background: bgColor, color: '#fff' }}>
                {uploading ? <span className="spinner spinner--sm spinner--white" /> : initials}
              </div>
            )}
            {uploading && avatarSrc && (
              <div className="avatar-upload-overlay">
                <span className="spinner spinner--sm spinner--white" />
              </div>
            )}
            {!uploading && (
              <div className="avatar-upload-overlay avatar-upload-overlay--hover">
                <span className="avatar-camera-icon">📷</span>
              </div>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        <button className="btn-logout" onClick={() => { logout(); navigate('/login'); }}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export default TopPanel;
