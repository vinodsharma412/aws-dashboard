import api from './api';
import { TOKEN_KEY } from '../utils/constants';

export const authService = {
  login: async (username, password) => {
    const params = new URLSearchParams({ username, password });
    const res = await api.post('/auth/token', params);
    localStorage.setItem(TOKEN_KEY, res.data.access_token);
  },
  logout: () => localStorage.removeItem(TOKEN_KEY),
  getMe: () => api.get('/users/me'),
  isAuthenticated: () => !!localStorage.getItem(TOKEN_KEY),
};
