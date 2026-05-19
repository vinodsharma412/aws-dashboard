import api from './api';

export const stockService = {
  search:             (q)             => api.get('/stocks/search', { params: { q } }),
  basicQuote:         (symbol)        => api.get(`/stocks/basic/${symbol}`),
  analyse:            (symbol)        => api.get(`/stocks/analyse/${symbol}`),
  chart:              (symbol, period) => api.get(`/stocks/chart/${symbol}`, { params: { period } }),
  sentiment:          (symbol)        => api.get(`/stocks/sentiment/${symbol}`),
  financials:         (symbol)        => api.get(`/stocks/financials/${symbol}`),
  screener:           (params)        => api.get('/stocks/screener', { params }),
  globalMarkets:      ()              => api.get('/stocks/market/global'),
  getPortfolio:       ()              => api.get('/stocks/portfolio'),
  portfolioInsights:  ()              => api.get('/stocks/portfolio/insights'),
  addTransaction:     (data)          => api.post('/stocks/portfolio/transactions', data),
  deleteTransaction:  (id)            => api.delete(`/stocks/portfolio/transactions/${id}`),
  getWatchlist:       ()              => api.get('/stocks/watchlist'),
  addWatchlist:       (data)          => api.post('/stocks/watchlist', data),
  removeWatchlist:    (id)            => api.delete(`/stocks/watchlist/${id}`),
};
