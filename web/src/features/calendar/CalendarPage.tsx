import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Button, EmptyState, Spinner } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useProjects } from '@/lib/projects';
import { usePersistentState } from '@/lib/hooks';
import { scheduleApi } from '@/features/schedule/api';
import { statusColor, taskLabel, type Task } from '@/features/schedule/types';
import { usePunchItems, punchApi } from '@/features/punchlist/api';
import { STATUS_META } from '@/features/punchlist/constants';
import type { PunchItem } from '@/features/punchlist/types';
import './calendar.css';

type View = 'month' | 'week' | 'agenda';
interface CalEvent {
  id: string;
  kind: 'task' | 'punch';
  refId: number;
  title: string;
  date: string; // yyyy-mm-dd
  color: string;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function CalendarPage() {
  const { activeId } = useProjects();
  const toast = useToast();
  const navigate = useNavigate();
  const { items: punch, loading: punchLoading, upsert: upsertPunch } = usePunchItems(activeId);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [view, setView] = usePersistentState<View>('bf_cal_view', 'month');
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId) { setTasksLoaded(true); return; }
    setTasksLoaded(false);
    scheduleApi.listTasks(activeId).then((t) => setTasks(Array.isArray(t) ? t : [])).catch(() => setTasks([])).finally(() => setTasksLoaded(true));
  }, [activeId]);

  const events = useMemo<CalEvent[]>(() => {
    const evs: CalEvent[] = [];
    for (const t of tasks) {
      const d = t.start_date || t.finish_date || t.due_date;
      if (d) evs.push({ id: `t${t.id}`, kind: 'task', refId: t.id, title: taskLabel(t), date: d.slice(0, 10), color: statusColor(t.status, t.color) });
    }
    for (const p of punch) {
      if (p.due_date) evs.push({ id: `p${p.id}`, kind: 'punch', refId: p.id, title: `#${p.punch_number ?? p.id} ${p.title}`, date: p.due_date.slice(0, 10), color: STATUS_META[p.status]?.color ?? 'var(--blue-500)' });
    }
    return evs;
  }, [tasks, punch]);

  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) { const a = m.get(e.date) ?? []; a.push(e); m.set(e.date, a); }
    return m;
  }, [events]);

  async function reschedule(ev: CalEvent, toDate: string) {
    if (ev.kind === 'punch') {
      upsertPunch({ ...(punch.find((p) => p.id === ev.refId) as PunchItem), due_date: toDate });
      try { await punchApi.update(ev.refId, { due_date: toDate }); }
      catch (e) { toast.error(e instanceof Error ? e.message : 'Reschedule failed'); }
    } else {
      const t = tasks.find((x) => x.id === ev.refId);
      if (!t || !activeId) return;
      // shift finish by the same delta as start moved
      const oldStart = (t.start_date || t.finish_date || t.due_date || toDate).slice(0, 10);
      const deltaMs = new Date(toDate).getTime() - new Date(oldStart).getTime();
      const newFinish = t.finish_date ? ymd(new Date(new Date(t.finish_date).getTime() + deltaMs)) : toDate;
      setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, start_date: toDate, finish_date: newFinish } : x)));
      try { await scheduleApi.updateTask(activeId, t.id, { start_date: toDate, finish_date: newFinish }); }
      catch (e) { toast.error(e instanceof Error ? e.message : 'Reschedule failed'); }
    }
  }

  function openEvent(ev: CalEvent) {
    navigate(ev.kind === 'punch' ? '/punchlist' : '/schedule');
  }

  const loading = punchLoading || !tasksLoaded;
  const title = view === 'agenda' ? 'Agenda' : `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;

  const actions = (
    <SegmentedControl value={view} onChange={setView} options={[
      { value: 'month', label: 'Month', icon: 'calendar' },
      { value: 'week', label: 'Week', icon: 'board' },
      { value: 'agenda', label: 'Agenda', icon: 'list' },
    ]} />
  );

  return (
    <AppShell title="Calendar" actions={actions}>
      <div className="cal">
        <div className="cal__bar">
          {view !== 'agenda' && (
            <>
              <Button variant="ghost" size="sm" iconOnly icon="chevronLeft" aria-label="Previous" onClick={() => shift(-1)} />
              <span className="cal__month-label">{title}</span>
              <Button variant="ghost" size="sm" iconOnly icon="chevronRight" aria-label="Next" onClick={() => shift(1)} />
              <Button variant="secondary" size="sm" onClick={() => setCursor(monthStart(new Date()))}>Today</Button>
            </>
          )}
          <span className="bf-spacer" />
          <span className="bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>{events.length} events</span>
        </div>

        {loading ? (
          <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading…</div>
        ) : !activeId ? (
          <EmptyState icon="calendar" title="No project selected" hint="Pick a project to see its calendar." />
        ) : view === 'month' ? (
          <MonthView cursor={cursor} byDate={byDate} dragId={dragId} overDay={overDay}
            onDragStart={setDragId} onOverDay={setOverDay}
            onDrop={(day) => { const ev = events.find((e) => e.id === dragId); if (ev && ev.date !== day) reschedule(ev, day); setDragId(null); setOverDay(null); }}
            onOpen={openEvent} />
        ) : view === 'week' ? (
          <WeekView cursor={cursor} byDate={byDate} onOpen={openEvent} />
        ) : (
          <AgendaView events={events} onOpen={openEvent} />
        )}
      </div>
    </AppShell>
  );

  function shift(dir: number) {
    if (view === 'week') setCursor(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + dir * 7));
    else setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
  }
}

function monthStart(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }

function MonthView({ cursor, byDate, dragId, overDay, onDragStart, onOverDay, onDrop, onOpen }: {
  cursor: Date; byDate: Map<string, CalEvent[]>; dragId: string | null; overDay: string | null;
  onDragStart: (id: string) => void; onOverDay: (d: string | null) => void; onDrop: (day: string) => void; onOpen: (e: CalEvent) => void;
}) {
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);
  const todayKey = ymd(new Date());
  return (
    <div className="cal__grid">
      {DOW.map((d) => <div key={d} className="cal__dow">{d}</div>)}
      {cells.map((date, i) => {
        const key = ymd(date);
        const evs = byDate.get(key) ?? [];
        const inMonth = date.getMonth() === cursor.getMonth();
        return (
          <div key={i}
            className={`cal__cell${inMonth ? '' : ' cal__cell--muted'}${overDay === key && dragId ? ' cal__cell--over' : ''}${evs.length ? ' cal__cell--has' : ''}`}
            onDragOver={(e) => { e.preventDefault(); onOverDay(key); }}
            onDragLeave={() => onOverDay(null)}
            onDrop={() => onDrop(key)}
          >
            <span className={key === todayKey ? 'cal__date cal__date--today' : 'cal__date'}>{date.getDate()}</span>
            {evs.slice(0, 4).map((ev) => (
              <div key={ev.id} className="cal__ev" draggable style={{ background: ev.color }} title={ev.title}
                onDragStart={() => onDragStart(ev.id)} onClick={() => onOpen(ev)}>{ev.title}</div>
            ))}
            {evs.length > 4 && <span className="cal__more">+{evs.length - 4} more</span>}
          </div>
        );
      })}
    </div>
  );
}

function WeekView({ cursor, byDate, onOpen }: { cursor: Date; byDate: Map<string, CalEvent[]>; onOpen: (e: CalEvent) => void }) {
  const days = useMemo(() => {
    const start = new Date(cursor); start.setDate(cursor.getDate() - cursor.getDay());
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);
  const todayKey = ymd(new Date());
  return (
    <div className="cal__week">
      {days.map((d, i) => {
        const key = ymd(d);
        const evs = byDate.get(key) ?? [];
        return (
          <div key={i} className="cal__wcol">
            <div className={`cal__whead${key === todayKey ? ' cal__whead--today' : ''}`}>{DOW[d.getDay()]} {d.getDate()}</div>
            <div className="cal__wbody">
              {evs.length === 0 ? <span className="bf-subtle" style={{ fontSize: 10, textAlign: 'center' }}>—</span> :
                evs.map((ev) => <div key={ev.id} className="cal__ev" style={{ background: ev.color, whiteSpace: 'normal' }} onClick={() => onOpen(ev)}>{ev.title}</div>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgendaView({ events, onOpen }: { events: CalEvent[]; onOpen: (e: CalEvent) => void }) {
  const grouped = useMemo(() => {
    const todayKey = ymd(new Date());
    const upcoming = events.filter((e) => e.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date));
    const m = new Map<string, CalEvent[]>();
    for (const e of upcoming) { const a = m.get(e.date) ?? []; a.push(e); m.set(e.date, a); }
    return [...m.entries()];
  }, [events]);
  if (!grouped.length) return <EmptyState icon="calendar" title="Nothing scheduled ahead" hint="Upcoming tasks and punch-item due dates will show here." />;
  return (
    <div className="cal__agenda">
      {grouped.map(([date, evs]) => (
        <div className="cal__aday" key={date}>
          <div className="cal__aday__label">{new Date(date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
          {evs.map((ev) => (
            <div key={ev.id} className="cal__arow" onClick={() => onOpen(ev)}>
              <span className="cal__adot" style={{ background: ev.color }} />
              <span style={{ flex: 1 }}>{ev.title}</span>
              <span className="bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>{ev.kind}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
