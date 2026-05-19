import React from 'react';

const REPORTS = [
  { icon: '📊', title: 'User Activity Report',    desc: 'Track login frequency, session duration, and activity across all user accounts.' },
  { icon: '🔒', title: 'Access Audit Log',        desc: 'Review who accessed which pages, when, and what actions were performed.' },
  { icon: '📋', title: 'Menu Usage Summary',      desc: 'See which menu sections are most visited and by which roles.' },
  { icon: '📈', title: 'Role Distribution',       desc: 'Visualise how users are distributed across admin, manager, and viewer roles.' },
];

export default function Reports() {
  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2>Reports</h2>
          <p className="page-subtitle">Analytics and audit information for your workspace.</p>
        </div>
      </div>

      <div className="report-grid">
        {REPORTS.map((r, i) => (
          <div key={i} className="report-card" style={{ animationDelay: `${i * 0.07}s` }}>
            <div className="report-card-icon">{r.icon}</div>
            <div className="report-card-body">
              <div className="report-card-title">{r.title}</div>
              <div className="report-card-desc">{r.desc}</div>
            </div>
            <div className="report-card-badge">Coming soon</div>
          </div>
        ))}
      </div>

      <div className="placeholder-state" style={{ paddingTop: 32 }}>
        <div className="placeholder-icon">🚀</div>
        <div className="placeholder-title">Reports are on the way</div>
        <div className="placeholder-text">
          Connect your data sources and enable reporting to see live insights here.
          Reporting features will be available in the next release.
        </div>
      </div>
    </div>
  );
}
