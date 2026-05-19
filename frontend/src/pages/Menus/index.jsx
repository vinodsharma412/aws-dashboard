import React, { useEffect, useState, useMemo } from 'react';
import { menuService } from '../../services/menuService';
import { useSortFilter, applySort, applySearch } from '../../hooks/useSortFilter';
import usePagination from '../../hooks/usePagination';
import useConfirm from '../../hooks/useConfirm';
import SortTh from '../../components/common/SortTh';
import Pagination from '../../components/common/Pagination';
import ConfirmModal from '../../components/common/ConfirmModal';

const emptyForm  = { name: '', path: '', icon: '', sort_order: 0, is_active: true, parent_id: '' };
const SEARCH_FLD = ['id', 'name', 'path', 'icon'];

function validateMenu(form) {
  const e = {};
  if (!form.name.trim())                  e.name = 'Menu name is required.';
  else if (form.name.trim().length < 2)   e.name = 'Name must be at least 2 characters.';
  if (!form.path.trim())                  e.path = 'Path is required.';
  else if (!form.path.trim().startsWith('/')) e.path = 'Path must start with /.';
  else if (/\s/.test(form.path.trim()))   e.path = 'Path must not contain spaces.';
  const order = Number(form.sort_order);
  if (form.sort_order !== '' && (isNaN(order) || order < 0 || !Number.isInteger(order)))
    e.sort_order = 'Sort order must be a non-negative whole number.';
  return e;
}

