import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Avatar, Badge, Card, EmptyState, Input, Select, Spinner } from '@/components/ui/primitives';
import { useProjects } from '@/lib/projects';
import { useToast } from '@/components/ui/toast';
import { titleCase } from '@/lib/format';
import { api } from '@/lib/api';
import '@/features/budget/budget.css';

interface LogRow {
  id: number;
  project_id?: number | null;
  entity_type: string;
  entity_id?: number | null;
  action: string;
  field_name?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  changed_by?: number | null;
  changed_by_name?: string | null;
  changed_by_email?: string | null;
  changed_at?: string | null;
}

interface LogResponse { rows?: LogRow[]; total?: number }

const ACTION_COLORS: Record<string, string> = {
  created: 'var(--green-500)',
  updated: 'var(--blue-500)',
  status_changed: 'var(--violet-500)',
  deleted: 'var(--red-500)',
  commented: 'var(--slate-500)',
  assigned: 'var(--amber-500)',
  uploaded: 'var(--blue-500)',
  approved: 'var(--green-500)',
  rejected: 'var(--red-500)',
  submitted: 'var(--blue-500)',
};

function fmtWhen(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function describe(r: LogRow): string {
  const noun = titleCase(r.entity_type.replace(/_/g, ' '));
  const ref = r.entity_id ? ` #${r.entity_id}` : '';
  if (r.field_name && (r.old_value != null || r.new_value != null)) {
    const from = r.old_value ? `“${r.old_value}”` : '—';
    const to = r.new_value ? `“${r.new_value}”` : '—';
    return `${titleCase(r.field_name.replace(/_/g, ' '))}: ${from} → ${to}`;
  }
  return `${noun}${ref}`;
}

export function AuditLogPage() {
  const { activeId } = useProjects();
  const toast = useToast();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    const path = activeId ? `/projects/${activeId}/audit-log?limit=200` : '/audit-log?limit=200';
    api.get<LogResponse | LogRow[]>(path)
      .then((r) => {
        const list = Array.isArray(r) ? r : (r?.rows ?? []);
        setRows(list);
        setTotal(Array.isArray(r) ? list.length : (r?.total ?? list.length));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load audit log'))
      .finally(() => setLoading(false));
  }, [activeId, toast]);

  const entityTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.entity_type))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (entityFilter && r.entity_type !== entityFilter) return false;
      if (!q) return true;
      return [r.entity_type, r.action, r.field_name, r.old_value, r.new_value, r.changed_by_name]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, entityFilter, search]);

  return (
    <AppShell title="Audit Log">
      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading activity…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon="list" title="No activity yet" hint="Changes across the platform are recorded here as your team works." />
      ) : (
        <>
          <div className="bf-toolbar" style={{ gap: 'var(--space-3)' }}>
            <Input placeholder="Search activity…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
            <Select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="">All types</option>
              {entityTypes.map((t) => <option key={t} value={t}>{titleCase(t.replace(/_/g, ' '))}</option>)}
            </Select>
            <span className="bf-muted" style={{ marginLeft: 'auto' }}>{filtered.length} of {total} entries</span>
          </div>

          <Card style={{ overflow: 'auto' }}>
            <table className="bg-table">
              <thead><tr><th>When</th><th>Who</th><th>Type</th><th>Action</th><th>Detail</th></tr></thead>
              <tbody>
                {filtered.map((r) => {
                  const who = r.changed_by_name || r.changed_by_email || 'System';
                  return (
                    <tr key={r.id}>
                      <td className="bf-subtle" style={{ whiteSpace: 'nowrap' }}>{fmtWhen(r.changed_at)}</td>
                      <td><span className="bf-row bf-gap-2"><Avatar name={who} size={22} /> {who}</span></td>
                      <td>{titleCase(r.entity_type.replace(/_/g, ' '))}</td>
                      <td><Badge color={ACTION_COLORS[r.action] ?? 'var(--slate-500)'} dot>{titleCase(r.action.replace(/_/g, ' '))}</Badge></td>
                      <td>{describe(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </AppShell>
  );
}
