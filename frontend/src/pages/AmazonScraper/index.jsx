import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { scrapingService } from '../../services/scrapingService';
import useSSE from '../../hooks/useSSE';
import usePagination from '../../hooks/usePagination';
import Pagination from '../../components/common/Pagination';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAsins(raw) {
  return [
    ...new Set(
      raw
        .split(/[\n,\s]+/)
        .map(s => s.trim().toUpperCase())
        .filter(s => /^[A-Z0-9]{10}$/.test(s))
    ),
  ];
}

function jobStatus(job) {
  // Nothing left in flight → derive final status from what completed/failed
  if (job.pending === 0 && job.running === 0) {
    if (job.failed === 0)    return 'done';
    if (job.completed === 0) return 'failed';
    return 'partial';
  }
  if (job.running > 0) return 'running';
  return 'queued';   // pending > 0, running === 0 → waiting for worker
}

function progressPct(job) {
  if (!job.total) return 0;
  return Math.min(100, Math.round(((job.completed + job.failed) / job.total) * 100));
}

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt + (dt.endsWith('Z') ? '' : 'Z')).toLocaleString();
}

function elapsed(task) {
  if (!task.started_at || !task.completed_at) return null;
  const ms = new Date(task.completed_at + 'Z') - new Date(task.started_at + 'Z');
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CLASS = {
  pending:   'scrape-badge scrape-badge--pending',
  running:   'scrape-badge scrape-badge--running',
  completed: 'scrape-badge scrape-badge--done',
  failed:    'scrape-badge scrape-badge--failed',
  queued:    'scrape-badge scrape-badge--pending',
  done:      'scrape-badge scrape-badge--done',
  partial:   'scrape-badge scrape-badge--partial',
};

function Badge({ status }) {
  const label = {
    pending: 'Pending', running: 'Running', completed: 'Done',
    failed: 'Failed',  queued: 'Queued',   done: 'Done', partial: 'Partial',
  }[status] ?? status;
  return <span className={STATUS_CLASS[status] ?? 'scrape-badge'}>{label}</span>;
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ job }) {
  const pct = progressPct(job);
  const st  = jobStatus(job);
  const fillClass =
    st === 'failed'  ? ' scrape-progress-fill--failed'  :
    st === 'partial' ? ' scrape-progress-fill--partial' : '';
  return (
    <div className="scrape-progress">
      <div
        className={`scrape-progress-fill${fillClass}`}
        style={{ width: `${pct}%` }}
      />
      <span className="scrape-progress-label">{job.completed + job.failed}/{job.total}</span>
    </div>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────

function DetailModal({ jobId, onClose }) {
  const [job,        setJob]        = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [taskFilter, setTaskFilter] = useState(null);

  // ① REST: show data immediately on open
  useEffect(() => {
    scrapingService.getJob(jobId)
      .then(res => setJob(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [jobId]);

  // ② SSE: stream live updates on top
  const { data: sseJob } = useSSE(`/scraping/jobs/${jobId}/events`);
  useEffect(() => {
    if (sseJob && !sseJob.error) setJob(sseJob);
  }, [sseJob]);

  const isActive = job && (job.pending > 0 || job.running > 0);

  const toggleFilter = status =>
    setTaskFilter(prev => (prev === status ? null : status));

  const PILLS = job ? [
    { status: 'pending',   count: job.pending,   label: 'pending', mod: 'pending' },
    { status: 'running',   count: job.running,   label: 'running', mod: 'running' },
    { status: 'completed', count: job.completed, label: 'done',    mod: 'done'    },
    { status: 'failed',    count: job.failed,    label: 'failed',  mod: 'failed'  },
  ] : [];

  const filteredTasks = taskFilter
    ? (job?.tasks || []).filter(t => t.status === taskFilter)
    : (job?.tasks || []);

  return (
    <div className="modal-overlay">
      <div className="modal modal--wide">
        <div className="modal-header">
          <h3>
            Job #{jobId} — Task Details
            {isActive && <span className="scrape-live-dot" title="Live" style={{ marginLeft: 8 }} />}
          </h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div className="page-loading"><div className="spinner" /> Loading…</div>
        ) : !job || job.error ? (
          <p style={{ padding: 20, color: 'var(--danger)' }}>Failed to load job.</p>
        ) : (
          <>
            <div className="scrape-detail-summary">
              {/* Total — clears filter */}
              <span
                className={`scrape-summary-total${!taskFilter ? ' scrape-summary-total--active' : ''}`}
                onClick={() => setTaskFilter(null)}
                title="Show all tasks"
              >
                Total <strong>{job.total}</strong>
              </span>

              {PILLS.map(({ status, count, label, mod }) => (
                <span
                  key={status}
                  className={`scrape-summary-dot scrape-summary-dot--${mod}${taskFilter === status ? ' scrape-summary-dot--active' : ''}`}
                  onClick={() => toggleFilter(status)}
                  title={`Click to filter: ${label} (${count})`}
                >
                  <strong>{count}</strong> {label}
                </span>
              ))}
            </div>

            <div className="scrape-tasks">
              {/* Filter banner */}
              {taskFilter && (
                <div className="scrape-filter-banner">
                  <span>
                    Showing <strong>{filteredTasks.length}</strong> of <strong>{job.total}</strong>
                    {' '}— <em>{taskFilter === 'completed' ? 'done' : taskFilter}</em> tasks
                  </span>
                  <button onClick={() => setTaskFilter(null)}>× Clear filter</button>
                </div>
              )}

              {/* Empty state for filtered view */}
              {filteredTasks.length === 0 && (
                <div className="scrape-empty" style={{ padding: '24px 0' }}>
                  <span style={{ fontSize: 32 }}>🔍</span>
                  <p>No <strong>{taskFilter === 'completed' ? 'done' : taskFilter}</strong> tasks in this job.</p>
                </div>
              )}

              {filteredTasks.map(task => (
                <div key={task.id} className={`scrape-task-card scrape-task-card--${task.status}`}>
                  <div className="scrape-task-header">
                    <div className="scrape-task-asin">
                      <a
                        href={`https://www.amazon.in/dp/${task.asin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="scrape-asin-link"
                      >
                        {task.asin}
                      </a>
                      {task.status === 'running' && (
                        <span className="spinner spinner--sm" style={{ marginLeft: 6 }} />
                      )}
                    </div>
                    <Badge status={task.status} />
                  </div>

                  {task.status === 'failed' && task.error && (
                    <div className="scrape-task-error">⚠ {task.error}</div>
                  )}

                  {task.product && (
                    <div className="scrape-product">
                      <div className="scrape-product-img-wrap">
                        {task.product.image_url ? (
                          <img
                            src={task.product.image_url}
                            alt={task.product.title || task.asin}
                            className="scrape-product-img"
                          />
                        ) : (
                          <div className="scrape-product-img-placeholder">No image</div>
                        )}
                      </div>
                      <div className="scrape-product-info">
                        {task.product.title && (
                          <p className="scrape-product-title">{task.product.title}</p>
                        )}
                        <div className="scrape-product-meta">
                          {task.product.brand && (
                            <span className="scrape-meta-item">
                              <span className="scrape-meta-label">Brand</span> {task.product.brand}
                            </span>
                          )}
                          {task.product.price && (
                            <span className="scrape-meta-item scrape-meta-price">
                              {task.product.price}
                            </span>
                          )}
                          {task.product.rating && (
                            <span className="scrape-meta-item">
                              ★ {task.product.rating}
                              {task.product.review_count && ` (${task.product.review_count})`}
                            </span>
                          )}
                          {task.product.availability && (
                            <span className="scrape-meta-item">{task.product.availability}</span>
                          )}
                        </div>
                        <div className="scrape-task-timing">
                          Scraped: {fmt(task.product.scraped_at)}
                          {elapsed(task) && ` · ${elapsed(task)}`}
                        </div>
                      </div>
                    </div>
                  )}

                  {(task.status === 'pending' || task.status === 'running') && (
                    <div className="scrape-task-waiting">
                      {task.status === 'pending' ? '⏳ Waiting in queue…' : '🔄 Scraping in progress…'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AmazonScraper() {
  const { user }                    = useAuth();
  const [asinInput, setAsinInput]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState('');
  const [detailId,  setDetailId]    = useState(null);
  const pg                          = usePagination(10);

  // SSE stream — one persistent connection, no polling
  const { data: jobs, connected } = useSSE('/scraping/events', []);

  const safeJobs  = Array.isArray(jobs) ? jobs : [];
  const hasActive = safeJobs.some(j => j.pending > 0 || j.running > 0);
  const isViewer  = user?.role === 'viewer';

  const { pageRows, totalRows, totalPages, currentPage, start, end } = pg.paginate(safeJobs);

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async e => {
    e.preventDefault();
    setFormError('');
    const asins = parseAsins(asinInput);
    if (!asins.length) {
      setFormError('No valid ASINs found. Each ASIN must be exactly 10 alphanumeric characters.');
      return;
    }
    if (asins.length > 50) {
      setFormError('Maximum 50 ASINs per request.');
      return;
    }
    setSubmitting(true);
    try {
      await scrapingService.createJob(asins);
      setAsinInput('');
      pg.goTo(1);
    } catch (err) {
      setFormError(err.response?.data?.detail || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2>Amazon Product Scraper</h2>
          <p className="page-subtitle">Fetch product data from Amazon.in using Playwright</p>
        </div>
      </div>

      {/* ── Submit form ── */}
      <div className="scrape-form-card">
        <h3 className="scrape-form-title">New Scraping Request</h3>
        <p className="scrape-form-hint">
          Enter one or more ASINs — one per line, or comma/space separated.
          Up to 50 ASINs per request. Max 2 run in parallel; the rest queue automatically.
        </p>
        <form onSubmit={handleSubmit}>
          <textarea
            className={`scrape-textarea${formError ? ' input-error' : ''}`}
            rows={5}
            placeholder={"B0D324VJ6G\nB09G3HRMVB\nB0B7CM33XX"}
            value={asinInput}
            onChange={e => { setAsinInput(e.target.value); setFormError(''); }}
          />
          {formError && <span className="field-error">⚠ {formError}</span>}
          {asinInput.trim() && (
            <p className="scrape-preview">
              {parseAsins(asinInput).length} valid ASIN{parseAsins(asinInput).length !== 1 ? 's' : ''} detected
            </p>
          )}
          <div style={{ marginTop: 12 }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !asinInput.trim()}
            >
              {submitting
                ? <><span className="spinner spinner--sm spinner--white" /> Submitting…</>
                : '🚀 Start Scraping'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Jobs table ── */}
      <div style={{ marginTop: 24 }}>
        <h3 className="scrape-section-title">
          {isViewer ? 'My Requests' : 'All Requests'}
          {hasActive && <span className="scrape-live-dot" title="Live updating" />}
        </h3>

        {!connected && safeJobs.length === 0 ? (
          <div className="page-loading"><div className="spinner" /> Connecting…</div>
        ) : safeJobs.length === 0 ? (
          <div className="scrape-empty">
            <span style={{ fontSize: 40 }}>📦</span>
            <p>No scraping requests yet. Submit your first batch above.</p>
          </div>
        ) : (
          <>
            <div className="table-responsive">
              <table className={`data-table${!isViewer ? ' freeze-2' : ''}`}>
                <thead>
                  <tr>
                    <th>#</th>
                    {!isViewer && <th>User</th>}
                    <th>Submitted</th>
                    <th>ASINs</th>
                    <th>Progress</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(job => {
                    const st = jobStatus(job);
                    return (
                      <tr key={job.id}>
                        <td style={{ color: 'var(--text-3)', fontWeight: 500 }}>{job.id}</td>
                        {!isViewer && (
                          <td style={{ fontWeight: 600 }}>{job.username || job.user_id}</td>
                        )}
                        <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{fmt(job.created_at)}</td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{job.total}</td>
                        <td style={{ minWidth: 160 }}><ProgressBar job={job} /></td>
                        <td><Badge status={st} /></td>
                        <td className="actions">
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => setDetailId(job.id)}
                          >
                            🔍 View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
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
      </div>

      {/* ── Detail modal ── */}
      {detailId !== null && (
        <DetailModal jobId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}
