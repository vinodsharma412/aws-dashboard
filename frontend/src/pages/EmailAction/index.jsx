import React, { useCallback, useEffect, useRef, useState } from 'react';
import { emailActionService } from '../../services/emailActionService';
import usePagination from '../../hooks/usePagination';
import Pagination from '../../components/common/Pagination';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = ['request', 'issue', 'sales', 'inquiry', 'escalation', 'complaint', 'other'];
const PRIORITIES = ['fatal', 'critical', 'medium', 'low'];
const STATUSES   = ['new', 'in_progress', 'resolved', 'closed'];

const CAT_COLOR = {
  request:    '#3b82f6',
  issue:      '#ef4444',
  sales:      '#10b981',
  inquiry:    '#8b5cf6',
  escalation: '#f97316',
  complaint:  '#ec4899',
  other:      '#6b7280',
};
const PRI_COLOR = {
  fatal:    '#dc2626',
  critical: '#ea580c',
  medium:   '#d97706',
  low:      '#16a34a',
};
const STAT_COLOR = {
  new:         '#3b82f6',
  in_progress: '#f59e0b',
  resolved:    '#10b981',
  closed:      '#6b7280',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString();
}

function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString();
}

function cap(s) {
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ');
}

// ── Badges ────────────────────────────────────────────────────────────────────

function CatBadge({ value }) {
  if (!value) return <span style={{ color: '#9ca3af' }}>—</span>;
  return (
    <span style={{
      background: CAT_COLOR[value] || '#6b7280',
      color: '#fff',
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 10,
      textTransform: 'capitalize',
    }}>{value}</span>
  );
}

function PriBadge({ value }) {
  if (!value) return <span style={{ color: '#9ca3af' }}>—</span>;
  return (
    <span style={{
      border: `1.5px solid ${PRI_COLOR[value] || '#6b7280'}`,
      color: PRI_COLOR[value] || '#6b7280',
      fontSize: 11,
      fontWeight: 700,
      padding: '2px 8px',
      borderRadius: 10,
      textTransform: 'capitalize',
    }}>{value}</span>
  );
}

function StatBadge({ value }) {
  if (!value) return <span style={{ color: '#9ca3af' }}>—</span>;
  return (
    <span style={{
      background: `${STAT_COLOR[value] || '#6b7280'}22`,
      color: STAT_COLOR[value] || '#6b7280',
      fontSize: 11,
      fontWeight: 700,
      padding: '2px 8px',
      borderRadius: 10,
      textTransform: 'capitalize',
    }}>{cap(value)}</span>
  );
}

