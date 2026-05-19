import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function Unauthorized() {
  const navigate = useNavigate();
  return (
    <div className="unauthorized-page">
      <div className="unauthorized-card">
        <div className="unauthorized-code">403</div>
        <h2 className="unauthorized-title">Access Denied</h2>
        <p className="unauthorized-text">
          You don't have permission to view this page.<br />
          Please contact your administrator if you believe this is a mistake.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/')}>
            🏠 Go to Dashboard
          </button>
          <button className="btn btn-secondary btn-lg" onClick={() => navigate(-1)}>
            ← Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
