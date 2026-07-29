import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Card, EmptyState, Spinner, Badge } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useProjects } from '@/lib/projects';
import { formatDate, titleCase } from '@/lib/format';
import { scheduleApi } from '@/features/schedule/api';
import type { Task } from '@/features/schedule/types';
import './projects.css';

interface Health {
  score: number | null;
  total: number;
  done: number;
  overdue: number;
  completion: number;
}

function computeHealth(tasks: Task[]): Health {
  const total = tasks.length;
  if (!total) return { score: null, total: 0, done: 0, overdue: 0, completion: 0 };
  const today = new Date(new Date().toDateString());
  const isDone = (t: Task) => ['completed', 'done', 'closed'].includes(String(t.status));
  const done = tasks.filter(isDone).length;
  const overdue = tasks.filter((t) => { const e = t.finish_date || t.due_date; return e && !isDone(t) && new Date(e) < today; }).length;
  const completion = done / total;
  const onSchedule = 1 - overdue / total;
  const score = Math.round(100 * (0.5 * completion + 0.5 * onSchedule));
  return { score, total, done, overdue, completion: Math.round(completion * 100) };
}

function healthColor(score: number | null): string {
  if (score === null) return 'var(--text-subtle)';
  if (score >= 80) return 'var(--green-500)';
  if (score >= 55) return 'var(--amber-500)';
  return 'var(--red-500)';
}

export function ProjectsPage() {
  const { projects, loading, setActiveId } = useProjects();
  const [health, setHealth] = useState<Record<number, Health>>({});
  const [computing, setComputing] = useState(true);

  useEffect(() => {
    if (!projects.length) { setComputing(false); return; }
    let active = true;
    const targets = projects.slice(0, 20);
    Promise.all(targets.map((p) =>
      scheduleApi.listTasks(p.id).then((t) => [p.id, computeHealth(Array.isArray(t) ? t : [])] as const).catch(() => [p.id, computeHealth([])] as const)
    )).then((entries) => { if (active) setHealth(Object.fromEntries(entries)); }).finally(() => active && setComputing(false));
    return () => { active = false; };
  }, [projects]);

  const portfolio = useMemo(() => {
    const scored = projects.map((p) => ({ p, h: health[p.id] })).filter((x) => x.h);
    const withScore = scored.filter((x) => x.h!.score !== null);
    const avg = withScore.length ? Math.round(withScore.reduce((s, x) => s + (x.h!.score ?? 0), 0) / withScore.length) : null;
    const atRisk = withScore.filter((x) => (x.h!.score ?? 100) < 55).length;
    return { avg, atRisk, active: projects.filter((p) => p.status === 'active').length };
  }, [projects, health]);

  return (
    <AppShell title="Projects">
      {loading || computing ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading portfolio…</div>
      ) : projects.length === 0 ? (
        <EmptyState icon="dashboard" title="No projects yet" hint="Create a project in BuildForge to see it here." />
      ) : (
        <>
          <div className="pj-kpis">
            <Card pad hover><div className="pj-kpi__val">{projects.length}</div><div className="pj-kpi__label">Projects</div></Card>
            <Card pad hover><div className="pj-kpi__val" style={{ color: healthColor(portfolio.avg) }}>{portfolio.avg ?? '—'}</div><div className="pj-kpi__label">Avg health</div></Card>
            <Card pad hover><div className="pj-kpi__val" style={{ color: portfolio.atRisk ? 'var(--red-500)' : undefined }}>{portfolio.atRisk}</div><div className="pj-kpi__label">At risk</div></Card>
            <Card pad hover><div className="pj-kpi__val">{portfolio.active}</div><div className="pj-kpi__label">Active</div></Card>
          </div>

          <div className="pj-list">
            {projects.map((p) => {
              const h = health[p.id];
              const color = healthColor(h?.score ?? null);
              return (
                <Card key={p.id} pad hover className="pj-card" onClick={() => setActiveId(p.id)}>
                  <div className="pj-ring" style={{ background: `conic-gradient(${color} ${(h?.score ?? 0) * 3.6}deg, var(--bg-sunken) 0)` }}>
                    <div className="pj-ring__inner">{h?.score ?? '—'}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="pj-card__name bf-truncate">{p.name}</div>
                    <div className="bf-row bf-gap-2" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                      <Badge color={p.status === 'active' ? 'var(--green-500)' : 'var(--slate-500)'} dot>{titleCase(p.status ?? 'active')}</Badge>
                      {h && h.total > 0 && <span className="pj-meta">{h.completion}% complete</span>}
                      {h && h.overdue > 0 && <span className="pj-meta" style={{ color: 'var(--red-500)' }}><Icon name="alert" size={12} /> {h.overdue} overdue</span>}
                      {p.address && <span className="pj-meta bf-truncate">{p.address}</span>}
                    </div>
                  </div>
                  <Icon name="chevronRight" size={16} />
                </Card>
              );
            })}
          </div>
        </>
      )}
    </AppShell>
  );
}
