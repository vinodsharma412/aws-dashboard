import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PrivateRoute    from './PrivateRoute';
import RoleRoute       from './RoleRoute';
import Layout          from '../components/layout/Layout';
import Login           from '../pages/Login';
import Dashboard       from '../pages/Dashboard';
import Users           from '../pages/Users';
import Reports         from '../pages/Reports';
import Settings        from '../pages/Settings';
import Menus           from '../pages/Menus';
import MenuAccess      from '../pages/MenuAccess';
import AmazonScraper   from '../pages/AmazonScraper';
import EmailAction     from '../pages/EmailAction';
import ProductMaster   from '../pages/ProductMaster';
import StockDashboard  from '../pages/StockDashboard';
import Unauthorized    from '../pages/Unauthorized';

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login"        element={<Login />} />
      <Route path="/unauthorized" element={<Unauthorized />} />

      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>

        <Route index element={
          <RoleRoute roles={['admin', 'manager', 'viewer']}>
            <Dashboard />
          </RoleRoute>
        } />

        <Route path="users" element={
          <RoleRoute roles={['admin', 'manager']}>
            <Users />
          </RoleRoute>
        } />

        <Route path="reports" element={
          <RoleRoute roles={['admin', 'manager', 'viewer']}>
            <Reports />
          </RoleRoute>
        } />

        <Route path="settings" element={
          <RoleRoute roles={['admin']}>
            <Settings />
          </RoleRoute>
        } />

        <Route path="menus" element={
          <RoleRoute roles={['admin']}>
            <Menus />
          </RoleRoute>
        } />

        <Route path="menu-access" element={
          <RoleRoute roles={['admin']}>
            <MenuAccess />
          </RoleRoute>
        } />

        <Route path="scraper" element={
          <RoleRoute roles={['admin', 'manager', 'viewer']}>
            <AmazonScraper />
          </RoleRoute>
        } />

        <Route path="email-action" element={
          <RoleRoute roles={['admin', 'manager', 'viewer']}>
            <EmailAction />
          </RoleRoute>
        } />

        <Route path="product-master" element={
          <RoleRoute roles={['admin', 'manager']}>
            <ProductMaster />
          </RoleRoute>
        } />

        <Route path="stocks" element={
          <RoleRoute roles={['admin', 'manager', 'viewer']}>
            <StockDashboard />
          </RoleRoute>
        } />

      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default AppRoutes;
