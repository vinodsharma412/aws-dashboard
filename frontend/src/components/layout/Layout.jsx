import React, { useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar  from './Sidebar';
import TopPanel from './TopPanel';

const IS_PROD = process.env.REACT_APP_STAGE === 'prod';

function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = useCallback(() => setSidebarOpen(v => !v), []);
  const closeSidebar  = useCallback(() => setSidebarOpen(false),   []);

  return (
    <div className="layout">
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />

      {/* Backdrop — visible on mobile when sidebar is open */}
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={closeSidebar} aria-hidden="true" />
      )}

      <div className="main-area">
        {IS_PROD && (
          <div className="prod-banner" role="alert">
            ⚠ LIVE — PRODUCTION &nbsp;·&nbsp; Changes affect real data
          </div>
        )}
        <TopPanel onToggleSidebar={toggleSidebar} />
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default Layout;
