import api from './api';

export const menuService = {
  getMyMenus:        ()         => api.get('/menus/my-menus'),
  listMenus:         ()         => api.get('/menus/'),
  createMenu:        (data)     => api.post('/menus/', data),
  updateMenu:        (id, data) => api.put(`/menus/${id}`, data),
  deleteMenu:        (id)       => api.delete(`/menus/${id}`),

  listMenuAccess:    ()         => api.get('/menus/access/'),
  upsertMenuAccess:  (data)     => api.post('/menus/access/', data),
  updateMenuAccess:  (id, data) => api.put(`/menus/access/${id}`, data),
  deleteMenuAccess:  (id)       => api.delete(`/menus/access/${id}`),
};
