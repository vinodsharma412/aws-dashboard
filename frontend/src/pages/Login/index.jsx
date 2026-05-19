import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const { login } = useAuth();
  const navigate  = useNavigate();

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch {
      setError('Invalid username or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">

        {/* ── Left branding panel ── */}
        <div className="login-brand">
          <div className="login-brand-logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <polyline points="2,24 10,14 16,18 24,8 30,12"
                stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="30" cy="12" r="2.5" fill="#fadb14"/>
            </svg>
          </div>
          <h1 className="login-brand-title">NSE Dashboard</h1>
          <p className="login-brand-desc">
            Real-time market intelligence for smarter investing
          </p>
          <ul className="login-brand-features">
            <li><span className="feat-icon">📈</span> Live NSE market data</li>
            <li><span className="feat-icon">🔍</span> Advanced stock screener</li>
            <li><span className="feat-icon">📊</span> Technical analysis</li>
            <li><span className="feat-icon">🔔</span> Smart price alerts</li>
          </ul>
        </div>

        {/* ── Right form panel ── */}
        <div className="login-form-panel">
          <div className="login-form-header">
            <h2>Welcome back</h2>
            <p>Sign in to continue to your dashboard</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            {error && (
              <div className="alert alert--error">
                <span className="alert-icon">⚠</span>
                {error}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="login-username">Username</label>
              <div className="input-wrapper">
                <span className="input-icon">👤</span>
                <input
                  id="login-username"
                  className="form-input"
                  type="text"
                  placeholder="Enter your username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="login-password">Password</label>
              <div className="input-wrapper">
                <span className="input-icon">🔒</span>
                <input
                  id="login-password"
                  className="form-input has-toggle"
                  type={showPass ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="input-toggle"
                  onClick={() => setShowPass(v => !v)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <button type="submit" className="login-btn" disabled={loading}>
              {loading && <span className="spinner spinner--sm spinner--white" />}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="login-footer">
            Secure · Encrypted · © {new Date().getFullYear()} NSE Dashboard
          </div>
        </div>

      </div>
    </div>
  );
}
