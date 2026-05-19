import React, { useEffect, useState, useMemo } from 'react';
import { userService } from '../../services/userService';
import { useMenuAccess } from '../../hooks/useMenuAccess';
import { useSortFilter, applySort, applySearch } from '../../hooks/useSortFilter';
import usePagination from '../../hooks/usePagination';
import useConfirm from '../../hooks/useConfirm';
import SortTh from '../../components/common/SortTh';
import Pagination from '../../components/common/Pagination';
import ConfirmModal from '../../components/common/ConfirmModal';
import Toggle from '../../components/common/Toggle';

const ROLES      = ['admin', 'manager', 'viewer'];
const COLORS     = ['#1890ff','#52c41a','#faad14','#f5222d','#722ed1','#13c2c2','#eb2f96'];
const emptyForm  = { username: '', email: '', full_name: '', role: 'viewer', password: '', is_active: true };
const SEARCH_FLD = ['id', 'username', 'full_name', 'email', 'role'];

function validateUser(form, isCreate) {
  const e = {};
  if (isCreate) {
    if (!form.username.trim())                         e.username = 'Username is required.';
    else if (form.username.trim().length < 3)          e.username = 'Username must be at least 3 characters.';
    else if (!/^[a-zA-Z0-9._-]+$/.test(form.username.trim())) e.username = 'Only letters, numbers, dot, underscore and hyphen allowed.';
  }
  if (form.full_name && form.full_name.trim().length < 2) e.full_name = 'Full name must be at least 2 characters.';
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email address.';
  if (isCreate) {
    if (!form.password)              e.password = 'Password is required.';
    else if (form.password.length < 6) e.password = 'Password must be at least 6 characters.';
  } else {
    if (form.password && form.password.length < 6) e.password = 'Password must be at least 6 characters.';
  }
  return e;
}

