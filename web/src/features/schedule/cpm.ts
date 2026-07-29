// Critical Path Method (CPM) over the task dependency graph.
// Durations come from date span (or duration_days, min 1). Cycles are ignored
// safely (nodes that can't be topologically ordered are treated as non-critical).
import { daysBetween, parseDay } from './dates';
import type { Dependency, Task } from './types';

export function durationDays(t: Task): number {
  const s = parseDay(t.start_date);
  const e = parseDay(t.finish_date) ?? parseDay(t.due_date);
  if (s && e) return Math.max(1, daysBetween(s, e) + 1);
  if (t.duration_days && t.duration_days > 0) return t.duration_days;
  return 1;
}

export function criticalPath(tasks: Task[], deps: Dependency[]): Set<number> {
  const ids = tasks.map((t) => t.id);
  const idSet = new Set(ids);
  const dur = new Map<number, number>();
  tasks.forEach((t) => dur.set(t.id, durationDays(t)));

  // preds[succ] = [pred...] ; succs[pred] = [succ...]
  const preds = new Map<number, number[]>();
  const succs = new Map<number, number[]>();
  const indeg = new Map<number, number>();
  ids.forEach((id) => { preds.set(id, []); succs.set(id, []); indeg.set(id, 0); });
  for (const d of deps) {
    if (!idSet.has(d.task_id) || !idSet.has(d.depends_on_id)) continue;
    preds.get(d.task_id)!.push(d.depends_on_id);
    succs.get(d.depends_on_id)!.push(d.task_id);
    indeg.set(d.task_id, (indeg.get(d.task_id) ?? 0) + 1);
  }

  // Topological order (Kahn). If not all nodes ordered → cycle; bail out.
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const order: number[] = [];
  const indegWork = new Map(indeg);
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const s of succs.get(n)!) {
      indegWork.set(s, (indegWork.get(s) ?? 0) - 1);
      if ((indegWork.get(s) ?? 0) === 0) queue.push(s);
    }
  }
  if (order.length !== ids.length) return new Set(); // cycle → no critical path

  // Forward pass: earliest start/finish
  const ES = new Map<number, number>(), EF = new Map<number, number>();
  for (const n of order) {
    const es = Math.max(0, ...preds.get(n)!.map((p) => EF.get(p) ?? 0));
    ES.set(n, es);
    EF.set(n, es + (dur.get(n) ?? 1));
  }
  const projectEnd = Math.max(0, ...ids.map((id) => EF.get(id) ?? 0));

  // Backward pass: latest start/finish
  const LF = new Map<number, number>(), LS = new Map<number, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    const succList = succs.get(n)!;
    const lf = succList.length ? Math.min(...succList.map((s) => LS.get(s) ?? projectEnd)) : projectEnd;
    LF.set(n, lf);
    LS.set(n, lf - (dur.get(n) ?? 1));
  }

  // Critical if zero slack.
  const critical = new Set<number>();
  for (const id of ids) if ((LS.get(id) ?? 0) - (ES.get(id) ?? 0) === 0) critical.add(id);
  return critical;
}
