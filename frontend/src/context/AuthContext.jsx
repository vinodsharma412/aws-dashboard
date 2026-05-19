import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/authService';
import { menuService } from '../services/menuService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [menus,   setMenus]   = useState([]);
  const [loading, setLoading] = useState(true);

  const loadMenus = useCallback(async () => {
    try {
      const res = await menuService.getMyMenus();
      setMenus(res.data);
    } catch {
      setMenus([]);
    }
  }, []);

  useEffect(() => {
    if (authService.isAuthenticated()) {
      authService.getMe()
        .then(res => {
          setUser(res.data);
          return loadMenus();
        })
        .catch(() => authService.logout())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [loadMenus]);

  const login = async (username, password) => {
    await authService.login(username, password);
    const res = await authService.getMe();
    setUser(res.data);
    await loadMenus();
  };

  const logout = () => {
    authService.logout();
    setUser(null);
    setMenus([]);
  };

  const updateUser = (partial) => setUser(prev => ({ ...prev, ...partial }));

  return (
    <AuthContext.Provider value={{ user, menus, loading, login, logout, updateUser, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
