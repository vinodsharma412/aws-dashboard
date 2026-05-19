import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { productService, suggestionService } from '../../services/productService';
import usePagination from '../../hooks/usePagination';
import Pagination from '../../components/common/Pagination';
import HighlightField from './HighlightField';
import { getSegments, escapeRegex } from './wordUtils';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  title: '', product_desc: '',
  bullet_1: '', bullet_2: '', bullet_3: '', bullet_4: '', bullet_5: '', bullet_6: '',
  image_1:  '', image_2:  '', image_3:  '', image_4:  '', image_5:  '', image_6:  '',
  keywords: [],
};

const KW_FIELDS = [
  { key: 'title',        label: 'Title' },
  { key: 'product_desc', label: 'Desc'  },
  { key: 'bullet_1',    label: 'B1'    },
  { key: 'bullet_2',    label: 'B2'    },
  { key: 'bullet_3',    label: 'B3'    },
  { key: 'bullet_4',    label: 'B4'    },
  { key: 'bullet_5',    label: 'B5'    },
  { key: 'bullet_6',    label: 'B6'    },
];

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString();
}

function bulletCount(p) {
  return [p.bullet_1,p.bullet_2,p.bullet_3,p.bullet_4,p.bullet_5,p.bullet_6].filter(Boolean).length;
}

function imageCount(p) {
  return [p.image_1,p.image_2,p.image_3,p.image_4,p.image_5,p.image_6].filter(Boolean).length;
}

function firstImage(p) {
  return [p.image_1,p.image_2,p.image_3,p.image_4,p.image_5,p.image_6].find(Boolean) || null;
}

// Small thumbnail used in the list table
function ProductThumb({ src }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div className="pm-thumb pm-thumb--empty" title="No image">
        <span>📷</span>
      </div>
    );
  }
  return (
    <img
      className="pm-thumb"
      src={src}
      alt=""
      onError={() => setErr(true)}
    />
  );
}

