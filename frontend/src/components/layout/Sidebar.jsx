import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

function Sidebar({ isOpen, onClose }) {
  const { user, menus } = useAuth();

  return (
    <aside className={`sidebar${isOpen ? ' sidebar--open' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-inner">
          <div className="sidebar-logo">M</div>
          <span className="sidebar-name">MyApp</span>
        </div>
        <button className="sidebar-close" onClick={onClose} aria-label="Close menu">×</button>
      </div>

      <nav className="sidebar-nav">
        {menus.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => `menu-item${isActive ? ' active' : ''}`}
            onClick={onClose}
          >
            {item.icon && <span className="menu-icon">{item.icon}</span>}
            <span className="menu-label">{item.name}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-role">
        ● {user?.role}
      </div>
    </aside>
  );
}

export default Sidebar;
