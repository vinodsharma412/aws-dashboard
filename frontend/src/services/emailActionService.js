import api from './api';

export const emailActionService = {
  sync:          ()           => api.post('/email/sync'),
  listMessages:  (params)     => api.get('/email/messages', { params }),
  getMessage:    (id)         => api.get(`/email/messages/${id}`),
  updateMessage: (id, data)   => api.patch(`/email/messages/${id}`, data),
  reanalyze:     (id)         => api.post(`/email/messages/${id}/reanalyze`),
  dashboard:     ()           => api.get('/email/dashboard'),
};