// Hero banner shown at top of the form
function HeroBanner({ src }) {
  const [err, setErr] = useState(false);
  // Reset error state whenever src changes so a corrected URL re-attempts load
  useEffect(() => setErr(false), [src]);

  if (!src || err) {
    return (
      <div className="pm-hero pm-hero--empty">
        <span className="pm-hero-icon">📷</span>
        <span className="pm-hero-label">{src && err ? 'Image could not be loaded' : 'No image — add a URL in the Images section below'}</span>
      </div>
    );
  }
  return (
    <div className="pm-hero">
      <img src={src} alt="Product hero" onError={() => setErr(true)} />
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({ tabs, active, onSelect }) {
  return (
    <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
      {tabs.map(([key, label, warn]) => (
        <button key={key} onClick={() => onSelect(key)} style={{
          padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: active === key ? 700 : 400,
          color: warn ? 'var(--danger)' : (active === key ? 'var(--primary)' : 'var(--text-2)'),
          borderBottom: active === key ? `2px solid ${warn ? 'var(--danger)' : 'var(--primary)'}` : '2px solid transparent',
          marginBottom: -2,
        }}>
          {label}{warn ? ' ⚠' : ''}
        </button>
      ))}
    </div>
  );
}

// ── Image slot ────────────────────────────────────────────────────────────────

function ImageSlot({ label, value, onChange }) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [value]);

  return (
    <div className="pm-img-slot">
      <div className="pm-img-slot-label">{label}</div>
      <div className="pm-img-preview">
        {value && !err
          ? <img src={value} alt={label} onError={() => setErr(true)} />
          : <span className="pm-img-placeholder">{value && err ? '⚠ Bad URL' : '+ Image'}</span>}
      </div>
      <input
        type="url"
        className="pm-img-url"
        placeholder="Paste image URL…"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

// ── Keyword Panel ─────────────────────────────────────────────────────────────

function KeywordPanel({ keywords, onKeywordsChange, activeKeywords, onToggle, form }) {
  const [open,  setOpen]  = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef(null);

  const kwCounts = useMemo(() => keywords.map(kw => {
    const re = new RegExp(escapeRegex(kw), 'gi');
    const breakdown = KW_FIELDS.reduce((acc, { key, label }) => {
      const n = ((form[key] || '').match(re) || []).length;
      if (n > 0) acc.push({ label, n });
      return acc;
    }, []);
    return { kw, total: breakdown.reduce((s, x) => s + x.n, 0), breakdown };
  }), [keywords, form]);

  const addKeyword = () => {
    const kw = input.trim();
    if (!kw || keywords.includes(kw)) return;
    onKeywordsChange([...keywords, kw]);
    setInput('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const removeKeyword = kw => {
    onKeywordsChange(keywords.filter(k => k !== kw));
    if (activeKeywords.has(kw)) onToggle(kw);
  };

  return (
    <div className="kw-panel">
      {!open ? (
        <button className="kw-toggle" onClick={() => setOpen(true)} title="Keyword tracker">
          🔑
          {keywords.length > 0 && (
            <span className="kw-toggle-badge">{keywords.length}</span>
          )}
        </button>
      ) : (
        <div className="kw-card">
          <div className="kw-card-head">
            <span>🔑 Keywords <span className="kw-head-count">{keywords.length}</span></span>
            <button className="kw-card-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="kw-card-body">
            {kwCounts.length === 0
              ? <p className="kw-empty">No keywords yet.<br/>Add one below.</p>
              : kwCounts.map(({ kw, total, breakdown }) => {
                  const isActive = activeKeywords.has(kw);
                  return (
                    <div
                      key={kw}
                      className={`kw-item${isActive ? ' kw-item--active' : ''}`}
                      onClick={() => onToggle(kw)}
                      title={isActive ? 'Click to remove highlight' : 'Click to highlight in fields'}
                    >
                      <span className="kw-phrase">{kw}</span>
                      <span className="kw-counts">
                        {breakdown.length > 0
                          ? breakdown.map(({ label, n }) => (
                              <span key={label} className="kw-where">{label}:{n}</span>
                            ))
                          : <span className="kw-where kw-where--zero">0</span>
                        }
                      </span>
                      <button
                        className="kw-del"
                        onClick={e => { e.stopPropagation(); removeKeyword(kw); }}
                        title="Remove keyword"
                      >×</button>
                    </div>
                  );
                })
            }
          </div>

          <div className="kw-card-add">
            <input
              ref={inputRef}
              className="kw-input"
              placeholder="Add keyword or phrase…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
            />
            <button className="btn btn-sm btn-primary" onClick={addKeyword} disabled={!input.trim()}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Product form ──────────────────────────────────────────────────────────────

function ProductForm({ initial, suggestions, onSaved, onCancel, onStatusChange }) {
  const [form,           setForm]           = useState(() => ({
    ...EMPTY_FORM,
    ...(initial || {}),
    keywords: initial?.keywords || [],
  }));
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState('');
  const [activeKeywords, setActiveKeywords] = useState(new Set());

  const toggleKeyword = useCallback(kw => {
    setActiveKeywords(prev => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw); else next.add(kw);
      return next;
    });
  }, []);

  const activeKwArray = useMemo(() => [...activeKeywords], [activeKeywords]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const BULLET_KEYS = ['bullet_1','bullet_2','bullet_3','bullet_4','bullet_5','bullet_6'];

  const hasNotUse = useMemo(() => {
    const fields = [form.title, form.product_desc, ...BULLET_KEYS.map(k => form[k])];
    return fields.some(text =>
      getSegments(text, suggestions).some(s => s.type === 'not_use')
    );
  }, [form, suggestions]);

  const hasOverLimit = useMemo(() => {
    if ((form.title || '').length > 250) return true;
    if ((form.product_desc || '').length > 500) return true;
    return BULLET_KEYS.some(k => (form[k] || '').length > 200);
  }, [form]);

  useEffect(() => {
    onStatusChange?.(hasNotUse, hasOverLimit);
  }, [hasNotUse, hasOverLimit]);

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }
    if (hasNotUse) { setError('Remove all "not use" words before saving.'); return; }
    if (hasOverLimit) { setError('Some fields exceed the character limit.'); return; }
    setError('');
    setSaving(true);
    try {
      if (initial?.id) {
        await productService.update(initial.id, form);
      } else {
        await productService.create(form);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const bullets  = [1,2,3,4,5,6];
  const images   = [1,2,3,4,5,6];

  return (
    <>
    <form onSubmit={handleSubmit}>
      <div className="pm-top-row">

        {/* ── Left 70% — all inputs ── */}
        <div className="pm-top-fields">

          <div className="pm-field-group">
            <label className="pm-field-label">Title <span style={{ color: 'var(--danger)' }}>*</span></label>
            <HighlightField
              value={form.title}
              onChange={v => set('title', v)}
              suggestions={suggestions}
              activeKeywords={activeKwArray}
              multiline={true}
              rows={2}
              maxLength={250}
              placeholder="Product title…"
            />
          </div>

          <div className="pm-field-group">
            <label className="pm-field-label">Product Description</label>
            <HighlightField
              value={form.product_desc}
              onChange={v => set('product_desc', v)}
              suggestions={suggestions}
              activeKeywords={activeKwArray}
              multiline={true}
              rows={5}
              maxLength={500}
              placeholder="Describe the product…"
            />
          </div>

          <div className="pm-field-group">
            <label className="pm-field-label">Bullet Points</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bullets.map(n => (
                <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: '50%', background: 'var(--primary)',
                    color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 9,
                  }}>{n}</span>
                  <div style={{ flex: 1 }}>
                    <HighlightField
                      value={form[`bullet_${n}`]}
                      onChange={v => set(`bullet_${n}`, v)}
                      suggestions={suggestions}
                      activeKeywords={activeKwArray}
                      multiline={true}
                      rows={2}
                      maxLength={200}
                      placeholder={`Bullet point ${n}…`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pm-field-group">
            <label className="pm-field-label">Product Images <span style={{ color: 'var(--text-3)', fontSize: 12 }}>(paste URLs)</span></label>
            <div className="pm-img-grid">
              {images.map(n => (
                <ImageSlot
                  key={n}
                  label={`Image ${n}`}
                  value={form[`image_${n}`]}
                  onChange={v => set(`image_${n}`, v)}
                />
              ))}
            </div>
          </div>

          {error && <p className="field-error" style={{ marginBottom: 12 }}>⚠ {error}</p>}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="submit" className="btn btn-primary" disabled={saving || hasNotUse || hasOverLimit}>
              {saving ? <><span className="spinner spinner--sm spinner--white" /> Saving…</> : (initial?.id ? '💾 Update Product' : '➕ Create Product')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
            {hasNotUse && <span style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>⚠ Remove flagged "not use" words to save</span>}
            {!hasNotUse && hasOverLimit && <span style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>⚠ Character limit exceeded</span>}
          </div>
        </div>

        {/* ── Right 30% — hero image, sticky ── */}
        <div className="pm-top-hero">
          <HeroBanner src={firstImage(form)} />
        </div>

      </div>
    </form>

    <KeywordPanel
      keywords={form.keywords}
      onKeywordsChange={kws => set('keywords', kws)}
      activeKeywords={activeKeywords}
      onToggle={toggleKeyword}
      form={form}
    />
    </>
  );
}

// ── Word Suggestions manager ──────────────────────────────────────────────────

const STYPE = {
  not_use: { label: 'Not Use Words',  desc: 'Words that should never appear in content', color: '#ef4444', bg: '#fef2f2', border: '#fecaca', icon: '🚫' },
  can_use: { label: 'Can Use Words',  desc: 'Recommended or approved words',             color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: '✅' },
  brand:   { label: 'Brand Words',    desc: 'Brand or trademark terms to track',          color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', icon: '™'  },
};

function SuggestionColumn({ type, items, onAdd, onDelete }) {
  const cfg   = STYPE[type];
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const handleAdd = async () => {
    const phrase = val.trim();
    if (!phrase) return;
    setBusy(true);
    await onAdd(phrase, type);
    setVal('');
    setBusy(false);
    inputRef.current?.focus();
  };

  const mine = items.filter(s => s.word_type === type);

  return (
    <div className="pm-sug-col" style={{ '--sug-color': cfg.color, '--sug-bg': cfg.bg, '--sug-border': cfg.border }}>
      <div className="pm-sug-head">
        <span className="pm-sug-icon">{cfg.icon}</span>
        <div>
          <div className="pm-sug-title">{cfg.label}</div>
          <div className="pm-sug-desc">{cfg.desc}</div>
        </div>
        <span className="pm-sug-count">{mine.length}</span>
      </div>

      <div className="pm-sug-list">
        {mine.length === 0
          ? <p className="pm-sug-empty">No entries yet.</p>
          : mine.map(s => (
              <div key={s.id} className="pm-sug-item">
                <span className="pm-sug-phrase">{s.phrase}</span>
                <button
                  className="pm-sug-del"
                  onClick={() => onDelete(s.id)}
                  title="Remove"
                >×</button>
              </div>
            ))
        }
      </div>

      <div className="pm-sug-add">
        <input
          ref={inputRef}
          className="pm-sug-input"
          placeholder="Type word or phrase…"
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
        />
        <button className="btn btn-sm btn-primary" onClick={handleAdd} disabled={busy || !val.trim()}>
          {busy ? '…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProductMaster() {
  const [tab,           setTab]           = useState('list');
  const [products,      setProducts]      = useState([]);
  const [suggestions,   setSuggestions]   = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [editing,       setEditing]       = useState(null);
  const [deleteId,      setDeleteId]      = useState(null);
  const [deleting,      setDeleting]      = useState(false);
  const [formHasNotUse, setFormHasNotUse] = useState(false);
  const pg = usePagination(10);

  // Build suggestion lookup used by HighlightField
  const suggestionMap = useMemo(() => ({
    not_use: suggestions.filter(s => s.word_type === 'not_use').map(s => s.phrase),
    can_use: suggestions.filter(s => s.word_type === 'can_use').map(s => s.phrase),
    brand:   suggestions.filter(s => s.word_type === 'brand').map(s => s.phrase),
  }), [suggestions]);

  const loadAll = useCallback(async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        productService.list(),
        suggestionService.list(),
      ]);
      setProducts(pRes.data);
      setSuggestions(sRes.data);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Product actions ──────────────────────────────────────────────────────────
  const handleEdit = product => {
    setEditing(product);
    setTab('form');
  };

  const handleNew = () => {
    setEditing(null);
    setTab('form');
  };

  const handleSaved = async () => {
    await loadAll();
    setTab('list');
    setEditing(null);
    setFormHasNotUse(false);
  };

  const handleCancel = () => {
    setTab('list');
    setEditing(null);
    setFormHasNotUse(false);
  };

  const handleDelete = async id => {
    setDeleting(true);
    try {
      await productService.remove(id);
      setProducts(prev => prev.filter(p => p.id !== id));
    } catch { /* ignore */ }
    finally { setDeleting(false); setDeleteId(null); }
  };

  // ── Suggestion actions ────────────────────────────────────────────────────────
  const handleAddSuggestion = async (phrase, word_type) => {
    try {
      const res = await suggestionService.create(phrase, word_type);
      setSuggestions(prev => [...prev, res.data]);
    } catch { /* ignore */ }
  };

  const handleDeleteSuggestion = async id => {
    try {
      await suggestionService.remove(id);
      setSuggestions(prev => prev.filter(s => s.id !== id));
    } catch { /* ignore */ }
  };

  const { pageRows, totalRows, totalPages, currentPage, start, end } = pg.paginate(products);

  const tabs = [
    ['list',        `📦 Products (${products.length})`, false],
    ['form',        (editing ? '✏️ Edit Product' : '➕ New Product'), formHasNotUse],
    ['suggestions', '🔤 Word Suggestions', false],
  ];

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2>Product Master</h2>
          <p className="page-subtitle">Manage product listings with AI-powered word analysis</p>
        </div>
      </div>

      <TabBar tabs={tabs} active={tab} onSelect={t => { setTab(t); if (t === 'list') setEditing(null); }} />

      {/* ── Products list tab ── */}
      {tab === 'list' && (
        <>
          <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleNew}>➕ Add Product</button>
          </div>

          {loading ? (
            <div className="page-loading"><div className="spinner" /> Loading…</div>
          ) : products.length === 0 ? (
            <div className="scrape-empty">
              <span style={{ fontSize: 40 }}>📦</span>
              <p>No products yet. Click <strong>Add Product</strong> to create the first one.</p>
            </div>
          ) : (
            <>
              <div className="table-responsive">
                <table className="data-table freeze-2">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product</th>
                      <th>Description</th>
                      <th style={{ textAlign: 'center' }}>Bullets</th>
                      <th style={{ textAlign: 'center' }}>Images</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(p => (
                      <tr key={p.id}>
                        <td style={{ color: 'var(--text-3)', fontWeight: 500 }}>{p.id}</td>
                        <td style={{ maxWidth: 260 }}>
                          <div className="pm-list-product">
                            <ProductThumb src={firstImage(p)} />
                            <span className="pm-list-title">{p.title}</span>
                          </div>
                        </td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)', fontSize: 12 }}>
                          {p.product_desc || '—'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 10, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
                            {bulletCount(p)}/6
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ background: '#f0fdf4', color: '#15803d', borderRadius: 10, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
                            {imageCount(p)}/6
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{fmt(p.created_at)}</td>
                        <td className="actions">
                          <button className="btn btn-sm btn-secondary" onClick={() => handleEdit(p)}>✏️ Edit</button>
                          <button className="btn btn-sm btn-danger"    onClick={() => setDeleteId(p.id)}>🗑</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={currentPage} pageSize={pg.pageSize} totalRows={totalRows}
                totalPages={totalPages} start={start} end={end}
                onPageChange={pg.goTo} onPageSizeChange={pg.changeSize}
              />
            </>
          )}

          {/* Delete confirm */}
          {deleteId !== null && (
            <div className="modal-overlay">
              <div className="modal" style={{ maxWidth: 380 }}>
                <div className="modal-header"><h3>Delete Product</h3></div>
                <div style={{ padding: '16px 20px 20px' }}>
                  <p style={{ marginBottom: 20, color: 'var(--text-2)' }}>
                    Are you sure? This will permanently delete the product and cannot be undone.
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-danger" disabled={deleting} onClick={() => handleDelete(deleteId)}>
                      {deleting ? 'Deleting…' : 'Yes, Delete'}
                    </button>
                    <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Add / Edit form tab ── */}
      {tab === 'form' && (
        <div style={{ maxWidth: 1060 }}>
          <ProductForm
            initial={editing}
            suggestions={suggestionMap}
            onSaved={handleSaved}
            onCancel={handleCancel}
            onStatusChange={(notUse) => setFormHasNotUse(notUse)}
          />
        </div>
      )}

      {/* ── Word suggestions tab ── */}
      {tab === 'suggestions' && (
        <div>
          {/* Legend */}
          <div className="pm-sug-legend">
            <span><mark className="hl-not_use">not use</mark> Avoid — flagged in red</span>
            <span><mark className="hl-can_use">can use</mark> OK — flagged in green</span>
            <span><mark className="hl-brand">brand</mark> Brand — flagged in purple</span>
          </div>
          <div className="pm-sug-grid">
            {Object.keys(STYPE).map(type => (
              <SuggestionColumn
                key={type}
                type={type}
                items={suggestions}
                onAdd={handleAddSuggestion}
                onDelete={handleDeleteSuggestion}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
