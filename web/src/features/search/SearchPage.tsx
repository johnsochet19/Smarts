import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Badge, Card, EmptyState, Input, Spinner } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { formatDate, titleCase } from '@/lib/format';
import { api } from '@/lib/api';
import '@/features/budget/budget.css';

interface TaskRow {
  id: number;
  name?: string;
  phase?: string | null;
  status?: string | null;
  notes?: string | null;
  assigned_user_name?: string | null;
  start_date?: string | null;
  finish_date?: string | null;
  percent_complete?: number | null;
}

const STATUS_COLORS: Record<string, string> = {
  not_started: 'var(--slate-500)', 'not started': 'var(--slate-500)',
  in_progress: 'var(--blue-500)', 'in progress': 'var(--blue-500)',
  complete: 'var(--green-500)', completed: 'var(--green-500)', done: 'var(--green-500)',
  blocked: 'var(--red-500)', on_hold: 'var(--amber-500)', 'on hold': 'var(--amber-500)',
};
function statusColor(s?: string | null): string {
  return STATUS_COLORS[String(s ?? '').toLowerCase()] ?? 'var(--slate-500)';
}

export function SearchPage() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const term = q.trim();
    if (!term) { setRows([]); setSearched(false); return; }
    debounce.current = setTimeout(() => {
      setLoading(true);
      api.get<TaskRow[]>(`/search?q=${encodeURIComponent(term)}`)
        .then((r) => { setRows(Array.isArray(r) ? r : []); setSearched(true); })
        .catch((e) => toast.error(e instanceof Error ? e.message : 'Search failed'))
        .finally(() => setLoading(false));
    }, 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, toast]);

  const count = rows.length;
  const summary = useMemo(() => {
    const byStatus = new Map<string, number>();
    rows.forEach((r) => { const k = r.status || 'unknown'; byStatus.set(k, (byStatus.get(k) ?? 0) + 1); });
    return Array.from(byStatus.entries());
  }, [rows]);

  return (
    <AppShell title="Search">
      <div className="bf-toolbar" style={{ gap: 'var(--space-3)' }}>
        <Input autoFocus placeholder="Search tasks by name, phase, status, notes or assignee…"
          value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 480 }} />
        {searched && <span className="bf-muted" style={{ marginLeft: 'auto' }}>{count} result{count === 1 ? '' : 's'}</span>}
      </div>

      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Searching…</div>
      ) : !q.trim() ? (
        <EmptyState icon="search" title="Search everything" hint="Start typing to find tasks across your projects." />
      ) : count === 0 ? (
        <EmptyState icon="search" title="No matches" hint={`Nothing matched “${q.trim()}”. Try a different term.`} />
      ) : (
        <>
          {summary.length > 1 && (
            <div className="bf-row bf-gap-2" style={{ marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
              {summary.map(([s, n]) => (
                <Badge key={s} color={statusColor(s)} dot>{titleCase(String(s).replace(/_/g, ' '))} · {n}</Badge>
              ))}
            </div>
          )}
          <Card style={{ overflow: 'auto' }}>
            <table className="bg-table">
              <thead><tr><th>Task</th><th>Phase</th><th>Status</th><th>Assignee</th><th>Start</th><th>Finish</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name || '—'}</td>
                    <td className="bf-subtle">{r.phase || '—'}</td>
                    <td>{r.status ? <Badge color={statusColor(r.status)} dot>{titleCase(r.status.replace(/_/g, ' '))}</Badge> : '—'}</td>
                    <td>{r.assigned_user_name || '—'}</td>
                    <td className="bf-subtle">{r.start_date ? formatDate(r.start_date) : '—'}</td>
                    <td className="bf-subtle">{r.finish_date ? formatDate(r.finish_date) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </AppShell>
  );
}
