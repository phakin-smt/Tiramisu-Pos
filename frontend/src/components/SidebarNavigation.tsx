import { NavLink } from 'react-router-dom';

import { navigationItems } from './navigation';

export function SidebarNavigation() {
  return (
    <nav className="sidebar-navigation" aria-label="เมนูหลัก">
      <span className="navigation-heading">เมนูหลัก</span>
      {navigationItems.map((item) => (
        <NavLink
          key={item.path}
          className="navigation-link"
          to={item.path}
          aria-label={item.label}
        >
          <span className="navigation-marker" aria-hidden="true">{item.marker}</span>
          <span className="navigation-label-full">{item.label}</span>
          <span className="navigation-label-short">{item.shortLabel}</span>
        </NavLink>
      ))}
    </nav>
  );
}
