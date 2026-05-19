import React, { useEffect, useState, useMemo } from 'react';
import { menuService } from '../../services/menuService';
import { useSortFilter, applySort, applySearch } from '../../hooks/useSortFilter';
import usePagination from '../../hooks/usePagination';
import useConfirm from '../../hooks/useConfirm';
import SortTh from '../../components/common/SortTh';
import Pagination from '../../components/common/Pagination';
import ConfirmModal from '../../components/common/ConfirmModal';

const ROLES  = ['admin', 'manager', 'viewer'];
const PERMS  = ['can_view', 'can_insert', 'can_update', 'can_delete'];
const PERM_LABELS = { can_view: 'View', can_insert: 'Insert', can_update: 'Update', can_delete: 'Delete' };
const SEARCH_FLD  = ['menu_name', 'role'];

const emptyAccessForm = {
  menu_id: '', role: 'viewer',
  can_view: false, can_insert: false, can_update: false, can_delete: false,
};

function validateAccess(form) {
  const e = {};
  if (!form.menu_id) e.menu_id = 'Please select a menu.';
  if (!form.can_view && !form.can_insert && !form.can_update && !form.can_delete)
    e.perms = 'Select at least one permission.';
  return e;
}

export default function MenuAccess() {
  const [menus,     setMenus]     = useState([]);
  const [access,    setAccess]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [saving,    setSaving]    = useState(null);
  const [modal,      setModal]      = useState(false);
  const [form,       setForm]       = useState(emptyAccessForm);
  const [addSaving,  setAddSaving]  = useState(false);
  const [formErrors, setFormErrors] = useState({});

  const sf = useSortFilter('menu_name');
  const pg = usePagination(10);
  const { confirm, confirmProps } = useConfirm();

  const menuNames = useMemo(() =>
    [...new Set(access.map(a => a.menu_name))].sort(),
  [access]);

  const rows = useMemo(() => {
    let r = applySearch(access, sf.search, SEARCH_FLD);
    if (sf.filterValues.menu) r = r.filter(a => a.menu_name === sf.filterValues.menu);
    if (sf.filterValues.role) r = r.filter(a => a.role === sf.filterValues.role);
    return applySort(r, sf.sortBy);
  }, [access, sf.search, sf.filterValues, sf.sortBy]);

  // reset to page 1 when filter/search changes
  useEffect(() => { pg.resetPage(); }, [sf.search, sf.filterValues]); // eslint-disable-line

  const { pageRows, totalRows, totalPages, currentPage, start, end } = pg.paginate(rows);

  const load = async () => {
    try {
      setLoading(true);
      const [mRes, aRes] = await Promise.all([
        menuService.listMenus(),
        menuService.listMenuAccess(),
      ]);
      setMenus(mRes.data);
      setAccess(aRes.data);
    } catch {
      setError('Failed to load data.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const togglePerm = async (row, perm) => {
    setSaving(row.id);
    try {
      const next = !row[perm];
      await menuService.updateMenuAccess(row.id, { [perm]: next });
      setAccess(prev => prev.map(a => a.id === row.id ? { ...a, [perm]: next } : a));
    } catch {
      setError('Permission update failed. Please try again.');
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async id => {
    const ok = await confirm({
      title:        'Remove Access Rule',
      message:      'This role will lose all permissions for this menu item.',
      confirmLabel: 'Remove',
      cancelLabel:  'Keep',
      variant:      'danger',
      icon:         '🔑',
    });
    if (!ok) return;
    try {
      await menuService.deleteMenuAccess(id);
      setAccess(prev => prev.filter(a => a.id !== id));
    } catch {
      setError('Delete failed. Please try again.');
    }
  };

  const openAdd = () => { setForm(emptyAccessForm); setError(''); setFormErrors({}); setModal(true); };

  const handleFormChange = e => {
    const { name, value, type, checked } = e.target;
    const updated = { ...form, [name]: type === 'checkbox' ? checked : value };
    setForm(updated);
    const errs = validateAccess(updated);
    setFormErrors(fe => ({ ...fe, [name]: errs[name] || '', perms: errs.perms || '' }));
  };

  const handleAdd = async e => {
    e.preventDefault();
    const errs = validateAccess(form);
    if (Object.keys(errs).length) { setFormErrors(errs); return; }
    setAddSaving(true);
    setError('');
    try {
      await menuService.upsertMenuAccess({ ...form, menu_id: Number(form.menu_id) });
      setModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed.');
    } finally {
      setAddSaving(false);
    }
  };

  const chips = [
    sf.filterValues.menu && { key: 'menu', label: `Menu: ${sf.filterValues.menu}` },
    sf.filterValues.role && { key: 'role', label: `Role: ${sf.filterValues.role}` },
  ].filter(Boolean);

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2>Menu Access Control</h2>
          <p className="page-subtitle">{access.length} access rule{access.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>＋ Add Rule</button>
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
            placeholder="Search by menu name or role…"
            value={sf.search}
            onChange={e => sf.setSearch(e.target.value)}
          />
          {sf.search && (
            <button className="filter-input-clear" onClick={() => sf.setSearch('')} title="Clear search">×</button>
          )}
        </div>

        <select
          className={`filter-select${sf.filterValues.menu ? ' is-active' : ''}`}
          value={sf.filterValues.menu || ''}
          onChange={e => sf.setFilter('menu', e.target.value)}
        >
          <option value="">All Menus</option>
          {menuNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        <select
          className={`filter-select${sf.filterValues.role ? ' is-active' : ''}`}
          value={sf.filterValues.role || ''}
          onChange={e => sf.setFilter('role', e.target.value)}
        >
          <option value="">All Roles</option>
          {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
        </select>

        {sf.hasFilters && (
          <button className="btn btn-sm btn-secondary" onClick={sf.clearAll}>✕ Clear</button>
        )}

        <span className="filter-count">
          <strong>{rows.length}</strong> / {access.length}
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
        <div className="page-loading"><div className="spinner" /> Loading access rules…</div>
      ) : (
        <>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <SortTh col="menu_name" label="Menu"   sortBy={sf.sortBy} onSort={sf.handleSort} />
                  <SortTh col="role"      label="Role"   sortBy={sf.sortBy} onSort={sf.handleSort} />
                  {PERMS.map(p => (
                    <SortTh key={p} col={p} label={PERM_LABELS[p]} sortBy={sf.sortBy} onSort={sf.handleSort} />
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="table-empty">
                      <span className="table-empty-icon">🔑</span>
                      {sf.hasFilters ? 'No rules match your filters.' : 'No access rules defined.'}
                    </td>
                  </tr>
                ) : pageRows.map(row => (
                  <tr key={row.id} style={saving === row.id ? { opacity: 0.6 } : {}}>
                    <td style={{ fontWeight: 600 }}>{row.menu_name}</td>
                    <td><span className={`badge badge-${row.role}`}>{row.role}</span></td>
                    {PERMS.map(perm => (
                      <td key={perm} className="perm-cell">
                        <input
                          type="checkbox"
                          checked={row[perm]}
                          disabled={saving === row.id}
                          onChange={() => togglePerm(row, perm)}
                          title={`Toggle ${PERM_LABELS[perm]}`}
                        />
                      </td>
                    ))}
                    <td className="actions">
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(row.id)} title="Remove rule">
                        🗑 Remove
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

      {/* ── Add modal ── */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>＋ Add Access Rule</h3>
              <button className="modal-close" onClick={() => { setModal(false); setFormErrors({}); setError(''); }}>×</button>
            </div>
            <form onSubmit={handleAdd}>
              {error && <div className="alert alert--error"><span className="alert-icon">⚠</span>{error}</div>}
              <div className="form-group">
                <label>Menu *</label>
                <select name="menu_id" value={form.menu_id} onChange={handleFormChange}
                  className={formErrors.menu_id ? 'input-error' : ''}>
                  <option value="">— Select menu —</option>
                  {menus.map(m => <option key={m.id} value={m.id}>{m.icon} {m.name} ({m.path})</option>)}
                </select>
                {formErrors.menu_id && <span className="field-error">⚠ {formErrors.menu_id}</span>}
              </div>
              <div className="form-group">
                <label>Role *</label>
                <select name="role" value={form.role} onChange={handleFormChange}>
                  {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Permissions</label>
                <div className="perm-checkboxes">
                  {PERMS.map(perm => (
                    <label key={perm} className="perm-label">
                      <input type="checkbox" name={perm} checked={form[perm]} onChange={handleFormChange} />
                      {PERM_LABELS[perm]}
                    </label>
                  ))}
                </div>
                {formErrors.perms && <span className="field-error">⚠ {formErrors.perms}</span>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => { setModal(false); setFormErrors({}); setError(''); }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={addSaving}>
                  {addSaving ? <><span className="spinner spinner--sm spinner--white" /> Saving…</> : 'Save Rule'}
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
