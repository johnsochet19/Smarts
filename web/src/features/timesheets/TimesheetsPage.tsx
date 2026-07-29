import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Spinner, Avatar } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlays';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useProjects } from '@/lib/projects';
import { formatDate, titleCase } from '@/lib/format';
import { timesheetsApi, TS_COST_TYPES, TS_STATUSES, hoursNum, type TimesheetEntry, type TimesheetInput } from './api';
import '@/features/budget/budget.css';

interface Member { id: number; name: string }

function startOfWeek(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d;
}

export function TimesheetsPage() {
  const { activeId } = useProjects();
  const toast = useToast();
  const [items, setItems] = useState<TimesheetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TimesheetEntry | null>(null);

  useEffect(() => {
    if (!activeId) { setLoading(false); return; }
    setLoading(true);
    timesheetsApi.list(activeId).then((r) => setItems(Array.isArray(r) ? r : []))
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load timesheets'))
      .finally(() => setLoading(false));
  }, [activeId, toast]);

  const filtered = useMemo(() => items.filter((i) => !statusFilter || i.status === statusFilter), [items, statusFilter]);

  const kpis = useMemo(() => {
    const total = items.reduce((s, i) => s + hoursNum(i.hours), 0);
    const wk = startOfWeek().getTime();
    const week = items.filter((i) => new Date(i.date).getTime() >= wk).reduce((s, i) => s + hoursNum(i.hours), 0);
    const pending = items.filter((i) => i.status === 'submitted').length;
    return { total, week, pending };
  }, [items]);

  function upsert(it: TimesheetEntry) {
    setItems((p) => { const i = p.findIndex((x) => x.id === it.id); if (i === -1) return [it, ...p]; const n = p.slice(); n[i] = it; return n; });
  }
  async function remove(it: TimesheetEntry, e: React.MouseEvent) {
    e.stopPropagation();
    if (!activeId || !confirm('Delete this time entry?')) return;
    setItems((p) => p.filter((x) => x.id !== it.id));
    try { await timesheetsApi.remove(activeId, it.id); } catch (err) { toast.error(err instanceof Error ? err.message : 'Delete failed'); }
  }

  const actions = <Button variant="primary" icon="plus" onClick={() => setCreating(true)} disabled={!activeId}>Log time</Button>;

  return (
    <AppShell title="Timesheets" actions={actions}>
      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading…</div>
      ) : !activeId ? (
        <EmptyState icon="clock" title="No project selected" hint="Pick a project to log and review time." />
      ) : (
        <>
          <div className="bf-row bf-gap-4" style={{ marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
            <Kpi label="Total hours" value={kpis.total} />
            <Kpi label="This week" value={kpis.week} color="var(--blue-500)" />
            <Kpi label="Pending approval" value={kpis.pending} color="var(--amber-500)" whole />
          </div>

          <div className="bf-toolbar">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 160 }}>
              <option value="">All statuses</option>
              {TS_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon="clock" title="No time entries" hint="Log labor, equipment or subcontractor hours against this project."
              action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Log time</Button>} />
          ) : (
            <Card style={{ overflow: 'auto' }}>
              <table className="bg-table">
                <thead><tr><th>Date</th><th>Employee</th><th className="num">Hours</th><th>Type</th><th>Description</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {filtered.map((it) => {
                    const st = TS_STATUSES.find((s) => s.value === it.status);
                    return (
                      <tr className="bg-item-row" key={it.id} onClick={() => setEditing(it)}>
                        <td>{formatDate(it.date)}</td>
                        <td><span className="bf-row bf-gap-2">{it.employee_name && <Avatar name={it.employee_name} size={20} />}{it.employee_name || '—'}</span></td>
                        <td className="num">{hoursNum(it.hours)}</td>
                        <td>{it.cost_type ? titleCase(it.cost_type) : '—'}</td>
                        <td className="bf-truncate" style={{ maxWidth: 260 }}>{it.description || '—'}</td>
                        <td>{st ? <Badge color={st.color} dot>{st.label}</Badge> : '—'}</td>
                        <td><div className="bg-actions"><button className="bf-btn bf-btn--ghost bf-btn--sm bf-btn--icon" onClick={(e) => remove(it, e)} aria-label="Delete"><Icon name="trash" size={13} /></button></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {(creating || editing) && activeId && (
        <TimesheetModal projectId={activeId} existing={editing} onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(it) => { upsert(it); setCreating(false); setEditing(null); }} />
      )}
    </AppShell>
  );
}

function Kpi({ label, value, color, whole }: { label: string; value: number; color?: string; whole?: boolean }) {
  return (
    <div className="bf-card bf-card--pad" style={{ padding: 'var(--space-3) var(--space-5)', display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
      <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: color ?? 'var(--text)' }}>{whole ? value : value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
      <span className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>{label}</span>
    </div>
  );
}

function TimesheetModal({ projectId, existing, onClose, onSaved }: { projectId: number; existing: TimesheetEntry | null; onClose: () => void; onSaved: (i: TimesheetEntry) => void }) {
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TimesheetInput>({
    date: existing?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    employee_id: existing?.employee_id ?? null,
    hours: hoursNum(existing?.hours),
    cost_type: existing?.cost_type ?? 'labor',
    location: existing?.location ?? '',
    description: existing?.description ?? '',
    status: existing?.status ?? 'draft',
  });

  useEffect(() => {
    api.get<Member[]>(`/users/project/${projectId}`).then((r) => setMembers(Array.isArray(r) ? r : [])).catch(() => setMembers([]));
  }, [projectId]);

  async function save() {
    if (!form.date) return toast.error('Date is required');
    setSaving(true);
    try {
      const body: TimesheetInput = { ...form, hours: hoursNum(form.hours), employee_id: form.employee_id || undefined };
      const saved = existing ? await timesheetsApi.update(projectId, existing.id, body) : await timesheetsApi.create(projectId, body);
      toast.success(existing ? 'Entry updated' : 'Time logged');
      onSaved(saved);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={existing ? 'Edit time entry' : 'Log time'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}>
      <div className="bf-col bf-gap-4">
        <div className="bf-row bf-gap-4">
          <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Hours"><Input type="number" step="0.25" value={String(form.hours ?? 0)} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Employee">
          <Select value={form.employee_id ? String(form.employee_id) : ''} onChange={(e) => setForm({ ...form, employee_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Me</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <div className="bf-row bf-gap-4">
          <Field label="Cost type">
            <Select value={form.cost_type} onChange={(e) => setForm({ ...form, cost_type: e.target.value })}>
              {TS_COST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {TS_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Description"><Input placeholder="What was worked on?" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
