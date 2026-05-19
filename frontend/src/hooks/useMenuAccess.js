import { useAuth } from '../context/AuthContext';

export function useMenuAccess(path) {
  const { menus } = useAuth();
  const menu = menus?.find(m => m.path === path);
  return {
    canView:   menu?.can_view   ?? false,
    canInsert: menu?.can_insert ?? false,
    canUpdate: menu?.can_update ?? false,
    canDelete: menu?.can_delete ?? false,
  };
}
