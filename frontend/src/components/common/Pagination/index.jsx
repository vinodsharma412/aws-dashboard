import React from 'react';
import { PAGE_SIZE_OPTIONS } from '../../../hooks/usePagination';

function getPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const core = new Set([1, total, current, current - 1, current + 1].filter(p => p >= 1 && p <= total));
  const sorted = [...core].sort((a, b) => a - b);
  const pages = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) pages.push('…');
    pages.push(sorted[i]);
  }
  return pages;
}

export default function Pagination({ page, pageSize, totalRows, totalPages, start, end, onPageChange, onPageSizeChange }) {
  if (totalRows === 0) return null;

  const pages = getPageNumbers(page, totalPages);

  return (
    <div className="pagination">
      <span className="pagination-info">
        Showing <strong>{start}–{end}</strong> of <strong>{totalRows}</strong> rows
      </span>

      <div className="pagination-pages">
        <button
          className="page-btn page-btn--nav"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          title="Previous page"
        >‹</button>

        {pages.map((p, i) =>
          p === '…'
            ? <span key={`d${i}`} className="page-dots">…</span>
            : <button
                key={p}
                className={`page-btn${page === p ? ' page-btn--active' : ''}`}
                onClick={() => onPageChange(p)}
              >{p}</button>
        )}

        <button
          className="page-btn page-btn--nav"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          title="Next page"
        >›</button>
      </div>

      <div className="pagination-size">
        <span>Rows:</span>
        <select value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}>
          {PAGE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>
  );
}
