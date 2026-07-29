import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Card, EmptyState, Spinner, Button, Avatar } from '@/components/ui/primitives';
import { useProjects } from '@/lib/projects';
import { useAuth } from '@/lib/auth';
import { usePunchItems } from '@/features/punchlist/api';
import { STATUS_META, PUNCH_STATUSES } from '@/features/punchlist/constants';
import { StatusBadge, DueChip } from '@/features/punchlist/components';
import './dashboard.css';

export function DashboardPage() {
  const { activeId, active, loading: projLoading } = useProjects();
  const { user } = useAuth();
  const { items, loading } = usePunchItems(activeId);

  const stats = useMemo(() => {
    const byStatus = Object.fromEntries(PUNCH_STATUSES.map((s) => [s, 0])) as Record<string, number>;
    let overdue = 0;
    const todayStart = new Date(new Date().toDateString());
    for (const it of items) {
      byStatus[it.status] = (byStatus[it.status] ?? 0) + 1;
      if (it.due_date && it.status !== 'closed' && new Date(it.due_date) < todayStart) overdue++;
    }
    const total = items.length;
    const closed = byStatus['closed'] ?? 0;
    const completion = total ? Math.round((closed / total) * 100) : 0;
    return { byStatus, overdue, total, closed, open: total - closed, completion };
  }, [items]);

  const recent = useMemo(
    () => [...items].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')).slice(0, 6),
    [items]
  );
  const dueSoon = useMemo(
    () =>
      items
        .filter((i) => i.due_date && i.status !== 'closed')
        .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
        .slice(0, 6),
    [items]
  );

  const maxStatus = Math.max(1, ...PUNCH_STATUSES.map((s) => stats.byStatus[s] ?? 0));

  return (
    <AppShell title="Dashboard">
      <div className="db-hello">
        <div>
          <h2 style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em' }}>
            {greeting()}, {user?.name?.split(' ')[0] ?? 'there'}
          </h2>
          <p className="bf-muted">{active ? active.name : 'Select a project to see live metrics.'}</p>
        </div>
        <Link to="/punchlist"><Button variant="primary" icon="punch">Open Punchlist</Button></Link>
      </div>

      {projLoading || loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading metrics…</div>
      ) : !activeId ? (
        <EmptyState icon="dashboard" title="No project yet" hint="Create a project in BuildForge to populate your dashboard." />
      ) : (
        <>
          <div className="db-kpis">
            <Kpi label="Total items" value={stats.total} />
            <Kpi label="Open" value={stats.open} color="var(--status-open)" />
            <Kpi label="Overdue" value={stats.overdue} color="var(--red-500)" />
            <Kpi label="Completion" value={`${stats.completion}%`} color="var(--status-closed)" />
          </div>

          <div className="db-grid">
            <Card pad>
              <h3 className="db-card-title">Status breakdown</h3>
              <div className="db-bars">
                {PUNCH_STATUSES.map((s) => (
                  <div className="db-bar-row" key={s}>
                    <span className="db-bar-label">{STATUS_META[s].label}</span>
                    <div className="db-bar-track">
                      <div className="db-bar-fill" style={{ width: `${((stats.byStatus[s] ?? 0) / maxStatus) * 100}%`, background: STATUS_META[s].color }} />
                    </div>
                    <span className="db-bar-val">{stats.byStatus[s] ?? 0}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card pad>
              <h3 className="db-card-title">Due soon</h3>
              {dueSoon.length === 0 ? (
                <p className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>Nothing due. Nice and clear.</p>
              ) : (
                <div className="bf-col bf-gap-3">
                  {dueSoon.map((it) => (
                    <div key={it.id} className="db-mini-row">
                      <span className="bf-mono bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>#{it.punch_number ?? it.id}</span>
                      <span className="bf-truncate" style={{ flex: 1 }}>{it.title}</span>
                      <DueChip date={it.due_date} />
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card pad className="db-span">
              <h3 className="db-card-title">Recent activity</h3>
              {recent.length === 0 ? (
                <p className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>No items yet.</p>
              ) : (
                <div className="bf-col bf-gap-2">
                  {recent.map((it) => (
                    <div key={it.id} className="db-mini-row">
                      <span className="bf-mono bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>#{it.punch_number ?? it.id}</span>
                      <span className="bf-truncate" style={{ flex: 1 }}>{it.title}</span>
                      {it.assignee_name && <Avatar name={it.assignee_name} size={24} />}
                      <StatusBadge status={it.status} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </AppShell>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function Kpi({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <Card pad hover className="db-kpi">
      <span className="db-kpi__value" style={{ color: color ?? 'var(--text)' }}>{value}</span>
      <span className="db-kpi__label">{label}</span>
    </Card>
  );
}
