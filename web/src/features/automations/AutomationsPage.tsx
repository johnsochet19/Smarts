import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button, Card, EmptyState, Spinner } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { useProjects } from '@/lib/projects';
import { formatDate } from '@/lib/format';
import { ACTIONS, TRIGGERS } from './constants';
import type { Automation } from './types';
import { automationsApi } from './api';
import { AutomationBuilder } from './AutomationBuilder';
import './automations.css';

export function AutomationsPage() {
  const { activeId } = useProjects();
  const toast = useToast();
  const [items, setItems] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!activeId) { setLoading(false); return; }
    setLoading(true);
    automationsApi.list(activeId)
      .then((rows) => setItems(Array.isArray(rows) ? rows : []))
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load automations'))
      .finally(() => setLoading(false));
  }, [activeId, toast]);

  function upsert(a: Automation) {
    setItems((list) => {
      const i = list.findIndex((x) => x.id === a.id);
      if (i === -1) return [a, ...list];
      const next = list.slice(); next[i] = a; return next;
    });
  }

  async function toggle(a: Automation) {
    upsert({ ...a, enabled: !a.enabled });
    try { await automationsApi.update(a.id, { enabled: !a.enabled }); }
    catch (e) { upsert(a); toast.error(e instanceof Error ? e.message : 'Toggle failed'); }
  }

  async function remove(a: Automation) {
    if (!confirm(`Delete automation "${a.name}"?`)) return;
    setItems((list) => list.filter((x) => x.id !== a.id));
    try { await automationsApi.remove(a.id); } catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed'); }
  }

  const actions = <Button variant="primary" icon="plus" onClick={() => setCreating(true)} disabled={!activeId}>New automation</Button>;

  return (
    <AppShell title="Automations" actions={actions}>
      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading…</div>
      ) : !activeId ? (
        <EmptyState icon="grid" title="No project selected" hint="Pick a project to manage its automations." />
      ) : items.length === 0 ? (
        <EmptyState icon="grid" title="No automations yet"
          hint="Automate the busywork: when something happens, run conditions, then take actions."
          action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New automation</Button>} />
      ) : (
        <div className="au-list">
          {items.map((a) => {
            const trig = TRIGGERS.find((t) => t.value === a.trigger?.type);
            return (
              <Card key={a.id} className="au-card" hover>
                <button className={`au-switch${a.enabled ? ' au-switch--on' : ''}`} onClick={() => toggle(a)} aria-label={a.enabled ? 'Disable' : 'Enable'}>
                  <span className="au-switch__knob" />
                </button>
                <div className="au-card__main" onClick={() => setEditing(a)} style={{ cursor: 'pointer' }}>
                  <div className="au-card__name">{a.name}</div>
                  <div className="au-card__flow">
                    <span className="au-pill au-pill--when"><Icon name="alert" size={12} /> {trig?.label ?? a.trigger?.type}</span>
                    {(a.conditions?.length ?? 0) > 0 && <span className="au-pill">if {a.conditions.length} condition{a.conditions.length > 1 ? 's' : ''}</span>}
                    <Icon name="arrowRight" size={12} />
                    {(a.actions ?? []).slice(0, 3).map((ac, i) => (
                      <span key={i} className="au-pill au-pill--then">{ACTIONS.find((x) => x.value === ac.type)?.label ?? ac.type}</span>
                    ))}
                  </div>
                </div>
                <div className="bf-col" style={{ alignItems: 'flex-end', gap: 2 }}>
                  <span className="bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>{a.run_count ?? 0} runs</span>
                  {a.last_run && <span className="bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>last {formatDate(a.last_run)}</span>}
                </div>
                <Button variant="ghost" size="sm" iconOnly icon="trash" onClick={() => remove(a)} aria-label="Delete" />
              </Card>
            );
          })}
        </div>
      )}

      {creating && activeId && <AutomationBuilder projectId={activeId} onClose={() => setCreating(false)} onSaved={upsert} />}
      {editing && activeId && <AutomationBuilder projectId={activeId} existing={editing} onClose={() => setEditing(null)} onSaved={upsert} />}
    </AppShell>
  );
}
