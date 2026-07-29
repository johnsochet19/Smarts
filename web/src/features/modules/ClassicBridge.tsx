import { AppShell } from '@/components/layout/AppShell';
import { Button, Card } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import type { ModuleConfig } from './types';

// Legacy app base URL (the current BuildForge UI). Configured via env so the
// "open in classic" links work in every environment.
const LEGACY_BASE = (import.meta.env.VITE_LEGACY_BASE || '').replace(/\/$/, '');

/**
 * Placeholder-free bridge for modules not yet rebuilt in the new design:
 * the feature is fully preserved in the existing app and reachable from here,
 * so nothing is lost while the redesign rolls out module by module.
 */
export function ClassicBridge({ cfg }: { cfg: ModuleConfig }) {
  const href = LEGACY_BASE ? `${LEGACY_BASE}${cfg.classicPath ?? ''}` : null;
  return (
    <AppShell title={cfg.title}>
      <div style={{ maxWidth: 560, margin: '0 auto', paddingTop: 'var(--space-10)' }}>
        <Card pad>
          <div className="bf-row bf-gap-3" style={{ marginBottom: 'var(--space-4)' }}>
            <span className="bf-empty__icon" style={{ width: 44, height: 44 }}><Icon name={cfg.icon} size={22} /></span>
            <div>
              <h2 style={{ fontSize: 'var(--text-lg)' }}>{cfg.title}</h2>
              <p className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>Available now in classic BuildForge</p>
            </div>
          </div>
          <p className="bf-muted" style={{ marginBottom: 'var(--space-5)' }}>
            This module is fully functional in your current app. It hasn’t been moved into the
            new design yet — it’s queued in the rebuild and will appear here, redesigned, in a
            later increment. Your data and workflow are unchanged in the meantime.
          </p>
          {href ? (
            <a href={href} target="_blank" rel="noreferrer">
              <Button variant="primary" icon="arrowRight">Open {cfg.title} in classic BuildForge</Button>
            </a>
          ) : (
            <div className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>
              Set <code className="bf-mono">VITE_LEGACY_BASE</code> to your existing app URL to enable a direct link here.
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
