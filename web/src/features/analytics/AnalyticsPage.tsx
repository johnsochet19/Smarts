import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Card, EmptyState, Spinner } from '@/components/ui/primitives';
import { useProjects } from '@/lib/projects';
import { titleCase } from '@/lib/format';
import { usePunchItems } from '@/features/punchlist/api';
import { PUNCH_STATUSES, STATUS_META } from '@/features/punchlist/constants';
import { scheduleApi } from '@/features/schedule/api';
import type { Task } from '@/features/schedule/types';
import { HBar, Donut } from './charts';
import './analytics.css';

export function AnalyticsPage() {
  const { activeId } = useProjects();
  const { items: punch, loading: punchLoading } = usePunchItems(activeId);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);

  useEffect(() => {
    if (!activeId) { setTasksLoaded(true); return; }
    scheduleApi.listTasks(activeId).then((t) => setTasks(Array.isArray(t) ? t : [])).catch(() => setTasks([])).finally(() => setTasksLoaded(true));
  }, [activeId]);

  const a = useMemo(() => {
    const today = new Date(new Date().toDateString());
    const dayMs = 86400000;

    // Punchlist
    const total = punch.length;
    const closed = punch.filter((p) => p.status === 'closed').length;
    const open = total - closed;
    const overdue = punch.filter((p) => p.due_date && p.status !== 'closed' && new Date(p.due_date) < today).length;
    const completion = total ? Math.round((closed / total) * 100) : 0;

    const byStatus = PUNCH_STATUSES.map((s) => ({ label: STATUS_META[s].label, value: punch.filter((p) => p.status === s).length, color: STATUS_META[s].color }));

    // Aging buckets (open items, by age since created)
    const buckets = [{ label: '0–7 days', n: 0 }, { label: '8–14 days', n: 0 }, { label: '15–30 days', n: 0 }, { label: '30+ days', n: 0 }];
    for (const p of punch) {
      if (p.status === 'closed' || !p.created_at) continue;
      const age = Math.floor((today.getTime() - new Date(p.created_at).getTime()) / dayMs);
      if (age <= 7) buckets[0].n++; else if (age <= 14) buckets[1].n++; else if (age <= 30) buckets[2].n++; else buckets[3].n++;
    }

    // Bottlenecks by trade (open + overdue weighted)
    const tradeMap = new Map<string, { open: number; overdue: number }>();
    for (const p of punch) {
      if (p.status === 'closed') continue;
      const key = p.trade ? titleCase(p.trade) : 'Unassigned trade';
      const e = tradeMap.get(key) ?? { open: 0, overdue: 0 };
      e.open++;
      if (p.due_date && new Date(p.due_date) < today) e.overdue++;
      tradeMap.set(key, e);
    }
    const bottlenecks = [...tradeMap.entries()].map(([trade, v]) => ({ trade, ...v })).sort((x, y) => y.overdue - x.overdue || y.open - x.open).slice(0, 6);

    // Team workload by assignee
    const assigneeMap = new Map<string, number>();
    for (const p of punch) {
      if (p.status === 'closed') continue;
      const key = p.assignee_name ?? 'Unassigned';
      assigneeMap.set(key, (assigneeMap.get(key) ?? 0) + 1);
    }
    const workload = [...assigneeMap.entries()].map(([name, n]) => ({ name, n })).sort((x, y) => y.n - x.n).slice(0, 6);

    // Tasks
    const taskTotal = tasks.length;
    const taskDone = tasks.filter((t) => ['completed', 'done', 'closed'].includes(String(t.status))).length;
    const taskCompletion = taskTotal ? Math.round((taskDone / taskTotal) * 100) : 0;
    const tasksBehind = tasks.filter((t) => {
      const end = t.finish_date || t.due_date;
      return end && !['completed', 'done', 'closed'].includes(String(t.status)) && new Date(end) < today;
    }).length;

    return { total, open, closed, overdue, completion, byStatus, buckets, bottlenecks, workload, taskTotal, taskCompletion, tasksBehind };
  }, [punch, tasks]);

  const loading = punchLoading || !tasksLoaded;
  const maxBucket = Math.max(1, ...a.buckets.map((b) => b.n));
  const maxWork = Math.max(1, ...a.workload.map((w) => w.n));

  return (
    <AppShell title="Analytics">
      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Crunching numbers…</div>
      ) : !activeId ? (
        <EmptyState icon="dashboard" title="No project selected" hint="Pick a project to see analytics." />
      ) : (
        <>
          <div className="an-kpis">
            <Card pad hover><div className="an-kpi__val">{a.completion}%</div><div className="an-kpi__label">Punchlist completion</div><div className="an-kpi__sub">{a.closed}/{a.total} closed</div></Card>
            <Card pad hover><div className="an-kpi__val" style={{ color: a.overdue ? 'var(--red-500)' : undefined }}>{a.overdue}</div><div className="an-kpi__label">Overdue items</div><div className="an-kpi__sub">{a.open} open</div></Card>
            <Card pad hover><div className="an-kpi__val">{a.taskCompletion}%</div><div className="an-kpi__label">Task completion</div><div className="an-kpi__sub">{a.taskTotal} tasks</div></Card>
            <Card pad hover><div className="an-kpi__val" style={{ color: a.tasksBehind ? 'var(--amber-500)' : undefined }}>{a.tasksBehind}</div><div className="an-kpi__label">Tasks behind</div></Card>
          </div>

          <div className="an-grid">
            <Card pad>
              <h3 className="an-title">Punch items by status</h3>
              <Donut segments={a.byStatus.filter((s) => s.value > 0)} />
            </Card>

            <Card pad>
              <h3 className="an-title">Open punch-item aging</h3>
              {a.buckets.map((b) => <HBar key={b.label} label={b.label} value={b.n} max={maxBucket} color={b.n && b.label === '30+ days' ? 'var(--red-500)' : 'var(--accent)'} />)}
            </Card>

            <Card pad>
              <h3 className="an-title">Bottlenecks by trade</h3>
              {a.bottlenecks.length === 0 ? <p className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>Nothing open. Clear.</p> : (
                <table className="an-table">
                  <thead><tr><th>Trade</th><th className="num">Open</th><th className="num">Overdue</th></tr></thead>
                  <tbody>{a.bottlenecks.map((b) => <tr key={b.trade}><td>{b.trade}</td><td className="num">{b.open}</td><td className="num" style={{ color: b.overdue ? 'var(--red-500)' : undefined }}>{b.overdue}</td></tr>)}</tbody>
                </table>
              )}
            </Card>

            <Card pad>
              <h3 className="an-title">Team workload (open items)</h3>
              {a.workload.length === 0 ? <p className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>No open items assigned.</p> :
                a.workload.map((w) => <HBar key={w.name} label={w.name} value={w.n} max={maxWork} color="var(--violet-500)" />)}
            </Card>
          </div>
        </>
      )}
    </AppShell>
  );
}
