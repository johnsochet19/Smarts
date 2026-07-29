import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button, EmptyState, Spinner, Field, Input, Badge } from '@/components/ui/primitives';
import { SegmentedControl, Drawer } from '@/components/ui/overlays';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { useProjects } from '@/lib/projects';
import { usePersistentState } from '@/lib/hooks';
import { formatDate } from '@/lib/format';
import { scheduleApi } from './api';
import { statusColor, taskLabel, type Dependency, type Task } from './types';
import { GanttChart } from './GanttChart';
import { criticalPath } from './cpm';

type View = 'gantt' | 'timeline' | 'list';

export function SchedulePage() {
  const { activeId } = useProjects();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deps, setDeps] = useState<Dependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = usePersistentState<View>('bf_schedule_view', 'gantt');
  const [zoom, setZoom] = usePersistentState<number>('bf_gantt_zoom', 28);
  const [showCritical, setShowCritical] = usePersistentState<boolean>('bf_gantt_critical', false);
  const [selected, setSelected] = useState<Task | null>(null);

  useEffect(() => {
    if (!activeId) { setLoading(false); return; }
    setLoading(true);
    Promise.all([scheduleApi.listTasks(activeId), scheduleApi.listDependencies().catch(() => [])])
      .then(([t, d]) => {
        setTasks(Array.isArray(t) ? t : []);
        setDeps(Array.isArray(d) ? d : []);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load schedule'))
      .finally(() => setLoading(false));
  }, [activeId, toast]);

  // Build hierarchical display order.
  const rows = useMemo(() => flatten(tasks), [tasks]);
  // Only dependencies among loaded tasks matter.
  const scopedDeps = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.id));
    return deps.filter((d) => ids.has(d.task_id) && ids.has(d.depends_on_id));
  }, [deps, tasks]);
  const criticalIds = useMemo(
    () => (showCritical ? criticalPath(tasks, scopedDeps) : new Set<number>()),
    [showCritical, tasks, scopedDeps]
  );

  function applyTask(updated: Task) {
    setTasks((ts) => ts.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
  }

  async function updateDates(task: Task, patch: { start_date: string; finish_date: string }) {
    if (!activeId) return;
    applyTask({ ...task, ...patch });
    try {
      const saved = await scheduleApi.updateTask(activeId, task.id, patch);
      applyTask(saved);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reschedule failed');
    }
  }

  async function createTask() {
    if (!activeId) return;
    const title = prompt('New task name');
    if (!title) return;
    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    try {
      const t = await scheduleApi.createTask(activeId, { title, start_date: start, finish_date: end, status: 'open' });
      setTasks((ts) => [...ts, t]);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create task'); }
  }

  const actions = (
    <>
      {view !== 'list' && (
        <div className="bf-row bf-gap-1">
          <Button variant="ghost" size="sm" iconOnly icon="close" aria-label="Zoom out" onClick={() => setZoom(Math.max(10, zoom - 8))} />
          <Button variant="ghost" size="sm" iconOnly icon="plus" aria-label="Zoom in" onClick={() => setZoom(Math.min(64, zoom + 8))} />
        </div>
      )}
      <Button variant="primary" icon="plus" onClick={createTask} disabled={!activeId}>New task</Button>
    </>
  );

  const dayWidth = view === 'timeline' ? Math.max(8, Math.round(zoom / 2.5)) : zoom;

  return (
    <AppShell title="Schedule & Gantt" actions={actions}>
      <div className="bf-toolbar">
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { value: 'gantt', label: 'Gantt', icon: 'grid' },
            { value: 'timeline', label: 'Timeline', icon: 'board' },
            { value: 'list', label: 'List', icon: 'list' },
          ]}
        />
        {view !== 'list' && (
          <label className="bf-row bf-gap-2" style={{ cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={showCritical} onChange={(e) => setShowCritical(e.target.checked)} />
            Critical path
          </label>
        )}
        <span className="bf-spacer" />
        <span className="bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>
          {tasks.length} tasks · {scopedDeps.length} dependencies{showCritical ? ` · ${criticalIds.size} critical` : ''}
        </span>
      </div>

      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading schedule…</div>
      ) : !activeId ? (
        <EmptyState icon="calendar" title="No project selected" hint="Pick a project to see its schedule." />
      ) : tasks.length === 0 ? (
        <EmptyState icon="calendar" title="No tasks yet" hint="Add tasks with start and finish dates to see them on the Gantt."
          action={<Button variant="primary" icon="plus" onClick={createTask}>New task</Button>} />
      ) : view === 'list' ? (
        <ListView rows={rows} onOpen={setSelected} />
      ) : (
        <div className="gantt">
          <GanttChart rows={rows} deps={scopedDeps} dayWidth={dayWidth} projectId={activeId} onUpdateTask={updateDates} onOpen={setSelected} criticalIds={criticalIds} />
        </div>
      )}

      {selected && activeId && (
        <TaskDrawer
          task={selected}
          projectId={activeId}
          onClose={() => setSelected(null)}
          onSaved={(t) => { applyTask(t); setSelected(t); }}
        />
      )}
    </AppShell>
  );
}

