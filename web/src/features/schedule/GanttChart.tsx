import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, daysBetween, monthLabel, parseDay, shortDay, startOfDay, toISODate } from './dates';
import { statusColor, taskLabel, type Dependency, type Task } from './types';
import './gantt.css';

interface Row { task: Task; depth: number }

interface Bar {
  task: Task;
  rowIndex: number;
  start: Date;
  end: Date;
  milestone: boolean;
}

interface DragState {
  id: number;
  mode: 'move' | 'resize-l' | 'resize-r';
  startX: number;
  origStart: Date;
  origEnd: Date;
}

export function GanttChart({
  rows, deps, dayWidth, projectId, onUpdateTask, onOpen, criticalIds,
}: {
  rows: Row[];
  deps: Dependency[];
  dayWidth: number;
  projectId: number;
  onUpdateTask: (task: Task, patch: { start_date: string; finish_date: string }) => void;
  onOpen?: (task: Task) => void;
  criticalIds?: Set<number>;
}) {
  const leftBodyRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draft, setDraft] = useState<{ id: number; start: Date; end: Date } | null>(null);

  const ROW_H = 38;

  // Resolve each task's scheduled window.
  function windowOf(t: Task): { start: Date; end: Date; milestone: boolean } | null {
    const s = parseDay(t.start_date);
    const e = parseDay(t.finish_date) ?? parseDay(t.due_date);
    if (s && e) return { start: minD(s, e), end: maxD(s, e), milestone: daysBetween(s, e) === 0 };
    if (e && !s) return { start: e, end: e, milestone: true };
    if (s && !e) return { start: s, end: s, milestone: true };
    return null;
  }

  const { rangeStart, totalDays } = useMemo(() => {
    let min: Date | null = null;
    let max: Date | null = null;
    for (const { task } of rows) {
      const w = windowOf(task);
      if (!w) continue;
      min = min ? minD(min, w.start) : w.start;
      max = max ? maxD(max, w.end) : w.end;
    }
    const today = startOfDay(new Date());
    if (!min || !max) { min = addDays(today, -7); max = addDays(today, 21); }
    const rs = addDays(min, -3);
    const re = addDays(max, 4);
    return { rangeStart: rs, totalDays: Math.max(14, daysBetween(rs, re) + 1) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const width = totalDays * dayWidth;
  const today = startOfDay(new Date());
  const todayX = daysBetween(rangeStart, today) * dayWidth + dayWidth / 2;

  const days = useMemo(() => Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i)), [rangeStart, totalDays]);
  const months = useMemo(() => {
    const out: Array<{ label: string; span: number }> = [];
    for (const d of days) {
      const label = monthLabel(d);
      const last = out[out.length - 1];
      if (last && last.label === label) last.span += 1;
      else out.push({ label, span: 1 });
    }
    return out;
  }, [days]);

  const bars: Bar[] = useMemo(() => {
    const out: Bar[] = [];
    rows.forEach(({ task }, rowIndex) => {
      const w = windowOf(task);
      if (w) out.push({ task, rowIndex, start: w.start, end: w.end, milestone: w.milestone });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const rowOfTask = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach(({ task }, i) => m.set(task.id, i));
    return m;
  }, [rows]);

  // Drag handling
  useEffect(() => {
    if (!drag) return;
    function onMove(e: MouseEvent) {
      const st = drag!;
      const delta = Math.round((e.clientX - st.startX) / dayWidth);
      let start = st.origStart, end = st.origEnd;
      if (st.mode === 'move') { start = addDays(st.origStart, delta); end = addDays(st.origEnd, delta); }
      else if (st.mode === 'resize-l') { start = minD(addDays(st.origStart, delta), st.origEnd); }
      else { end = maxD(addDays(st.origEnd, delta), st.origStart); }
      setDraft({ id: st.id, start, end });
    }
    function onUp() {
      const st = drag!;
      setDraft((d) => {
        if (d && d.id === st.id) {
          const task = rows.find((r) => r.task.id === st.id)?.task;
          if (task) onUpdateTask(task, { start_date: toISODate(d.start), finish_date: toISODate(d.end) });
        }
        return null;
      });
      setDrag(null);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [drag, dayWidth, rows, onUpdateTask]);

  function barGeom(bar: Bar) {
    const d = draft && draft.id === bar.task.id ? draft : bar;
    const left = daysBetween(rangeStart, d.start) * dayWidth;
    const span = daysBetween(d.start, d.end) + 1;
    return { left, w: Math.max(dayWidth, span * dayWidth) };
  }

  // Dependency connectors (finish-to-start).
  const depPaths = useMemo(() => {
    const byId = new Map(bars.map((b) => [b.task.id, b]));
    const paths: string[] = [];
    for (const dep of deps) {
      const pre = byId.get(dep.depends_on_id);
      const suc = byId.get(dep.task_id);
      if (!pre || !suc) continue;
      const pg = barGeom(pre); const sg = barGeom(suc);
      const x1 = pg.left + pg.w; const y1 = pre.rowIndex * ROW_H + ROW_H / 2;
      const x2 = sg.left; const y2 = suc.rowIndex * ROW_H + ROW_H / 2;
      const midX = Math.max(x1 + 12, x2 - 12);
      paths.push(`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`);
    }
    return paths;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps, bars, draft, dayWidth, rangeStart]);

  return (
    <div className="gantt__body">
      {/* Left task list */}
      <div className="gantt__left">
        <div className="gantt__left-head">Task</div>
        <div className="gantt__left-body" ref={leftBodyRef} style={{ overflow: 'hidden' }}>
          {rows.map(({ task, depth }) => {
            const w = windowOf(task);
            return (
              <div key={task.id} className="gantt__trow" onClick={() => onOpen?.(task)} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
                <span style={{ width: depth * 14, flex: 'none' }} />
                <span className="gantt__tname">{taskLabel(task)}</span>
                <span className="gantt__tdate">{w ? `${w.start.getMonth() + 1}/${w.start.getDate()}` : '—'}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right timeline */}
      <div className="gantt__right" ref={rightRef} onScroll={(e) => { if (leftBodyRef.current) leftBodyRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop; }}>
        <div className="gantt__canvas" style={{ width }}>
          <div className="gantt__axis">
            <div className="gantt__months" style={{ width }}>
              {months.map((m, i) => (
                <div key={i} className="gantt__month" style={{ width: m.span * dayWidth, left: 0 }}>{m.label}</div>
              ))}
            </div>
            <div className="gantt__days" style={{ width }}>
              {days.map((d, i) => {
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                const isToday = daysBetween(d, today) === 0;
                return (
                  <div key={i} className={`gantt__day${weekend ? ' gantt__day--weekend' : ''}${isToday ? ' gantt__day--today' : ''}`} style={{ width: dayWidth }}>
                    {dayWidth >= 20 ? shortDay(d) : ''}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="gantt__rows" style={{ width, height: rows.length * ROW_H }}>
            {/* grid rows */}
            {rows.map((_, i) => <div key={i} className="gantt__grid-row" style={{ width }} />)}

            {/* today line */}
            {todayX >= 0 && todayX <= width && <div className="gantt__today-line" style={{ left: todayX }} />}

            {/* dependency lines */}
            <svg className="gantt__deps" width={width} height={rows.length * ROW_H}>
              <defs>
                <marker id="gantt-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <path className="gantt__dep-arrow" d="M0,0 L6,3.5 L0,7 Z" />
                </marker>
              </defs>
              {depPaths.map((d, i) => <path key={i} className="gantt__dep-path" d={d} markerEnd="url(#gantt-arrow)" />)}
            </svg>

            {/* bars */}
            {bars.map((bar) => {
              const { left, w } = barGeom(bar);
              const top = bar.rowIndex * ROW_H + (ROW_H - 22) / 2;
              const critical = criticalIds?.has(bar.task.id) ?? false;
              const color = statusColor(bar.task.status, bar.task.color);
              const criticalRing = critical ? { boxShadow: '0 0 0 2px var(--red-500)' } : undefined;
              const pct = Math.max(0, Math.min(100, Number(bar.task.percent_complete) || 0));
              if (bar.milestone) {
                return (
                  <div key={bar.task.id} className="gantt__milestone" title={taskLabel(bar.task) + (critical ? ' (critical path)' : '')}
                    style={{ left: left + dayWidth / 2 - 8, top: bar.rowIndex * ROW_H + (ROW_H - 16) / 2, background: color, ...criticalRing }}
                    onMouseDown={(e) => { e.preventDefault(); setDrag({ id: bar.task.id, mode: 'move', startX: e.clientX, origStart: bar.start, origEnd: bar.end }); }}
                    onClick={() => onOpen?.(bar.task)} />
                );
              }
              return (
                <div key={bar.task.id} className="gantt__bar" title={taskLabel(bar.task) + (critical ? ' (critical path)' : '')}
                  style={{ left, width: w, top, background: color, ...criticalRing }}
                  onMouseDown={(e) => { e.preventDefault(); setDrag({ id: bar.task.id, mode: 'move', startX: e.clientX, origStart: bar.start, origEnd: bar.end }); }}
                  onClick={() => onOpen?.(bar.task)}>
                  {pct > 0 && <div className="gantt__bar__fill" style={{ width: `${pct}%` }} />}
                  <span className="gantt__bar__label">{taskLabel(bar.task)}</span>
                  <div className="gantt__bar__handle gantt__bar__handle--l" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setDrag({ id: bar.task.id, mode: 'resize-l', startX: e.clientX, origStart: bar.start, origEnd: bar.end }); }} />
                  <div className="gantt__bar__handle gantt__bar__handle--r" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setDrag({ id: bar.task.id, mode: 'resize-r', startX: e.clientX, origStart: bar.start, origEnd: bar.end }); }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function minD(a: Date, b: Date): Date { return a.getTime() <= b.getTime() ? a : b; }
function maxD(a: Date, b: Date): Date { return a.getTime() >= b.getTime() ? a : b; }
