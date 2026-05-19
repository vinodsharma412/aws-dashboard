import React from 'react';

/**
 * Sortable <th> cell.
 *
 * Props:
 *   col      — field key to sort by
 *   label    — header display text
 *   sortBy   — { col, dir } from useSortFilter
 *   onSort   — handleSort from useSortFilter
 */
export default function SortTh({ col, label, sortBy, onSort }) {
  const active = sortBy.col === col;
  const icon   = active ? (sortBy.dir === 'asc' ? '▲' : '▼') : '⇅';

  return (
    <th
      className={`sortable${active ? ' sorted' : ''}`}
      onClick={() => onSort(col)}
      title={`Sort by ${label}`}
    >
      {label}
      <span className="sort-icon">{icon}</span>
    </th>
  );
}
