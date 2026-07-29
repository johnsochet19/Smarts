import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Card, EmptyState, Spinner, Badge, Button, Input } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { useProjects } from '@/lib/projects';
import { formatDate, titleCase } from '@/lib/format';
import { scheduleApi } from '@/features/schedule/api';
import type { Task } from '@/features/schedule/types';
import { workspacesApi } from './workspacesApi';
import type { Workspace } from './workspacesApi';
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
  const toast = useToast();
  const { user } = useAuth();
  const [health, setHealth] = useState<Record<number, Health>>({});
  const [computing, setComputing] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsFilter, setWsFilter] = useState<number | 'all' | 'none'>('all');
  const [creatingWs, setCreatingWs] = useState(false);
  const [wsName, setWsName] = useState('');
  // Workspace assignments made locally, so the list updates without a refetch.
  const [wsOverrides, setWsOverrides] = useState<Record<number, number | null>>({});
  const canManageWs = ['admin', 'superadmin', 'manager'].includes(String(user?.role));

  useEffect(() => {
    workspacesApi.list()
      .then((rows) => setWorkspaces(Array.isArray(rows) ? rows : []))
      .catch(() => { /* workspaces are additive; page works without them */ });
  }, []);

  async function createWorkspace() {
    const name = wsName.trim();
    if (!name) return;
    try {
      const ws = await workspacesApi.create({ name });
      setWorkspaces((w) => [...w, { ...ws, project_count: 0 }]);
      setWsName('');
      setCreatingWs(false);
      toast.success(`Workspace “${ws.name}” created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create workspace');
    }
  }

  async function assignWorkspace(projectId: number, workspaceId: number | null) {
    try {
      await workspacesApi.assignProject(projectId, workspaceId);
      setWsOverrides((o) => ({ ...o, [projectId]: workspaceId }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move project');
    }
  }

  const projectWs = (p: { id: number; workspace_id?: number | null }) =>
    p.id in wsOverrides ? wsOverrides[p.id] : (p.workspace_id ?? null);

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

          {(workspaces.length > 0 || canManageWs) && (
            <div className="bf-row bf-gap-2" style={{ flexWrap: 'wrap', margin: 'var(--space-4) 0' }}>
              <Button size="sm" variant={wsFilter === 'all' ? 'primary' : 'secondary'} onClick={() => setWsFilter('all')}>All</Button>
              {workspaces.map((w) => (
                <Button key={w.id} size="sm" variant={wsFilter === w.id ? 'primary' : 'secondary'} onClick={() => setWsFilter(w.id)}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: w.color, marginRight: 6 }} />
                  {w.name}
                </Button>
              ))}
              {workspaces.length > 0 && (
                <Button size="sm" variant={wsFilter === 'none' ? 'primary' : 'secondary'} onClick={() => setWsFilter('none')}>Ungrouped</Button>
              )}
              {canManageWs && (creatingWs ? (
                <span className="bf-row bf-gap-2">
                  <Input
                    autoFocus
                    placeholder="Workspace name"
                    value={wsName}
                    onChange={(e) => setWsName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') createWorkspace(); if (e.key === 'Escape') setCreatingWs(false); }}
                    style={{ width: 180 }}
                  />
                  <Button size="sm" variant="primary" onClick={createWorkspace} disabled={!wsName.trim()}>Add</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setCreatingWs(false); setWsName(''); }}>Cancel</Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" icon="plus" onClick={() => setCreatingWs(true)}>New workspace</Button>
              ))}
            </div>
          )}

          <div className="pj-list">
            {projects.filter((p) => {
              if (wsFilter === 'all') return true;
              const ws = projectWs(p);
              return wsFilter === 'none' ? ws === null : ws === wsFilter;
            }).map((p) => {
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
                  {canManageWs && workspaces.length > 0 && (
                    <select
                      className="bf-input"
                      style={{ width: 150, fontSize: 'var(--text-sm)' }}
                      value={projectWs(p) ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => { e.stopPropagation(); assignWorkspace(p.id, e.target.value ? Number(e.target.value) : null); }}
                      aria-label="Workspace"
                    >
                      <option value="">No workspace</option>
                      {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  )}
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
