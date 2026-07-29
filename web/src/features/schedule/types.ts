export type TaskStatus = string;

export interface Task {
  id: number;
  project_id: number;
  title?: string | null;
  name?: string | null;
  description?: string | null;
  status: TaskStatus;
  priority?: string | null;
  start_date?: string | null;
  finish_date?: string | null;
  due_date?: string | null;
  duration_days?: number | null;
  percent_complete?: number | null;
  parent_task_id?: number | null;
  sort_order?: number | null;
  color?: string | null;
  assignees?: Array<{ id?: number; user_id?: number; name?: string }>;
}

export interface Dependency {
  id: number;
  task_id: number;        // successor
  depends_on_id: number;  // predecessor
}

export interface TaskPatch {
  start_date?: string | null;
  finish_date?: string | null;
  title?: string;
  status?: string;
  percent_complete?: number;
}

export function taskLabel(t: Task): string {
  return t.title || t.name || `Task #${t.id}`;
}

export const STATUS_COLORS: Record<string, string> = {
  open: 'var(--blue-500)',
  not_started: 'var(--slate-500)',
  in_progress: 'var(--amber-500)',
  waiting: 'var(--violet-500)',
  blocked: 'var(--red-500)',
  completed: 'var(--green-500)',
  done: 'var(--green-500)',
  closed: 'var(--green-500)',
};

export function statusColor(status?: string | null, fallback?: string | null): string {
  if (status && STATUS_COLORS[status]) return STATUS_COLORS[status];
  return fallback || 'var(--blue-500)';
}
