import api from './api';

export const userService = {
  listUsers:    ()         => api.get('/users/'),
  createUser:   (data)     => api.post('/users/', data),
  updateUser:   (id, data) => api.put(`/users/${id}`, data),
  deleteUser:   (id)       => api.delete(`/users/${id}`),
  uploadAvatar: (file)     => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/users/me/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  removeAvatar: () => api.delete('/users/me/avatar'),
};
