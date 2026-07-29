import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/overlays';
import { useProjects } from '@/lib/projects';
import { useToast } from '@/components/ui/toast';
import { formatDate, titleCase } from '@/lib/format';
import { api } from '@/lib/api';
import '@/features/budget/budget.css';

type Tab = 'budget' | 'events' | 'orders';
type Row = Record<string, unknown>;

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function money(v: unknown): string { return `$${num(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`; }
function asArray(r: unknown): Row[] {
  if (Array.isArray(r)) return r as Row[];
  if (r && typeof r === 'object') {
    for (const k of ['data', 'rows', 'items', 'lines', 'events', 'orders']) {
      const v = (r as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as Row[];
    }
  }
  return [];
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'var(--slate-500)', open: 'var(--blue-500)', pending: 'var(--amber-500)', submitted: 'var(--blue-500)',
  approved: 'var(--green-500)', executed: 'var(--green-500)', rejected: 'var(--red-500)', void: 'var(--red-500)', closed: 'var(--green-500)',
};
function StatusCell({ v }: { v: unknown }) {
  const s = String(v ?? '');
  if (!s) return <span className="bf-subtle">—</span>;
  return <Badge color={STATUS_COLORS[s] ?? 'var(--slate-500)'} dot>{titleCase(s)}</Badge>;
}

export function CostPage() {
  const { activeId } = useProjects();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('budget');
  const [budget, setBudget] = useState<Row[]>([]);
  const [events, setEvents] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeId) { setLoading(false); return; }
    setLoading(true);
    Promise.allSettled([
      api.get(`/projects/${activeId}/cost/budget`),
      api.get(`/projects/${activeId}/cost/change-events`),
      api.get(`/projects/${activeId}/cost/change-orders`),
    ]).then(([b, e, o]) => {
      setBudget(b.status === 'fulfilled' ? asArray(b.value) : []);
      setEvents(e.status === 'fulfilled' ? asArray(e.value) : []);
      setOrders(o.status === 'fulfilled' ? asArray(o.value) : []);
    }).catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load cost data'))
      .finally(() => setLoading(false));
  }, [activeId, toast]);

  const totals = useMemo(() => ({
    budgeted: budget.reduce((s, r) => s + num(r.budgeted_amount), 0),
    committed: budget.reduce((s, r) => s + num(r.committed_amount), 0),
    actual: budget.reduce((s, r) => s + num(r.actual_cost), 0),
    projected: budget.reduce((s, r) => s + num(r.projected_cost || r.budgeted_amount), 0),
    coValue: orders.reduce((s, r) => s + num(r.total_amount || r.amount || r.cost_impact_amount), 0),
  }), [budget, orders]);

  return (
    <AppShell title="Cost Management">
      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading cost data…</div>
      ) : !activeId ? (
        <EmptyState icon="dashboard" title="No project selected" hint="Pick a project to see cost management." />
      ) : (
        <>
          <div className="bg-kpis">
            <Card pad hover><div className="bg-kpi__val">{money(totals.budgeted)}</div><div className="bg-kpi__label">Budgeted</div></Card>
            <Card pad hover><div className="bg-kpi__val">{money(totals.committed)}</div><div className="bg-kpi__label">Committed</div></Card>
            <Card pad hover><div className="bg-kpi__val">{money(totals.actual)}</div><div className="bg-kpi__label">Actual cost</div></Card>
            <Card pad hover><div className="bg-kpi__val" style={{ color: totals.coValue ? 'var(--amber-500)' : undefined }}>{money(totals.coValue)}</div><div className="bg-kpi__label">Change orders</div></Card>
          </div>

          <div className="bf-toolbar">
            <SegmentedControl value={tab} onChange={setTab} options={[
              { value: 'budget', label: `Budget (${budget.length})` },
              { value: 'events', label: `Change events (${events.length})` },
              { value: 'orders', label: `Change orders (${orders.length})` },
            ]} />
          </div>

          {tab === 'budget' && (
            <CostTable rows={budget} empty="No budget line items yet."
              cols={[
                { k: 'description', label: 'Description', grow: true },
                { k: 'cost_type', label: 'Type', fmt: (v) => (v ? titleCase(String(v)) : '—') },
                { k: 'budgeted_amount', label: 'Budgeted', money: true },
                { k: 'committed_amount', label: 'Committed', money: true },
                { k: 'actual_cost', label: 'Actual', money: true },
                { k: 'percent_complete', label: '% Done', fmt: (v) => `${num(v)}%` },
              ]} />
          )}
          {tab === 'events' && (
            <CostTable rows={events} empty="No change events yet."
              cols={[
                { k: 'number', label: '#', mono: true },
                { k: 'title', label: 'Title', grow: true },
                { k: 'status', label: 'Status', status: true },
                { k: 'cost_impact_amount', label: 'Cost impact', money: true },
                { k: 'event_date', label: 'Date', date: true },
              ]} />
          )}
          {tab === 'orders' && (
            <CostTable rows={orders} empty="No change orders yet."
              cols={[
                { k: 'number', label: '#', mono: true },
                { k: 'title', label: 'Title', grow: true },
                { k: 'type', label: 'Type', fmt: (v) => (v ? titleCase(String(v)) : '—') },
                { k: 'status', label: 'Status', status: true },
                { k: 'schedule_impact_days', label: 'Sched. impact', fmt: (v) => (v ? `${num(v)}d` : '—') },
              ]} />
          )}
        </>
      )}
    </AppShell>
  );
}

interface Col { k: string; label: string; grow?: boolean; mono?: boolean; money?: boolean; date?: boolean; status?: boolean; fmt?: (v: unknown) => string }

function CostTable({ rows, cols, empty }: { rows: Row[]; cols: Col[]; empty: string }) {
  if (!rows.length) return <EmptyState icon="dashboard" title={empty} hint="Managed in the classic cost module until fully migrated." />;
  return (
    <Card style={{ overflow: 'auto' }}>
      <table className="bg-table">
        <thead><tr>{cols.map((c) => <th key={c.k} className={c.money ? 'num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => {
                const v = r[c.k];
                if (c.status) return <td key={c.k}><StatusCell v={v} /></td>;
                if (c.money) return <td key={c.k} className="num">{money(v)}</td>;
                if (c.mono) return <td key={c.k} className="bf-mono bf-subtle">{v ? `#${v}` : '—'}</td>;
                if (c.date) return <td key={c.k}>{v ? formatDate(String(v)) : '—'}</td>;
                return <td key={c.k} className={c.grow ? '' : ''}>{c.fmt ? c.fmt(v) : (v ?? '—') as string}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