export default function Menus() {
  const [menus,   setMenus]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [modal,      setModal]      = useState(null);
  const [form,       setForm]       = useState(emptyForm);
  const [saving,     setSaving]     = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [formErrors, setFormErrors] = useState({});

  const sf = useSortFilter('sort_order');
  const pg = usePagination(10);
  const { confirm, confirmProps } = useConfirm();

  const rows = useMemo(() => {
    let r = applySearch(menus, sf.search, SEARCH_FLD);
    if (sf.filterValues.status) r = r.filter(m =>
      sf.filterValues.status === 'active' ? m.is_active : !m.is_active
    );
    return applySort(r, sf.sortBy);
  }, [menus, sf.search, sf.filterValues, sf.sortBy]);

  // reset to page 1 when filter/search changes
  useEffect(() => { pg.resetPage(); }, [sf.search, sf.filterValues]); // eslint-disable-line

  const { pageRows, totalRows, totalPages, currentPage, start, end } = pg.paginate(rows);

  const load = async () => {
    try {
      setLoading(true);
      const res = await menuService.listMenus();
      setMenus(res.data);
    } catch {
      setError('Failed to load menus.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setForm(emptyForm); setEditId(null); setFormErrors({}); setModal('create'); };
  const openEdit   = m  => {
    setForm({ name: m.name, path: m.path, icon: m.icon || '',
              sort_order: m.sort_order, is_active: m.is_active, parent_id: m.parent_id ?? '' });
    setEditId(m.id);
    setFormErrors({});
    setModal('edit');
  };
  const closeModal = () => { setModal(null); setError(''); setFormErrors({}); };

  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
    if (formErrors[name]) setFormErrors(fe => ({ ...fe, [name]: '' }));
  };

  const handleBlur = e => {
    const { name } = e.target;
    const errs = validateMenu(form);
    if (errs[name]) setFormErrors(fe => ({ ...fe, [name]: errs[name] }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    const errs = validateMenu(form);
    if (Object.keys(errs).length) { setFormErrors(errs); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        sort_order: Number(form.sort_order),
        parent_id:  form.parent_id === '' ? null : Number(form.parent_id),
        icon:       form.icon || null,
      };
      if (modal === 'create') await menuService.createMenu(payload);
      else                    await menuService.updateMenu(editId, payload);
      closeModal();
      load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async id => {
    const ok = await confirm({
      title:        'Delete Menu Item',
      message:      'This menu item and all associated role access records will be permanently removed.',
      confirmLabel: 'Delete',
      cancelLabel:  'Keep',
      variant:      'danger',
      icon:         '📋',
    });
    if (!ok) return;
    try {
      await menuService.deleteMenu(id);
      load();
    } catch {
      setError('Delete failed. Please try again.');
    }
  };

  const parentOptions = menus.filter(m => m.id !== editId);

  const chips = [
    sf.filterValues.status && { key: 'status', label: `Status: ${sf.filterValues.status}` },
  ].filter(Boolean);

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2>Menu Management</h2>
          <p className="page-subtitle">{menus.length} menu item{menus.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>＋ Add Menu</button>
      </div>

      {error && !modal && (
        <div className="alert alert--error"><span className="alert-icon">⚠</span>{error}</div>
      )}

      {/* ── Filter bar ── */}
      <div className="filter-bar">
        <div className="filter-search">
          <span className="filter-search-icon">🔍</span>
          <input
            className="filter-input"
            type="text"
            placeholder="Search by name, path, icon…"
            value={sf.search}
            onChange={e => sf.setSearch(e.target.value)}
          />
          {sf.search && (
            <button className="filter-input-clear" onClick={() => sf.setSearch('')} title="Clear search">×</button>
          )}
        </div>

        <select
          className={`filter-select${sf.filterValues.status ? ' is-active' : ''}`}
          value={sf.filterValues.status || ''}
          onChange={e => sf.setFilter('status', e.target.value)}
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        {sf.hasFilters && (
          <button className="btn btn-sm btn-secondary" onClick={sf.clearAll}>✕ Clear</button>
        )}

        <span className="filter-count">
          <strong>{rows.length}</strong> / {menus.length}
        </span>
      </div>

      {chips.length > 0 && (
        <div className="filter-chips">
          {chips.map(c => (
            <span key={c.key} className="filter-chip">
              {c.label}
              <button className="filter-chip-remove" onClick={() => sf.setFilter(c.key, '')}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="page-loading"><div className="spinner" /> Loading menus…</div>
      ) : (
        <>
          <div className="table-responsive">
            <table className="data-table freeze-2">
              <thead>
                <tr>
                  <SortTh col="id"         label="ID"     sortBy={sf.sortBy} onSort={sf.handleSort} />
                  <SortTh col="name"       label="Name"   sortBy={sf.sortBy} onSort={sf.handleSort} />
                  <SortTh col="path"       label="Path"   sortBy={sf.sortBy} onSort={sf.handleSort} />
                  <SortTh col="icon"       label="Icon"   sortBy={sf.sortBy} onSort={sf.handleSort} />
                  <SortTh col="sort_order" label="Sort"   sortBy={sf.sortBy} onSort={sf.handleSort} />
                  <SortTh col="is_active"  label="Status" sortBy={sf.sortBy} onSort={sf.handleSort} />
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="table-empty">
                      <span className="table-empty-icon">📋</span>
                      {sf.hasFilters ? 'No menus match your filters.' : 'No menus yet.'}
                    </td>
                  </tr>
                ) : pageRows.map(m => (
                  <tr key={m.id}>
                    <td style={{ color: 'var(--text-3)', fontWeight: 500 }}>{m.id}</td>
                    <td style={{ fontWeight: 600 }}>{m.name}</td>
                    <td><code style={{ fontSize: 12, background: 'var(--bg)', padding: '2px 6px', borderRadius: 3 }}>{m.path}</code></td>
                    <td style={{ fontSize: 18 }}>{m.icon || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{m.sort_order}</td>
                    <td>
                      <span className={`status-dot status-dot--${m.is_active ? 'active' : 'inactive'}`}>
                        {m.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="actions">
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(m)}>✏ Edit</button>
                      <button className="btn btn-sm btn-danger"    onClick={() => handleDelete(m.id)} title="Delete">🗑</button>
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

      {/* ── Form Modal ── */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{modal === 'create' ? '＋ Add Menu' : '✏ Edit Menu'}</h3>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              {error && <div className="alert alert--error"><span className="alert-icon">⚠</span>{error}</div>}
              <div className="form-group">
                <label>Name *</label>
                <input name="name" value={form.name} onChange={handleChange} onBlur={handleBlur}
                  className={formErrors.name ? 'input-error' : ''}
                  placeholder="e.g. Dashboard" />
                {formErrors.name && <span className="field-error">⚠ {formErrors.name}</span>}
              </div>
              <div className="form-group">
                <label>Path *</label>
                <input name="path" value={form.path} onChange={handleChange} onBlur={handleBlur}
                  className={formErrors.path ? 'input-error' : ''}
                  placeholder="e.g. /dashboard" />
                {formErrors.path && <span className="field-error">⚠ {formErrors.path}</span>}
              </div>
              <div className="form-group">
                <label>Icon (emoji)</label>
                <input name="icon" value={form.icon} onChange={handleChange} placeholder="e.g. 🏠" />
              </div>
              <div className="form-group">
                <label>Sort Order</label>
                <input name="sort_order" type="number" value={form.sort_order} onChange={handleChange} onBlur={handleBlur}
                  className={formErrors.sort_order ? 'input-error' : ''}
                  min="0" />
                {formErrors.sort_order && <span className="field-error">⚠ {formErrors.sort_order}</span>}
              </div>
              <div className="form-group">
                <label>Parent Menu</label>
                <select name="parent_id" value={form.parent_id} onChange={handleChange}>
                  <option value="">— None (top level) —</option>
                  {parentOptions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="form-group form-check">
                <label>
                  <input name="is_active" type="checkbox" checked={form.is_active} onChange={handleChange} />
                  Active (visible in sidebar)
                </label>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner spinner--sm spinner--white" /> Saving…</> : 'Save Menu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal {...confirmProps} />
    </div>
  );
}
