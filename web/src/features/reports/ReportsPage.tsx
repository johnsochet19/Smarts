import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui/primitives';
import { useProjects } from '@/lib/projects';
import { useToast } from '@/components/ui/toast';
import { titleCase } from '@/lib/format';
import { api } from '@/lib/api';
import '@/features/budget/budget.css';
import './reports.css';

type Row = Record<string, unknown>;
function asArray(r: unknown): Row[] {
  if (Array.isArray(r)) return r as Row[];
  if (r && typeof r === 'object') {
    for (const k of ['rows', 'data', 'items']) {
      const v = (r as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as Row[];
    }
  }
  return [];
}
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function money(v: number): string { return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`; }
const isOpen = (s: unknown) => !['closed', 'complete', 'completed', 'verified', 'approved', 'passed', 'done'].includes(String(s ?? '').toLowerCase());

function countByStatus(rows: Row[], key = 'status'): Array<[string, number]> {
  const m = new Map<string, number>();
  rows.forEach((r) => { const s = String(r[key] ?? 'unknown'); m.set(s, (m.get(s) ?? 0) + 1); });
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

interface Section { key: string; label: string; path: (pid: number) => string }
const SECTIONS: Section[] = [
  { key: 'rfis', label: 'RFIs', path: (p) => `/projects/${p}/rfis` },
  { key: 'submittals', label: 'Submittals', path: (p) => `/projects/${p}/submittals` },
  { key: 'punch', label: 'Punch items', path: (p) => `/projects/${p}/punch-items` },
  { key: 'inspections', label: 'Inspections', path: (p) => `/projects/${p}/inspections` },
  { key: 'incidents', label: 'Incidents', path: (p) => `/projects/${p}/incidents` },
  { key: 'permits', label: 'Permits', path: (p) => `/projects/${p}/permits` },
  { key: 'observations', label: 'Observations', path: (p) => `/projects/${p}/observations` },
  { key: 'dailyLogs', label: 'Daily logs', path: (p) => `/projects/${p}/daily-logs` },
];

export function ReportsPage() {
  const { activeId, active } = useProjects();
  const toast = useToast();
  const [data, setData] = useState<Record<string, Row[]>>({});
  const [budget, setBudget] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const generated = useMemo(() => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), []);

  useEffect(() => {
    if (!activeId) { setLoading(false); return; }
    setLoading(true);
    Promise.allSettled([
      ...SECTIONS.map((s) => api.get(s.path(activeId))),
      api.get(`/budget/${activeId}`),
    ]).then((results) => {
      const next: Record<string, Row[]> = {};
      SECTIONS.forEach((s, i) => {
        const r = results[i];
        next[s.key] = r.status === 'fulfilled' ? asArray(r.value) : [];
      });
      setData(next);
      const b = results[SECTIONS.length];
      setBudget(b.status === 'fulfilled' ? asArray(b.value) : []);
    }).catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to build report'))
      .finally(() => setLoading(false));
  }, [activeId, toast]);

  const budgetTotals = useMemo(() => {
    const estimated = budget.reduce((s, r) => s + num(r.estimated), 0);
    const actual = budget.reduce((s, r) => s + num(r.actual), 0);
    return { estimated, actual, variance: estimated - actual, pct: estimated ? Math.round((actual / estimated) * 100) : 0 };
  }, [budget]);

  const kpis = useMemo(() => {
    const open = (k: string) => (data[k] ?? []).filter((r) => isOpen(r.status)).length;
    const withDef = (data.inspections ?? []).filter((r) => num(r.deficiency_count ?? r.open_deficiencies) > 0).length;
    return [
      { label: 'Open RFIs', value: open('rfis'), total: (data.rfis ?? []).length },
      { label: 'Open submittals', value: open('submittals'), total: (data.submittals ?? []).length },
      { label: 'Open punch items', value: open('punch'), total: (data.punch ?? []).length },
      { label: 'Inspections w/ deficiencies', value: withDef, total: (data.inspections ?? []).length },
      { label: 'Open incidents', value: open('incidents'), total: (data.incidents ?? []).length },
      { label: 'Active permits', value: (data.permits ?? []).filter((r) => ['approved', 'renewed'].includes(String(r.status).toLowerCase())).length, total: (data.permits ?? []).length },
    ];
  }, [data]);

  if (!loading && !activeId) {
    return <AppShell title="Reports"><EmptyState icon="dashboard" title="No project selected" hint="Pick a project to generate its status report." /></AppShell>;
  }

  return (
    <AppShell title="Reports" actions={!loading ? <Button variant="secondary" icon="arrowRight" onClick={() => window.print()}>Print / PDF</Button> : undefined}>
      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Building report…</div>
      ) : (
        <div className="rp-report">
          <div className="rp-head">
            <div>
              <div className="rp-title">Project Status Report</div>
              <div className="bf-muted">{active?.name ?? 'Project'} · Generated {generated}</div>
            </div>
          </div>

          <div className="bg-kpis rp-kpis">
            {kpis.map((k) => (
              <Card key={k.label} pad>
                <div className="bg-kpi__val">{k.value}<span className="rp-of"> / {k.total}</span></div>
                <div className="bg-kpi__label">{k.label}</div>
              </Card>
            ))}
          </div>

          <Card pad className="rp-budget">
            <div style={{ fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-3)' }}>Budget health</div>
            {budget.length === 0 ? (
              <div className="bf-muted">No budget items recorded.</div>
            ) : (
              <div className="rp-budget-grid">
                <div><div className="bg-kpi__val">{money(budgetTotals.estimated)}</div><div className="bg-kpi__label">Estimated</div></div>
                <div><div className="bg-kpi__val">{money(budgetTotals.actual)}</div><div className="bg-kpi__label">Actual</div></div>
                <div><div className="bg-kpi__val" style={{ color: budgetTotals.variance < 0 ? 'var(--red-500)' : 'var(--green-500)' }}>{money(budgetTotals.variance)}</div><div className="bg-kpi__label">Variance</div></div>
                <div><div className="bg-kpi__val">{budgetTotals.pct}%</div><div className="bg-kpi__label">Spent</div></div>
              </div>
            )}
          </Card>

          <div className="rp-sections">
            {SECTIONS.map((s) => {
              const rows = data[s.key] ?? [];
              const breakdown = countByStatus(rows);
              return (
                <Card key={s.key} pad className="rp-section">
                  <div className="rp-section-head">
                    <span style={{ fontWeight: 'var(--weight-semibold)' }}>{s.label}</span>
                    <Badge color="var(--slate-500)" dot>{rows.length}</Badge>
                  </div>
                  {rows.length === 0 ? (
                    <div className="bf-muted" style={{ fontSize: 'var(--text-sm)' }}>No records.</div>
                  ) : (
                    <div className="rp-breakdown">
                      {breakdown.map(([st, n]) => (
                        <div key={st} className="rp-breakdown-row">
                          <span className="bf-muted">{titleCase(String(st).replace(/_/g, ' '))}</span>
                          <span>{n}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </AppShell>
  );
}
