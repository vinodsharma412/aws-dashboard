import React from 'react';

const ICONS = { danger: '🗑', warning: '⚠️', info: 'ℹ️', success: '✅' };

export default function ConfirmModal({
  open, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  variant = 'danger', icon,
  onConfirm, onCancel,
}) {
  if (!open) return null;

  return (
    <div className="modal-overlay confirm-overlay">
      <div className="confirm-modal">
        <div className={`confirm-icon confirm-icon--${variant}`}>
          {icon ?? ICONS[variant] ?? '❓'}
        </div>
        <h3 className="confirm-title">{title}</h3>
        {message && <p className="confirm-message">{message}</p>}
        <div className="confirm-actions">
          <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn btn-${variant}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
