// Use env var if set, otherwise derive from current browser hostname
// so the app works from any network IP without rebuilding.
const apiHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const apiPort = process.env.REACT_APP_API_PORT || '9000';
export const API_URL = process.env.REACT_APP_API_URL || `http://${apiHost}:${apiPort}/api/v1`;

export const BACKEND_URL = API_URL.replace('/api/v1', '');
export const TOKEN_KEY = 'access_token';