function initials(name = '') { return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?'; }
function avatarBg(name = '') { return COLORS[(name.charCodeAt(0) || 0) % COLORS.length]; }

export default function Users() {
  const access = useMenuAccess('/users');
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [modal,      setModal]      = useState(null);
  const [form,       setForm]       = useState(emptyForm);
  const [saving,     setSaving]     = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [formErrors, setFormErrors] = useState({});

  const sf  = useSortFilter('id');
  const pg  = usePagination(10);
  const { confirm, confirmProps } = useConfirm();

  const rows = useMemo(() => {
    let r = applySearch(users, sf.search, SEARCH_FLD);
    if (sf.filterValues.role)   r = r.filter(u => u.role === sf.filterValues.role);
    if (sf.filterValues.status) r = r.filter(u =>
      sf.filterValues.status === 'active' ? u.is_active : !u.is_active
    );
    return applySort(r, sf.sortBy);
  }, [users, sf.search, sf.filterValues, sf.sortBy]);

  // reset to page 1 when filter/search changes
  useEffect(() => { pg.resetPage(); }, [sf.search, sf.filterValues]); // eslint-disable-line

  const { pageRows, totalRows, totalPages, currentPage, start, end } = pg.paginate(rows);

  const load = async () => {
    try {
      setLoading(true);
      const res = await userService.listUsers();
      setUsers(res.data);
    } catch {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setForm(emptyForm); setEditId(null); setFormErrors({}); setModal('create'); };
  const openEdit   = u  => {
    setForm({ username: u.username, email: u.email || '', full_name: u.full_name || '',
              role: u.role, password: '', is_active: u.is_active });
    setEditId(u.id);
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
    const errs = validateUser(form, modal === 'create');
    if (errs[name]) setFormErrors(fe => ({ ...fe, [name]: errs[name] }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    const errs = validateUser(form, modal === 'create');
    if (Object.keys(errs).length) { setFormErrors(errs); return; }
    setSaving(true);
    setError('');
    try {
      if (modal === 'create') {
        await userService.createUser(form);
      } else {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        await userService.updateUser(editId, payload);
      }
      closeModal();
      load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async id => {
    const ok = await confirm({
      title:        'Delete User',
      message:      'This will permanently remove the user account. This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel:  'Keep',
      variant:      'danger',
      icon:         '🗑',
    });
    if (!ok) return;
    try {
      await userService.deleteUser(id);
      load();
    } catch {
      setError('Delete failed. Please try again.');
    }
  };

  const chips = [
    sf.filterValues.role   && { key: 'role',   label: `Role: ${sf.filterValues.role}` },
    sf.filterValues.status && { key: 'status', label: `Status: ${sf.filterValues.status}` },
  ].filter(Boolean);

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2>User Management</h2>
          <p className="page-subtitle">{users.length} user{users.length !== 1 ? 's' : ''} registered</p>
        </div>
        {access.canInsert && (
          <button className="btn btn-primary" onClick={openCreate}>＋ Add User</button>
        )}
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
            placeholder="Search by name, email, username…"
            value={sf.search}
            onChange={e => sf.setSearch(e.target.value)}
          />
          {sf.search && (
            <button className="filter-input-clear" onClick={() => sf.setSearch('')} title="Clear search">×</button>
          )}
        </div>

        <select
          className={`filter-select${sf.filterValues.role ? ' is-active' : ''}`}
          value={sf.filterValues.role || ''}
          onChange={e => sf.setFilter('role', e.target.value)}
        >
          <option value="">All Roles</option>
          {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
        </select>

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
          <button className="btn btn-sm btn-secondary" onClick={sf.clearAll} title="Clear all filters">
            ✕ Clear
          </button>
        )}

        <span className="filter-count">
          <strong>{rows.length}</strong> / {users.length}
        </span>
      </div>

      {chips.length > 0 && (
        <div className="filter-chips">
          {chips.map(c => (
            <span key={c.key} className="filter-chip">
              {c.label}
              <button className="filter-chip-remove" onClick={() => sf.setFilter(c.key, '')} title="Remove filter">×</button>
            </span>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="page-loading"><div className="spinner" /> Loading users…</div>
      ) : (
        <>
          <div className="table-responsive">
            <table className="data-table freeze-2">
              <thead>
                <tr>
                  <SortTh col="id"        label="#"      sortBy={sf.sortBy} onSort={sf.handleSort} />
                  <SortTh col="username"  label="User"   sortBy={sf.sortBy} onSort={sf.handleSort} />
                  <SortTh col="email"     label="Email"  sortBy={sf.sortBy} onSort={sf.handleSort} />
                  <SortTh col="role"      label="Role"   sortBy={sf.sortBy} onSort={sf.handleSort} />
                  <SortTh col="is_active" label="Status" sortBy={sf.sortBy} onSort={sf.handleSort} />
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table-empty">
                      <span className="table-empty-icon">🔍</span>
                      {sf.hasFilters ? 'No users match your filters.' : 'No users yet.'}
                    </td>
                  </tr>
                ) : pageRows.map(u => (
                  <tr key={u.id}>
                    <td style={{ color: 'var(--text-3)', fontWeight: 500 }}>{u.id}</td>
                    <td>
                      <div className="user-cell">
                        <div className="avatar avatar-sm" style={{ background: avatarBg(u.username), color: '#fff' }}>
                          {initials(u.full_name || u.username)}
                        </div>
                        <div>
                          <div className="user-cell-name">{u.username}</div>
                          {u.full_name && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{u.full_name}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-3)' }}>{u.email || '—'}</td>
                    <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                    <td>
                      <span className={`status-dot status-dot--${u.is_active ? 'active' : 'inactive'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="actions">
                      {access.canUpdate && (
                        <button className="btn btn-sm btn-secondary" onClick={() => openEdit(u)}>✏ Edit</button>
                      )}
                      {access.canDelete && (
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(u.id)} title="Delete user">🗑</button>
                      )}
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
              <h3>{modal === 'create' ? '＋ Add User' : '✏ Edit User'}</h3>
              <button className="modal-close" onClick={closeModal} aria-label="Close">×</button>
            </div>
            <form onSubmit={handleSubmit}>
              {error && <div className="alert alert--error"><span className="alert-icon">⚠</span>{error}</div>}
              {modal === 'create' && (
                <div className="form-group">
                  <label>Username *</label>
                  <input name="username" value={form.username} onChange={handleChange} onBlur={handleBlur}
                    className={formErrors.username ? 'input-error' : ''}
                    placeholder="e.g. john.doe" autoComplete="off" />
                  {formErrors.username && <span className="field-error">⚠ {formErrors.username}</span>}
                </div>
              )}
              <div className="form-group">
                <label>Full Name</label>
                <input name="full_name" value={form.full_name} onChange={handleChange} onBlur={handleBlur}
                  className={formErrors.full_name ? 'input-error' : ''}
                  placeholder="e.g. John Doe" />
                {formErrors.full_name && <span className="field-error">⚠ {formErrors.full_name}</span>}
              </div>
              <div className="form-group">
                <label>Email</label>
                <input name="email" type="email" value={form.email} onChange={handleChange} onBlur={handleBlur}
                  className={formErrors.email ? 'input-error' : ''}
                  placeholder="e.g. john@example.com" />
                {formErrors.email && <span className="field-error">⚠ {formErrors.email}</span>}
              </div>
              <div className="form-group">
                <label>Role</label>
                <select name="role" value={form.role} onChange={handleChange}>
                  {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>{modal === 'create' ? 'Password *' : 'New Password (leave blank to keep)'}</label>
                <input name="password" type="password" value={form.password} onChange={handleChange} onBlur={handleBlur}
                  className={formErrors.password ? 'input-error' : ''}
                  placeholder={modal === 'create' ? 'Min 6 characters' : '••••••••'}
                  autoComplete="new-password" />
                {formErrors.password && <span className="field-error">⚠ {formErrors.password}</span>}
              </div>
              <div className="form-group">
                <label style={{ marginBottom: 10 }}>Account Status</label>
                <Toggle
                  name="is_active"
                  checked={form.is_active}
                  onChange={handleChange}
                  label={form.is_active ? 'Account is active' : 'Account is inactive'}
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner spinner--sm spinner--white" /> Saving…</> : 'Save User'}
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