function SentBadge({ value }) {
  const map = { positive: { bg: '#dcfce7', color: '#15803d', label: '+ Positive' },
                neutral:  { bg: '#f3f4f6', color: '#374151', label: '± Neutral' },
                negative: { bg: '#fee2e2', color: '#b91c1c', label: '− Negative' } };
  const s = map[value];
  if (!s) return null;
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 600,
                   padding: '2px 8px', borderRadius: 10 }}>{s.label}</span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color = 'blue' }) {
  return (
    <div className={`stat-card stat-card--${color}`}>
      <div className="stat-icon-wrap">{icon}</div>
      <div className="stat-body">
        <div className="stat-value">{value ?? '—'}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

// ── Category breakdown bar ────────────────────────────────────────────────────

function CategoryBar({ byCategory, total }) {
  if (!total) return null;
  return (
    <div style={{ display: 'flex', gap: 4, height: 10, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
      {CATEGORIES.map(cat => {
        const n = byCategory[cat] || 0;
        if (!n) return null;
        const pct = (n / total) * 100;
        return (
          <div key={cat} title={`${cap(cat)}: ${n}`}
               style={{ width: `${pct}%`, background: CAT_COLOR[cat], minWidth: 3 }} />
        );
      })}
    </div>
  );
}

// ── Smart Summary helpers ─────────────────────────────────────────────────────

function SummaryCard({ icon, label, value }) {
  return (
    <div style={{
      border: `1.5px solid ${value ? 'var(--border)' : '#f3f4f6'}`,
      borderRadius: 8, padding: '10px 14px',
      background: value ? '#fff' : '#fafafa',
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <span style={{ fontSize: 20, lineHeight: 1, marginTop: 2, flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 3, fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: value ? 'var(--text)' : '#d1d5db',
                      wordBreak: 'break-word' }}>
          {value || '—'}
        </div>
      </div>
    </div>
  );
}

function SummaryBlock({ icon, label, value, bg, border, color, labelColor, empty }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: labelColor, marginBottom: 6,
                    display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{icon}</span> {label}
      </div>
      {value ? (
        <div style={{ background: bg, border: `1.5px solid ${border}`, borderRadius: 8,
                      padding: '10px 14px', fontSize: 13, color, lineHeight: 1.65 }}>
          {value}
        </div>
      ) : (
        <div style={{ color: '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>{empty}</div>
      )}
    </div>
  );
}

// ── Detail / response modal ───────────────────────────────────────────────────

function DetailModal({ msg: initialMsg, onClose, onUpdated }) {
  const [msg,        setMsg]        = useState(initialMsg);
  const [tab,        setTab]        = useState('detail');
  const [saving,     setSaving]     = useState(false);
  const [saveErr,    setSaveErr]    = useState('');
  const [analyzing,  setAnalyzing]  = useState(false);
  const [analyzeErr, setAnalyzeErr] = useState('');
  const [form, setForm] = useState({
    status:        initialMsg.status || 'new',
    assigned_to:   initialMsg.assigned_to || '',
    response_text: initialMsg.response_text || '',
    response_by:   initialMsg.response_by || '',
  });

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeErr('');
    try {
      const res = await emailActionService.reanalyze(msg.id);
      setMsg(res.data);
      onUpdated(res.data);
      setTab('summary');
    } catch (err) {
      setAnalyzeErr(err.response?.data?.detail || 'AI analysis failed. Is Ollama running?');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = async () => {
    setSaveErr('');
    setSaving(true);
    try {
      const res = await emailActionService.updateMessage(msg.id, {
        status:        form.status,
        assigned_to:   form.assigned_to || null,
        response_text: form.response_text || null,
        response_by:   form.response_by || null,
      });
      setMsg(res.data);
      onUpdated(res.data);
    } catch (err) {
      setSaveErr(err.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal--wide" style={{ maxWidth: 800 }}>
        <div className="modal-header">
          <h3 style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1 }}>
            <CatBadge value={msg.category} />
            <PriBadge value={msg.priority} />
            <span style={{ fontWeight: 600 }}>{msg.subject || '(no subject)'}</span>
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              className="btn btn-sm"
              style={{ background: '#6d28d9', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={handleAnalyze}
              disabled={analyzing}
              title="Re-run AI analysis on this email using Ollama"
            >
              {analyzing
                ? <><span className="spinner spinner--sm spinner--white" /> Analyzing…</>
                : '🤖 Check with AI'}
            </button>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
        </div>
        {analyzeErr && (
          <div style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', padding: '8px 20px', fontSize: 12, color: '#b91c1c' }}>
            ⚠ {analyzeErr}
          </div>
        )}
        {analyzing && (
          <div style={{ background: '#f5f3ff', borderBottom: '1px solid #ddd6fe', padding: '8px 20px', fontSize: 12, color: '#6d28d9' }}>
            🤖 Sending email to Ollama — this may take 20–60 seconds…
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', paddingLeft: 20 }}>
          {[['detail', 'Details'], ['summary', 'Smart Summary'], ['body', 'Email Body'], ['respond', 'Respond / Assign']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
                       fontWeight: tab === key ? 700 : 400,
                       borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent',
                       color: tab === key ? 'var(--primary)' : 'var(--text-2)',
                       fontSize: 13 }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ padding: '16px 20px 20px', maxHeight: 520, overflowY: 'auto' }}>

          {/* ── Details tab ── */}
          {tab === 'detail' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {[
                  ['From',        msg.sender],
                  ['Received',    fmt(msg.received_at)],
                  ['Category',    <CatBadge value={msg.category} />],
                  ['Priority',    <PriBadge value={msg.priority} />],
                  ['Sentiment',   <SentBadge value={msg.sentiment} />],
                  ['Status',      <StatBadge value={msg.status} />],
                  ['Project',     msg.project_name],
                  ['Zone',        msg.zone],
                  ['Assigned',    msg.assigned_to],
                  ['Response by', msg.response_by],
                ].map(([label, val]) => (
                  <div key={label} style={{ background: '#f8fafc', borderRadius: 6, padding: '8px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {val || <span style={{ color: '#9ca3af' }}>—</span>}
                    </div>
                  </div>
                ))}
              </div>

              {msg.ai_summary && (
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', marginBottom: 4 }}>AI Summary</div>
                  <p style={{ margin: 0, fontSize: 13, color: '#1e3a5f', lineHeight: 1.6 }}>{msg.ai_summary}</p>
                </div>
              )}

              {msg.key_points?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--text-2)' }}>Key Points</div>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {msg.key_points.map((p, i) => (
                      <li key={i} style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 3 }}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {msg.action_items?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: '#b45309' }}>Action Items</div>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {msg.action_items.map((a, i) => (
                      <li key={i} style={{ fontSize: 13, color: '#92400e', marginBottom: 3 }}>⚡ {a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {msg.response_text && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', marginBottom: 4 }}>
                    Response {msg.responded_at ? `· ${fmt(msg.responded_at)}` : ''}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: '#14532d', whiteSpace: 'pre-wrap' }}>{msg.response_text}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Smart Summary tab ── */}
          {tab === 'summary' && (
            <div>
              {!msg.ai_summary && !msg.person_name && (
                <div style={{ background: '#f5f3ff', border: '1.5px solid #ddd6fe', borderRadius: 8,
                              padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#6d28d9',
                              display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🤖</span>
                  <span>No AI analysis yet. Click <strong>Check with AI</strong> in the header to analyse this email with Ollama.</span>
                </div>
              )}

              {/* ── Person & Contact ── */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase',
                              letterSpacing: '0.06em', marginBottom: 8 }}>Person &amp; Contact</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  {[
                    { icon: '👤', label: 'Initiated By',    value: msg.person_name    },
                    { icon: '📞', label: 'Contact Number',  value: msg.person_contact },
                    { icon: '📩', label: 'Route / Contact To', value: msg.contact_to  },
                  ].map(({ icon, label, value }) => (
                    <SummaryCard key={label} icon={icon} label={label} value={value} />
                  ))}
                </div>
              </div>

              {/* ── Property ── */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase',
                              letterSpacing: '0.06em', marginBottom: 8 }}>Property Details</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[
                    { icon: '🏢', label: 'Building / Society',     value: msg.building_name },
                    { icon: '🚪', label: 'Flat / Unit',            value: msg.flat_info     },
                    { icon: '👥', label: 'Occupant Type',          value: msg.occupant_type ? cap(msg.occupant_type) : null },
                    { icon: '📅', label: 'Visit / Complaint Date', value: msg.event_date    },
                  ].map(({ icon, label, value }) => (
                    <SummaryCard key={label} icon={icon} label={label} value={value} />
                  ))}
                </div>
              </div>

              {/* ── Reason ── */}
              <div style={{ marginBottom: 14 }}>
                <SummaryBlock
                  icon="⚡"
                  label="Reason / Purpose / Issue"
                  value={msg.reason_purpose}
                  bg="#fffbeb" border="#fde68a" color="#78350f" labelColor="#b45309"
                  empty="Not extracted — click Check with AI."
                />
              </div>

              {/* ── Summaries ── */}
              <div style={{ marginBottom: 14 }}>
                <SummaryBlock
                  icon="📧"
                  label="Initial Email Summary"
                  value={msg.initial_summary}
                  bg="#f0fdf4" border="#bbf7d0" color="#14532d" labelColor="#15803d"
                  empty="Not available."
                />
              </div>

              <div>
                <SummaryBlock
                  icon="🤖"
                  label="Full AI Summary"
                  value={msg.ai_summary}
                  bg="#eff6ff" border="#bfdbfe" color="#1e3a5f" labelColor="#1d4ed8"
                  empty="No AI summary — click Check with AI in the header."
                />
              </div>
            </div>
          )}

          {/* ── Body tab ── */}
          {tab === 'body' && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
                Original email body (plain text)
              </div>
              <pre style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 6,
                            padding: 14, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            margin: 0, maxHeight: 420, overflowY: 'auto', color: 'var(--text-1)', lineHeight: 1.6 }}>
                {msg.body_text || '(no body)'}
              </pre>
            </div>
          )}

          {/* ── Respond tab ── */}
          {tab === 'respond' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {STATUSES.map(s => <option key={s} value={s}>{cap(s)}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Assigned To</label>
                  <input placeholder="Name / team" value={form.assigned_to}
                         onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Response By</label>
                  <input placeholder="Your name" value={form.response_by}
                         onChange={e => setForm(f => ({ ...f, response_by: e.target.value }))} />
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label>Response / Notes</label>
                <textarea rows={6} placeholder="Enter response or internal notes…"
                          value={form.response_text}
                          onChange={e => setForm(f => ({ ...f, response_text: e.target.value }))} />
              </div>

              {saveErr && <span className="field-error">⚠ {saveErr}</span>}

              <div>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? <><span className="spinner spinner--sm spinner--white" /> Saving…</> : '💾 Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EmailAction() {
  const [dashboard, setDashboard] = useState(null);
  const [messages,  setMessages]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [syncing,   setSyncing]   = useState(false);
  const [syncMsg,   setSyncMsg]   = useState('');
  const [syncErr,   setSyncErr]   = useState('');
  const [detailMsg, setDetailMsg] = useState(null);

  const [filters, setFilters] = useState({ category: '', priority: '', status: '', search: '' });
  const pg = usePagination(15);

  const loadData = useCallback(async () => {
    try {
      const [dashRes, msgRes] = await Promise.all([
        emailActionService.dashboard(),
        emailActionService.listMessages({
          category: filters.category || undefined,
          priority: filters.priority || undefined,
          status:   filters.status   || undefined,
          search:   filters.search   || undefined,
        }),
      ]);
      setDashboard(dashRes.data);
      setMessages(msgRes.data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg('');
    setSyncErr('');
    try {
      const res = await emailActionService.sync();
      setSyncMsg(res.data.message);
      await loadData();
    } catch (err) {
      setSyncErr(err.response?.data?.detail || 'Sync failed. Check Gmail credentials in .env');
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdated = useCallback(updated => {
    setMessages(prev => prev.map(m => m.id === updated.id ? updated : m));
    if (detailMsg?.id === updated.id) setDetailMsg(updated);
    emailActionService.dashboard().then(r => setDashboard(r.data)).catch(() => {});
  }, [detailMsg]);

  const setFilter = (key, val) => {
    setFilters(f => ({ ...f, [key]: val }));
    pg.goTo(1);
  };

  const { pageRows, totalRows, totalPages, currentPage, start, end } = pg.paginate(messages);
  const dash = dashboard;

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <h2>Email Action Center</h2>
          <p className="page-subtitle">Gmail inbox analysis · AI categorization · Team response tracking</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {syncMsg && <span style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>✓ {syncMsg}</span>}
          {syncErr && <span style={{ fontSize: 12, color: 'var(--danger)' }}>⚠ {syncErr}</span>}
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
            {syncing
              ? <><span className="spinner spinner--sm spinner--white" /> Syncing…</>
              : '🔄 Sync Gmail'}
          </button>
        </div>
      </div>

      {/* ── Summary stat cards ── */}
      {dash && (
        <>
          <div className="stat-grid">
            <StatCard icon="📧" label="Total Emails"  value={dash.total}      color="blue"   />
            <StatCard icon="⚡" label="Unresolved"    value={dash.unresolved} color="orange" />
            <StatCard icon="🔴" label="Fatal / Critical"
                      value={(dash.by_priority?.fatal || 0) + (dash.by_priority?.critical || 0)}
                      color="red" />
            <StatCard icon="✅" label="Resolved"
                      value={(dash.by_status?.resolved || 0) + (dash.by_status?.closed || 0)}
                      color="green" />
          </div>

          {/* Category distribution */}
          <div className="scrape-form-card" style={{ marginTop: 0, marginBottom: 20, padding: '14px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)' }}>Category Distribution</span>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {CATEGORIES.map(cat => dash.by_category?.[cat] ? (
                  <span key={cat} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLOR[cat], display: 'inline-block' }} />
                    {cap(cat)} ({dash.by_category[cat]})
                  </span>
                ) : null)}
              </div>
            </div>
            <CategoryBar byCategory={dash.by_category || {}} total={dash.total} />

            {/* Recent actionable */}
            {dash.recent?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', marginBottom: 6 }}>Needs Attention</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {dash.recent.map(m => (
                    <div key={m.id} onClick={() => setDetailMsg(m)}
                         style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                                  padding: '5px 8px', borderRadius: 5, transition: 'background .15s' }}
                         onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                         onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <PriBadge value={m.priority} />
                      <CatBadge value={m.category} />
                      <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                                     whiteSpace: 'nowrap', color: 'var(--text-1)' }}>
                        {m.subject || '(no subject)'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                        {fmtDate(m.received_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <input
          className="filter-input"
          placeholder="Search subject / sender…"
          value={filters.search}
          onChange={e => setFilter('search', e.target.value)}
          style={{ flex: '1 1 200px', maxWidth: 280, paddingLeft: 12 }}
        />
        <select className={`filter-select${filters.category ? ' is-active' : ''}`}
                value={filters.category} onChange={e => setFilter('category', e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{cap(c)}</option>)}
        </select>
        <select className={`filter-select${filters.priority ? ' is-active' : ''}`}
                value={filters.priority} onChange={e => setFilter('priority', e.target.value)}>
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{cap(p)}</option>)}
        </select>
        <select className={`filter-select${filters.status ? ' is-active' : ''}`}
                value={filters.status} onChange={e => setFilter('status', e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{cap(s)}</option>)}
        </select>
        {(filters.category || filters.priority || filters.status || filters.search) && (
          <button className="btn btn-sm btn-secondary"
                  onClick={() => setFilters({ category: '', priority: '', status: '', search: '' })}>
            Clear
          </button>
        )}
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="page-loading"><div className="spinner" /> Loading…</div>
      ) : messages.length === 0 ? (
        <div className="scrape-empty">
          <span style={{ fontSize: 40 }}>📭</span>
          <p>No emails found. Click <strong>Sync Gmail</strong> to fetch your inbox.</p>
          <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Requires GMAIL_USER and GMAIL_APP_PASSWORD in your backend .env file.
          </p>
        </div>
      ) : (
        <>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Received</th>
                  <th>Sender</th>
                  <th>Subject</th>
                  <th>Category</th>
                  <th>Priority</th>
                  <th>Sentiment</th>
                  <th>Status</th>
                  <th>Assigned</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(msg => (
                  <tr key={msg.id} style={{ cursor: 'pointer' }} onClick={() => setDetailMsg(msg)}>
                    <td style={{ color: 'var(--text-3)', fontWeight: 500 }}>{msg.id}</td>
                    <td style={{ color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {fmtDate(msg.received_at)}
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 160, overflow: 'hidden',
                                 textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {msg.sender || '—'}
                    </td>
                    <td style={{ maxWidth: 220, overflow: 'hidden',
                                 textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500 }}>
                      {msg.subject || '(no subject)'}
                    </td>
                    <td><CatBadge value={msg.category} /></td>
                    <td><PriBadge value={msg.priority} /></td>
                    <td><SentBadge value={msg.sentiment} /></td>
                    <td><StatBadge value={msg.status} /></td>
                    <td style={{ fontSize: 12 }}>{msg.assigned_to || '—'}</td>
                    <td className="actions" onClick={e => e.stopPropagation()}>
                      <button className="btn btn-sm btn-secondary" onClick={() => setDetailMsg(msg)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={currentPage}
            pageSize={pg.pageSize}
            totalRows={totalRows}
            totalPages={totalPages}
            start={start}
            end={end}
            onPageChange={pg.goTo}
            onPageSizeChange={pg.changeSize}
          />
        </>
      )}

      {/* ── Detail modal ── */}
      {detailMsg && (
        <DetailModal
          msg={detailMsg}
          onClose={() => setDetailMsg(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}
