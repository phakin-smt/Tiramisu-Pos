import { NavLink } from 'react-router-dom';

import { navigationItems } from './navigation';

export function MobileNavigation() {
  return (
    <nav className="mobile-navigation" aria-label="เมนูมือถือ">
      {navigationItems.map((item) => (
        <NavLink
          key={item.path}
          className="mobile-navigation-link"
          to={item.path}
          aria-label={item.label}
        >
          <span className="navigation-marker" aria-hidden="true">{item.marker}</span>
          <span>{item.shortLabel}</span>
        </NavLink>
      ))}
    </nav>
  );
}
