import api from './api';

export const productService = {
  list:   ()          => api.get('/products/'),
  get:    (id)        => api.get(`/products/${id}`),
  create: (data)      => api.post('/products/', data),
  update: (id, data)  => api.put(`/products/${id}`, data),
  remove: (id)        => api.delete(`/products/${id}`),
};

export const suggestionService = {
  list:   ()                  => api.get('/word-suggestions/'),
  create: (phrase, word_type) => api.post('/word-suggestions/', { phrase, word_type }),
  remove: (id)                => api.delete(`/word-suggestions/${id}`),
};
