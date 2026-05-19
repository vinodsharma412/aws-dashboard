import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Loader from '../components/common/Loader';

function RoleRoute({ children, roles }) {
  const { user, menus, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  // If menus are loaded from DB, check can_view for this path
  if (menus.length > 0) {
    const menu = menus.find(m => m.path === location.pathname || location.pathname.startsWith(m.path + '/'));
    if (menu && !menu.can_view) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return children;
}

export default RoleRoute;
