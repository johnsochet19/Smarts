import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon, type IconName } from '../ui/Icon';
import { Avatar, Button, Select } from '../ui/primitives';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { useProjects } from '@/lib/projects';
import { useIsMobile } from '@/lib/hooks';
import { MODULES, GROUP_ORDER } from '@/features/modules/registry';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { AIAssistant } from '@/features/ai/AIAssistant';
import './shell.css';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  ported: boolean;
}

// Build grouped nav from the module registry, plus the bespoke pages
// (Dashboard, Sheets, Punchlist) that are rendered by dedicated components.
const GROUPS: Array<{ group: string; items: NavItem[] }> = (() => {
  const base = {
    dashboard: { to: '/', label: 'Dashboard', icon: 'dashboard', ported: true } as NavItem,
    sheets: { to: '/sheets', label: 'Sheets', icon: 'grid', ported: true } as NavItem,
    punchlist: { to: '/punchlist', label: 'Punchlist', icon: 'punch', ported: true } as NavItem,
    automations: { to: '/automations', label: 'Automations', icon: 'zap', ported: true } as NavItem,
    forms: { to: '/forms', label: 'Forms', icon: 'list', ported: true } as NavItem,
    notifications: { to: '/notifications', label: 'Notifications', icon: 'bell', ported: true } as NavItem,
    assistant: { to: '/assistant', label: 'AI Assistant', icon: 'zap', ported: true } as NavItem,
    analytics: { to: '/analytics', label: 'Analytics', icon: 'dashboard', ported: true } as NavItem,
    projects: { to: '/projects', label: 'Projects', icon: 'grid', ported: true } as NavItem,
    calendar: { to: '/calendar', label: 'Calendar', icon: 'calendar', ported: true } as NavItem,
    files: { to: '/files', label: 'Files', icon: 'list', ported: true } as NavItem,
    security: { to: '/security', label: 'Security', icon: 'user', ported: true } as NavItem,
  };
  const byGroup = new Map<string, NavItem[]>();
  byGroup.set('Overview', [base.dashboard, base.projects, base.analytics, base.calendar, base.sheets, base.notifications, base.assistant]);
  byGroup.set('Field', [base.punchlist, base.files]);
  byGroup.set('Admin', [base.security]);
  byGroup.set('Automate', [base.automations, base.forms]);
  for (const m of MODULES) {
    const item: NavItem = { to: `/${m.slug}`, label: m.title, icon: m.icon, ported: m.ported };
    const arr = byGroup.get(m.group) ?? [];
    arr.push(item);
    byGroup.set(m.group, arr);
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => ({ group, items: byGroup.get(group)! }));
})();

const MOBILE_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: 'dashboard', ported: true },
  { to: '/punchlist', label: 'Punchlist', icon: 'punch', ported: true },
  { to: '/sheets', label: 'Sheets', icon: 'grid', ported: true },
];

function ProjectPicker() {
  const { projects, activeId, setActiveId } = useProjects();
  if (!projects.length) return null;
  return (
    <Select value={activeId ?? ''} onChange={(e) => setActiveId(Number(e.target.value))} aria-label="Active project" style={{ maxWidth: 220 }}>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </Select>
  );
}

export function AppShell({ children, title, actions }: { children: ReactNode; title?: string; actions?: ReactNode }) {
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();

  const sidebar = (
    <nav className="bf-sidebar" aria-label="Primary">
      <div className="bf-brand">
        <span className="bf-brand__mark"><Icon name="punch" size={18} /></span>
        <span className="bf-brand__name">BuildForge</span>
      </div>
      <div className="bf-nav">
        {GROUPS.map(({ group, items }) => (
          <div className="bf-navgroup" key={group}>
            <div className="bf-navgroup__label">{group}</div>
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `bf-nav__item${isActive ? ' bf-nav__item--active' : ''}`}
                onClick={() => setNavOpen(false)}
              >
                <Icon name={item.icon} size={17} />
                <span className="bf-truncate">{item.label}</span>
                {!item.ported && <span className="bf-nav__tag" title="Opens in classic BuildForge">classic</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className="bf-sidebar__foot">
        <div className="bf-user">
          <Avatar name={user?.name} size={32} />
          <div style={{ minWidth: 0 }}>
            <div className="bf-truncate" style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{user?.name}</div>
            <div className="bf-truncate bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>{user?.role}</div>
          </div>
          <span className="bf-spacer" />
          <Button variant="ghost" size="sm" iconOnly icon="logout" onClick={logout} aria-label="Sign out" />
        </div>
      </div>
    </nav>
  );

  return (
    <div className="bf-shell">
      {!isMobile && sidebar}

      {isMobile && navOpen && (
        <>
          <div className="bf-scrim" onClick={() => setNavOpen(false)} />
          <div className="bf-sidebar bf-sidebar--drawer">{sidebar}</div>
        </>
      )}

      <div className="bf-main">
        <header className="bf-topbar">
          {isMobile && <Button variant="ghost" size="sm" iconOnly icon="menu" onClick={() => setNavOpen(true)} aria-label="Open menu" />}
          <h1 className="bf-topbar__title bf-truncate">{title}</h1>
          <span className="bf-spacer" />
          {!isMobile && <ProjectPicker />}
          <NotificationBell />
          <Button variant="ghost" size="sm" iconOnly icon={theme === 'dark' ? 'sun' : 'moon'} onClick={toggle} aria-label="Toggle theme" />
          {actions}
        </header>

        {isMobile && <div className="bf-subbar"><ProjectPicker /></div>}

        <main className="bf-content" key={location.pathname}>{children}</main>

        {isMobile && (
          <nav className="bf-bottomnav" aria-label="Primary mobile">
            {MOBILE_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'}
                className={({ isActive }) => `bf-bottomnav__item${isActive ? ' bf-bottomnav__item--active' : ''}`}>
                <Icon name={item.icon} size={21} />
                <span>{item.label}</span>
              </NavLink>
            ))}
            <button className="bf-bottomnav__item" onClick={() => setNavOpen(true)}>
              <Icon name="menu" size={21} />
              <span>More</span>
            </button>
          </nav>
        )}
      </div>

      {/* Global floating AI assistant */}
      <AIAssistant />
    </div>
  );
}
