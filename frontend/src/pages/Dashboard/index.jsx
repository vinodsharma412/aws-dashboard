import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { emailActionService }              from '../../services/emailActionService';
import { productService }                  from '../../services/productService';
import { scrapingService }                 from '../../services/scrapingService';
import { userService }                     from '../../services/userService';

// ── Greeting ──────────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ── Category / Priority color maps ────────────────────────────────────────────

const CAT_COLOR = {
  request:    '#1890ff',
  issue:      '#ff4d4f',
  complaint:  '#fa541c',
  escalation: '#a8071a',
  inquiry:    '#722ed1',
  sales:      '#52c41a',
  other:      '#8c8c8c',
};
const PRI_COLOR = {
  fatal:    '#a8071a',
  critical: '#ff4d4f',
  medium:   '#faad14',
  low:      '#52c41a',
};

// ── Mini bar chart ─────────────────────────────────────────────────────────────

function MiniBar({ data, colors, total }) {
  if (!data || !total) return <p style={{ color: 'var(--text-3)', fontSize: 12 }}>No data yet.</p>;
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map(([key, val]) => {
        const pct = Math.round((val / total) * 100);
        const color = (colors && colors[key]) || 'var(--primary)';
        return (
          <div key={key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
              <span style={{ textTransform: 'capitalize', color: 'var(--text-2)', fontWeight: 500 }}>{key}</span>
              <span style={{ color: 'var(--text-3)' }}>{val} ({pct}%)</span>
            </div>
            <div style={{ background: 'var(--border-light)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Email preview modal ────────────────────────────────────────────────────────

function EmailModal({ data, onClose, onNavigate }) {
  const d = data || {};
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide dash-preview-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>📧 Email Action Center — Quick View</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="dash-modal-body">
          <div className="dash-modal-stats">
            <div className="dash-mstat dash-mstat--blue">
              <div className="dash-mstat-val">{d.total ?? '—'}</div>
              <div className="dash-mstat-lbl">Total Emails</div>
            </div>
            <div className="dash-mstat dash-mstat--red">
              <div className="dash-mstat-val">{d.unresolved ?? '—'}</div>
              <div className="dash-mstat-lbl">Unresolved</div>
            </div>
            <div className="dash-mstat dash-mstat--green">
              <div className="dash-mstat-val">{d.total != null && d.unresolved != null ? d.total - d.unresolved : '—'}</div>
              <div className="dash-mstat-lbl">Resolved</div>
            </div>
          </div>

          <div className="dash-modal-grid">
            <div className="dash-modal-section">
              <h4>By Category</h4>
              <MiniBar data={d.by_category} colors={CAT_COLOR} total={d.total} />
            </div>
            <div className="dash-modal-section">
              <h4>By Priority</h4>
              <MiniBar data={d.by_priority} colors={PRI_COLOR} total={d.total} />
            </div>
          </div>

          {d.recent && d.recent.length > 0 && (
            <div className="dash-modal-section" style={{ marginTop: 16 }}>
              <h4>Recent Open Emails</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {d.recent.map(m => (
                  <div key={m.id} className="dash-recent-row">
                    <div style={{ minWidth: 0 }}>
                      <div className="dash-recent-subject">{m.subject || '(no subject)'}</div>
                      <div className="dash-recent-meta">{m.sender}</div>
                    </div>
                    <span className="dash-badge" style={{ background: CAT_COLOR[m.category] || '#8c8c8c' }}>
                      {m.category || 'other'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="dash-modal-footer">
          <button className="btn btn-primary" onClick={onNavigate}>Open Full Page →</button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Scraper preview modal ──────────────────────────────────────────────────────

function ScraperModal({ data, onClose, onNavigate }) {
  const jobs = data || [];
  const total   = jobs.length;
  const active  = jobs.filter(j => j.pending > 0 || j.running > 0).length;
  const done    = jobs.filter(j => j.pending === 0 && j.running === 0 && j.failed === 0).length;
  const partial = jobs.filter(j => j.pending === 0 && j.running === 0 && j.failed > 0 && j.completed > 0).length;
  const failed  = jobs.filter(j => j.pending === 0 && j.running === 0 && j.completed === 0 && j.failed > 0).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal dash-preview-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🛒 Amazon Scraper — Quick View</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="dash-modal-body">
          <div className="dash-modal-stats">
            <div className="dash-mstat dash-mstat--blue">
              <div className="dash-mstat-val">{total}</div>
              <div className="dash-mstat-lbl">Total Jobs</div>
            </div>
            <div className="dash-mstat dash-mstat--orange">
              <div className="dash-mstat-val">{active}</div>
              <div className="dash-mstat-lbl">Active</div>
            </div>
            <div className="dash-mstat dash-mstat--green">
              <div className="dash-mstat-val">{done}</div>
              <div className="dash-mstat-lbl">Completed</div>
            </div>
          </div>

          <div className="dash-modal-section" style={{ marginTop: 12 }}>
            <h4>Job Breakdown</h4>
            <MiniBar
              data={{ active, completed: done, partial, failed }}
              colors={{ active: '#1890ff', completed: '#52c41a', partial: '#faad14', failed: '#ff4d4f' }}
              total={total || 1}
            />
          </div>

          <div className="dash-modal-section" style={{ marginTop: 16 }}>
            <h4>Recent Jobs</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {jobs.slice(0, 5).map(job => {
                const st = job.pending === 0 && job.running === 0
                  ? job.failed === 0 ? 'done' : job.completed === 0 ? 'failed' : 'partial'
                  : job.running > 0 ? 'running' : 'queued';
                const stColor = { done: '#52c41a', failed: '#ff4d4f', partial: '#faad14', running: '#1890ff', queued: '#8c8c8c' }[st] || '#8c8c8c';
                return (
                  <div key={job.id} className="dash-recent-row">
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Job #{job.id}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{job.total} ASINs · {job.completed + job.failed}/{job.total} processed</div>
                    </div>
                    <span className="dash-badge" style={{ background: stColor }}>{st}</span>
                  </div>
                );
              })}
              {jobs.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-3)' }}>No scraping jobs yet.</p>}
            </div>
          </div>
        </div>
        <div className="dash-modal-footer">
          <button className="btn btn-primary" onClick={onNavigate}>Open Full Page →</button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Products preview modal ─────────────────────────────────────────────────────

function ProductsModal({ data, onClose, onNavigate }) {
  const products = data || [];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal dash-preview-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>📦 Product Master — Quick View</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="dash-modal-body">
          <div className="dash-modal-stats">
            <div className="dash-mstat dash-mstat--green">
              <div className="dash-mstat-val">{products.length}</div>
              <div className="dash-mstat-lbl">Total Products</div>
            </div>
            <div className="dash-mstat dash-mstat--blue">
              <div className="dash-mstat-val">{products.filter(p => p.is_active !== false).length}</div>
              <div className="dash-mstat-lbl">Active</div>
            </div>
            <div className="dash-mstat dash-mstat--orange">
              <div className="dash-mstat-val">{products.filter(p => p.keywords && p.keywords.length > 0).length}</div>
              <div className="dash-mstat-lbl">With Keywords</div>
            </div>
          </div>

          <div className="dash-modal-section" style={{ marginTop: 16 }}>
            <h4>Recent Products</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {products.slice(0, 5).map(p => (
                <div key={p.id} className="dash-recent-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="dash-recent-subject">{p.title || p.asin || '—'}</div>
                    <div className="dash-recent-meta">ASIN: {p.asin || '—'} · {p.brand || ''}</div>
                  </div>
                  {p.keywords && p.keywords.length > 0 && (
                    <span className="dash-badge" style={{ background: '#722ed1' }}>{p.keywords.length} kw</span>
                  )}
                </div>
              ))}
              {products.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-3)' }}>No products yet.</p>}
            </div>
          </div>
        </div>
        <div className="dash-modal-footer">
          <button className="btn btn-primary" onClick={onNavigate}>Open Full Page →</button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Users preview modal ────────────────────────────────────────────────────────

function UsersModal({ data, onClose, onNavigate }) {
  const users = data || [];
  const active   = users.filter(u => u.is_active).length;
  const byRole   = users.reduce((acc, u) => { acc[u.role] = (acc[u.role] || 0) + 1; return acc; }, {});
  const roleColors = { admin: '#ff4d4f', manager: '#1890ff', viewer: '#52c41a' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal dash-preview-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>👥 Users — Quick View</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="dash-modal-body">
          <div className="dash-modal-stats">
            <div className="dash-mstat dash-mstat--purple">
              <div className="dash-mstat-val">{users.length}</div>
              <div className="dash-mstat-lbl">Total Users</div>
            </div>
            <div className="dash-mstat dash-mstat--green">
              <div className="dash-mstat-val">{active}</div>
              <div className="dash-mstat-lbl">Active</div>
            </div>
            <div className="dash-mstat dash-mstat--red">
              <div className="dash-mstat-val">{users.length - active}</div>
              <div className="dash-mstat-lbl">Inactive</div>
            </div>
          </div>

          <div className="dash-modal-section" style={{ marginTop: 12 }}>
            <h4>By Role</h4>
            <MiniBar data={byRole} colors={roleColors} total={users.length || 1} />
          </div>

          <div className="dash-modal-section" style={{ marginTop: 16 }}>
            <h4>User List</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {users.slice(0, 5).map(u => (
                <div key={u.id} className="dash-recent-row">
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{u.full_name || u.username}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>@{u.username} · {u.email || '—'}</div>
                  </div>
                  <span className="dash-badge" style={{ background: roleColors[u.role] || '#8c8c8c' }}>{u.role}</span>
                </div>
              ))}
              {users.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-3)' }}>No users found.</p>}
            </div>
          </div>
        </div>
        <div className="dash-modal-footer">
          <button className="btn btn-primary" onClick={onNavigate}>Open Full Page →</button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Simple info modal (Reports, Menus, Menu Access, Settings) ──────────────────

function SimpleModal({ feature, onClose, onNavigate }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal dash-preview-modal dash-preview-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{feature.icon} {feature.title}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="dash-modal-body">
          <div className="dash-simple-info">
            <div className="dash-simple-icon">{feature.icon}</div>
            <p className="dash-simple-desc">{feature.desc}</p>
            {feature.bullets && (
              <ul className="dash-simple-bullets">
                {feature.bullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            )}
          </div>
        </div>
        <div className="dash-modal-footer">
          <button className="btn btn-primary" onClick={onNavigate}>Open {feature.title} →</button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Feature card ───────────────────────────────────────────────────────────────

function FeatureCard({ feature, stat, onPreview, onOpen, style }) {
  return (
    <div className={`hub-card hub-card--${feature.color}`} style={style}>
      <div className="hub-card-accent" />
      <div className="hub-card-top">
        <div className="hub-card-icon">{feature.icon}</div>
        {stat != null && (
          <div className="hub-card-stat">{stat}</div>
        )}
      </div>
      <div className="hub-card-body">
        <h3 className="hub-card-title">{feature.title}</h3>
        <p className="hub-card-desc">{feature.desc}</p>
      </div>
      <div className="hub-card-actions">
        <button className="btn btn-sm btn-secondary" onClick={onPreview}>
          Quick View
        </button>
        <button className={`btn btn-sm btn-${feature.color === 'red' ? 'danger' : 'primary'}`} onClick={onOpen}>
          Open →
        </button>
      </div>
    </div>
  );
}

// ── Dashboard main ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, menus } = useAuth();
  const navigate = useNavigate();

  const isAdmin   = user?.role === 'admin';
  const isManager = user?.role === 'manager';

  // Fetched data
  const [emailDash,  setEmailDash]  = useState(null);
  const [products,   setProducts]   = useState(null);
  const [scraperJobs, setScraperJobs] = useState(null);
  const [users,      setUsers]      = useState(null);
  const [loading,    setLoading]    = useState(true);

  // Modal state
  const [openModal, setOpenModal] = useState(null); // 'email' | 'scraper' | 'products' | 'users' | feature.id

  useEffect(() => {
    const fetches = [
      emailActionService.dashboard().then(r => setEmailDash(r.data)).catch(() => {}),
      productService.list().then(r => setProducts(r.data)).catch(() => {}),
      scrapingService.listJobs().then(r => setScraperJobs(r.data)).catch(() => {}),
    ];
    if (isAdmin || isManager) {
      fetches.push(userService.listUsers().then(r => setUsers(r.data)).catch(() => {}));
    }
    Promise.all(fetches).finally(() => setLoading(false));
  }, [isAdmin, isManager]);

  const closeModal = useCallback(() => setOpenModal(null), []);

  // Top summary stats
  const topStats = [
    { label: 'Emails',   value: emailDash?.total   ?? '—', icon: '📧', color: 'blue'   },
    { label: 'Products', value: products?.length    ?? '—', icon: '📦', color: 'green'  },
    { label: 'Jobs',     value: scraperJobs?.length ?? '—', icon: '🛒', color: 'orange' },
    (isAdmin || isManager)
      ? { label: 'Users', value: users?.length ?? '—', icon: '👥', color: 'purple' }
      : { label: 'Unresolved', value: emailDash?.unresolved ?? '—', icon: '🔔', color: 'red' },
  ];

  // Feature definitions
  const features = [
    {
      id: 'email',
      icon: '📧',
      title: 'Email Action Center',
      desc: 'Manage incoming emails, AI analysis, smart summaries, and response tracking.',
      color: 'blue',
      path: '/email-action',
      stat: emailDash?.total,
      statLabel: 'emails',
      modal: 'email',
    },
    {
      id: 'scraper',
      icon: '🛒',
      title: 'Amazon Scraper',
      desc: 'Scrape Amazon.in product data with Playwright. Track jobs, progress, and results.',
      color: 'orange',
      path: '/scraper',
      stat: scraperJobs?.length,
      statLabel: 'jobs',
      modal: 'scraper',
    },
    {
      id: 'products',
      icon: '📦',
      title: 'Product Master',
      desc: 'Manage product listings with AI-highlighted keyword tracking and SEO tools.',
      color: 'green',
      path: '/product-master',
      stat: products?.length,
      statLabel: 'products',
      modal: 'products',
      roles: ['admin', 'manager'],
    },
    {
      id: 'stocks',
      icon: '📈',
      title: 'NSE Stock Dashboard',
      desc: 'Screen quality dividend stocks, get AI Buy/Hold/Sell signals, track your portfolio P&L.',
      color: 'teal',
      path: '/stocks',
      modal: 'simple',
      bullets: ['Dividend yield screener', 'RSI / MACD / Bollinger Bands', 'Portfolio P&L tracker', 'News sentiment analysis'],
    },
    {
      id: 'reports',
      icon: '📊',
      title: 'Reports',
      desc: 'View analytics, usage summaries, and export data for decision-making.',
      color: 'teal',
      path: '/reports',
      modal: 'simple',
      bullets: ['Usage analytics', 'Export to CSV/Excel', 'Custom date ranges'],
    },
    {
      id: 'users',
      icon: '👥',
      title: 'Users',
      desc: 'Create and manage user accounts, assign roles, and control access.',
      color: 'purple',
      path: '/users',
      stat: users?.length,
      statLabel: 'users',
      modal: 'users',
      roles: ['admin', 'manager'],
    },
    {
      id: 'menus',
      icon: '📋',
      title: 'Menus',
      desc: 'Configure navigation menus and define available routes for each role.',
      color: 'gray',
      path: '/menus',
      modal: 'simple',
      bullets: ['Add/edit nav items', 'Set icons and paths', 'Order management'],
      roles: ['admin'],
    },
    {
      id: 'menu-access',
      icon: '🔐',
      title: 'Menu Access',
      desc: 'Control which roles can access each menu item and feature.',
      color: 'indigo',
      path: '/menu-access',
      modal: 'simple',
      bullets: ['Role-based access', 'Per-menu permissions', 'Dynamic control'],
      roles: ['admin'],
    },
    {
      id: 'settings',
      icon: '⚙️',
      title: 'Settings',
      desc: 'Configure application settings, integrations, and preferences.',
      color: 'gray',
      path: '/settings',
      modal: 'simple',
      bullets: ['App configuration', 'Integration settings', 'System preferences'],
      roles: ['admin'],
    },
  ].filter(f => {
    if (!f.roles) return true;
    return f.roles.includes(user?.role);
  });

  const displayName = user?.full_name || user?.username || 'there';
  const greeting    = getGreeting();

  return (
    <div className="page-content">
      {/* ── Welcome banner ── */}
      <div className="welcome-banner">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="welcome-greeting">{greeting}, {displayName}!</div>
            <div className="welcome-sub">Here's your workspace overview. Quick-view or open any module below.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="welcome-role">{user?.role}</span>
            {emailDash?.unresolved > 0 && (
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 12px', background: 'rgba(255,77,79,0.2)',
                  border: '1px solid rgba(255,77,79,0.4)', borderRadius: 'var(--r-pill)',
                  fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer',
                }}
                onClick={() => navigate('/email-action')}
                title="Go to Email Action Center"
              >
                🔔 {emailDash.unresolved} unresolved
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Summary stat cards ── */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {topStats.map((s, i) => (
          <div key={i} className={`stat-card stat-card--${s.color}`} style={{ animationDelay: `${i * 0.06}s` }}>
            <div className="stat-icon-wrap">{s.icon}</div>
            <div className="stat-body">
              <div className="stat-value">{loading ? <span className="spinner spinner--sm" /> : s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Feature hub ── */}
      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-2)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 4, height: 18, background: 'var(--primary)', borderRadius: 2, display: 'inline-block' }} />
        All Features
      </h3>

      <div className="hub-grid">
        {features.map((f, i) => (
          <FeatureCard
            key={f.id}
            feature={f}
            stat={f.stat}
            style={{ animationDelay: `${i * 0.05 + 0.1}s` }}
            onPreview={() => setOpenModal(f.id)}
            onOpen={() => navigate(f.path)}
          />
        ))}
      </div>

      {/* ── Profile quick view ── */}
      <div className="info-cards" style={{ marginTop: 24 }}>
        <div className="info-card">
          <h3>👤 Profile</h3>
          {[
            { label: 'Username',  value: user?.username },
            { label: 'Full Name', value: user?.full_name || '—' },
            { label: 'Email',     value: user?.email || '—' },
            { label: 'Role',      value: user?.role },
            { label: 'Status',    value: user?.is_active ? '● Active' : '● Inactive',
              style: { color: user?.is_active ? 'var(--success)' : 'var(--danger)', fontWeight: 600 } },
          ].map(row => (
            <div key={row.label} className="info-row">
              <span className="info-row-label">{row.label}</span>
              <span className="info-row-value" style={row.style}>{row.value}</span>
            </div>
          ))}
        </div>

        <div className="info-card">
          <h3>🧭 Navigation</h3>
          {menus.length === 0
            ? <p style={{ color: 'var(--text-3)', fontSize: 13 }}>No menus configured yet.</p>
            : menus.map(m => (
              <div
                key={m.path}
                className="info-row"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(m.path)}
                title={`Go to ${m.name}`}
              >
                <span className="info-row-label">{m.icon} {m.name}</span>
                <span className="info-row-value" style={{ fontSize: 12, color: 'var(--primary)' }}>
                  {m.path} →
                </span>
              </div>
            ))
          }
        </div>
      </div>

      {/* ── Modals ── */}
      {openModal === 'email' && (
        <EmailModal
          data={emailDash}
          onClose={closeModal}
          onNavigate={() => { closeModal(); navigate('/email-action'); }}
        />
      )}
      {openModal === 'scraper' && (
        <ScraperModal
          data={scraperJobs}
          onClose={closeModal}
          onNavigate={() => { closeModal(); navigate('/scraper'); }}
        />
      )}
      {openModal === 'products' && (
        <ProductsModal
          data={products}
          onClose={closeModal}
          onNavigate={() => { closeModal(); navigate('/product-master'); }}
        />
      )}
      {openModal === 'users' && (
        <UsersModal
          data={users}
          onClose={closeModal}
          onNavigate={() => { closeModal(); navigate('/users'); }}
        />
      )}
      {['reports', 'menus', 'menu-access', 'settings'].includes(openModal) && (() => {
        const f = features.find(x => x.id === openModal);
        return f ? (
          <SimpleModal
            feature={f}
            onClose={closeModal}
            onNavigate={() => { closeModal(); navigate(f.path); }}
          />
        ) : null;
      })()}
    </div>
  );
}
