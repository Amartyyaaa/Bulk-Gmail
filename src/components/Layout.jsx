import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, LogOut, Mail, Menu, Send, Settings, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from './ui.jsx';

const NAV = [
  { to: '/quick-send', label: 'Quick send', icon: Send },
  { to: '/campaigns', label: 'Campaigns', icon: Mail },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout() {
  const { profile, user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className={`app-shell ${open ? 'nav-open' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>

      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label="Open navigation">
          <Menu size={20} />
        </button>
        <span className="brand-name">Mailroom</span>
      </header>

      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><Mail size={18} /></span>
          <span className="brand-name">Mailroom</span>
          <button type="button" className="icon-btn nav-close" onClick={() => setOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>
        <nav>
          <ul>
            {NAV.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <Icon size={18} aria-hidden="true" />
                  <span className="nav-label">{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">{(profile?.email || user?.email || '?')[0].toUpperCase()}</span>
            <span className="user-meta">
              <span className="user-email" title={user?.email}>{user?.email}</span>
              <span className="user-role">{profile?.role ?? '…'}</span>
            </span>
          </div>
          <button type="button" className="nav-link" onClick={signOut}>
            <LogOut size={18} aria-hidden="true" />
            <span className="nav-label">Sign out</span>
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />

      <main id="main" className="main" tabIndex={-1}>
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
