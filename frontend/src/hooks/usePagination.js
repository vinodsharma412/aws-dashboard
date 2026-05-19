import { useState, useCallback } from 'react';

export const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];

export default function usePagination(defaultPageSize = 10) {
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const goTo      = useCallback(p    => setPage(p), []);
  const resetPage = useCallback(()   => setPage(1), []);
  const changeSize = useCallback(size => { setPageSize(size); setPage(1); }, []);

  const paginate = useCallback((rows) => {
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return {
      pageRows:   rows.slice(start, start + pageSize),
      totalRows:  total,
      totalPages,
      currentPage: safePage,
      start: total === 0 ? 0 : start + 1,
      end:   Math.min(start + pageSize, total),
    };
  }, [page, pageSize]);

  return { page, pageSize, goTo, resetPage, changeSize, paginate };
}