function ListView({ rows, onOpen }: { rows: Array<{ task: Task; depth: number }>; onOpen: (t: Task) => void }) {
  return (
    <div className="pl-list">
      {rows.map(({ task, depth }) => (
        <div key={task.id} className="pl-row" onClick={() => onOpen(task)}>
          <span style={{ width: depth * 16, flex: 'none' }} />
          <div className="pl-row__main">
            <div className="pl-row__title bf-truncate">{taskLabel(task)}</div>
            <div className="pl-row__meta">
              <Badge color={statusColor(task.status, task.color)} dot>{String(task.status || 'open').replace(/_/g, ' ')}</Badge>
              {task.start_date && <span className="pl-meta-chip"><Icon name="calendar" size={13} /> {formatDate(task.start_date)}</span>}
              {(task.finish_date || task.due_date) && <span className="pl-meta-chip">→ {formatDate(task.finish_date || task.due_date)}</span>}
            </div>
          </div>
          {typeof task.percent_complete === 'number' && <span className="bf-mono bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>{task.percent_complete}%</span>}
        </div>
      ))}
    </div>
  );
}

function TaskDrawer({ task, projectId, onClose, onSaved }: { task: Task; projectId: number; onClose: () => void; onSaved: (t: Task) => void }) {
  const toast = useToast();
  const [start, setStart] = useState(task.start_date?.slice(0, 10) ?? '');
  const [end, setEnd] = useState((task.finish_date ?? task.due_date)?.slice(0, 10) ?? '');
  const [pct, setPct] = useState(String(task.percent_complete ?? 0));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const saved = await scheduleApi.updateTask(projectId, task.id, {
        start_date: start || null,
        finish_date: end || null,
        percent_complete: Number(pct) || 0,
      });
      toast.success('Task updated');
      onSaved(saved);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={<div className="bf-row bf-gap-3"><Badge color={statusColor(task.status, task.color)} dot>{String(task.status || 'open').replace(/_/g, ' ')}</Badge></div>}
      footer={<><span className="bf-spacer" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      <div className="bf-col bf-gap-4">
        <h2 style={{ fontSize: 'var(--text-xl)' }}>{taskLabel(task)}</h2>
        {task.description && <p className="bf-muted">{task.description}</p>}
        <div className="pl-detail__grid">
          <Field label="Start"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Finish"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="% Complete"><Input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
        </div>
      </div>
    </Drawer>
  );
}

function flatten(tasks: Task[]): Array<{ task: Task; depth: number }> {
  const ids = new Set(tasks.map((t) => t.id));
  const byParent = new Map<number | null, Task[]>();
  for (const t of tasks) {
    const key = t.parent_task_id != null && ids.has(t.parent_task_id) ? t.parent_task_id : null;
    const arr = byParent.get(key) ?? [];
    arr.push(t);
    byParent.set(key, arr);
  }
  const sortFn = (a: Task, b: Task) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || a.id - b.id;
  for (const arr of byParent.values()) arr.sort(sortFn);
  const out: Array<{ task: Task; depth: number }> = [];
  function walk(parent: number | null, depth: number) {
    for (const task of byParent.get(parent) ?? []) {
      out.push({ task, depth });
      walk(task.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}
