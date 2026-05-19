import { useState, useCallback } from 'react';

/**
 * Manages sort column/direction + free-text search + keyed dropdown filters.
 * Actual row filtering/sorting lives in a useMemo in the consuming component
 * so each page can apply its own field logic.
 */
export function useSortFilter(defaultSortCol = '') {
  const [search,       setSearch]       = useState('');
  const [sortBy,       setSortBy]       = useState({ col: defaultSortCol, dir: 'asc' });
  const [filterValues, setFilterValues] = useState({});

  const handleSort = useCallback(col => {
    setSortBy(prev => ({
      col,
      dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const setFilter = useCallback((key, val) => {
    setFilterValues(f => ({ ...f, [key]: val }));
  }, []);

  const clearAll = useCallback(() => {
    setSearch('');
    setFilterValues({});
    setSortBy({ col: defaultSortCol, dir: 'asc' });
  }, [defaultSortCol]);

  const hasFilters = !!(
    search.trim() || Object.values(filterValues).some(v => v !== '')
  );

  return {
    search, setSearch,
    sortBy, handleSort,
    filterValues, setFilter,
    clearAll, hasFilters,
  };
}

/** Sort an array by column + direction. Handles string / number / boolean. */
export function applySort(rows, sortBy) {
  if (!sortBy.col) return rows;
  return [...rows].sort((a, b) => {
    const va = a[sortBy.col] ?? '';
    const vb = b[sortBy.col] ?? '';
    let cmp;
    if (typeof va === 'boolean')    cmp = va === vb ? 0 : va ? -1 : 1;
    else if (typeof va === 'number') cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    return sortBy.dir === 'asc' ? cmp : -cmp;
  });
}

/** Case-insensitive substring match across a list of field names. */
export function applySearch(rows, search, fields) {
  if (!search.trim()) return rows;
  const q = search.toLowerCase();
  return rows.filter(row =>
    fields.some(f => String(row[f] ?? '').toLowerCase().includes(q))
  );
}
