import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Spinner } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlays';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { useProjects } from '@/lib/projects';
import { budgetApi, BUDGET_STATUSES, money, num, type BudgetInput, type BudgetItem } from './api';
import './budget.css';

export function BudgetPage() {
  const { activeId } = useProjects();
  const toast = useToast();
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BudgetItem | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!activeId) { setLoading(false); return; }
    setLoading(true);
    budgetApi.list(activeId).then((r) => setItems(Array.isArray(r) ? r : []))
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load budget'))
      .finally(() => setLoading(false));
  }, [activeId, toast]);

  const totals = useMemo(() => {
    const est = items.reduce((s, i) => s + num(i.estimated), 0);
    const act = items.reduce((s, i) => s + num(i.actual), 0);
    return { est, act, variance: est - act, pct: est ? Math.round((act / est) * 100) : 0 };
  }, [items]);

  // Group by category (preserve first-seen order).
  const groups = useMemo(() => {
    const map = new Map<string, BudgetItem[]>();
    for (const it of items) {
      const key = it.category?.trim() || 'Uncategorized';
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return [...map.entries()].map(([category, rows]) => ({
      category, rows,
      est: rows.reduce((s, r) => s + num(r.estimated), 0),
      act: rows.reduce((s, r) => s + num(r.actual), 0),
    }));
  }, [items]);

  function upsert(it: BudgetItem) {
    setItems((prev) => {
      const i = prev.findIndex((x) => x.id === it.id);
      if (i === -1) return [...prev, it];
      const next = prev.slice(); next[i] = it; return next;
    });
  }
  async function remove(it: BudgetItem, e: React.MouseEvent) {
    e.stopPropagation();
    if (!activeId || !confirm('Delete this budget line?')) return;
    setItems((p) => p.filter((x) => x.id !== it.id));
    try { await budgetApi.remove(activeId, it.id); } catch (err) { toast.error(err instanceof Error ? err.message : 'Delete failed'); }
  }

  const actions = <Button variant="primary" icon="plus" onClick={() => setCreating(true)} disabled={!activeId}>New line</Button>;

  return (
    <AppShell title="Budget" actions={actions}>
      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading budget…</div>
      ) : !activeId ? (
        <EmptyState icon="dashboard" title="No project selected" hint="Pick a project to see its budget." />
      ) : (
        <>
          <div className="bg-kpis">
            <Card pad hover><div className="bg-kpi__val">{money(totals.est)}</div><div className="bg-kpi__label">Estimated</div></Card>
            <Card pad hover><div className="bg-kpi__val">{money(totals.act)}</div><div className="bg-kpi__label">Actual</div></Card>
            <Card pad hover><div className="bg-kpi__val" style={{ color: totals.variance < 0 ? 'var(--red-500)' : 'var(--green-500)' }}>{money(totals.variance)}</div><div className="bg-kpi__label">Variance</div></Card>
            <Card pad hover><div className="bg-kpi__val" style={{ color: totals.pct > 100 ? 'var(--red-500)' : undefined }}>{totals.pct}%</div><div className="bg-kpi__label">Spent</div></Card>
          </div>

          {items.length === 0 ? (
            <EmptyState icon="dashboard" title="No budget lines yet" hint="Add cost categories and line items to track estimated vs actual."
              action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New line</Button>} />
          ) : (
            <Card style={{ overflow: 'auto' }}>
              <table className="bg-table">
                <thead>
                  <tr>
                    <th>Description</th><th>Vendor</th><th className="num">Estimated</th><th className="num">Actual</th><th className="num">Variance</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <>
                      <tr className="bg-cat-row" key={`cat-${g.category}`}>
                        <td colSpan={2}>{g.category}</td>
                        <td className="num">{money(g.est)}</td>
                        <td className="num">{money(g.act)}</td>
                        <td className={`num ${g.est - g.act < 0 ? 'bg-neg' : 'bg-pos'}`}>{money(g.est - g.act)}</td>
                        <td colSpan={2}></td>
                      </tr>
                      {g.rows.map((it) => {
                        const v = num(it.estimated) - num(it.actual);
                        const st = BUDGET_STATUSES.find((s) => s.value === it.status);
                        return (
                          <tr className="bg-item-row" key={it.id} onClick={() => setEditing(it)}>
                            <td>{it.description || '—'}</td>
                            <td>{it.vendor || '—'}</td>
                            <td className="num">{money(it.estimated)}</td>
                            <td className="num">{money(it.actual)}</td>
                            <td className={`num ${v < 0 ? 'bg-neg' : ''}`}>{money(v)}</td>
                            <td>{st ? <Badge color={st.color} dot>{st.label}</Badge> : '—'}</td>
                            <td><div className="bg-actions"><button className="bf-btn bf-btn--ghost bf-btn--sm bf-btn--icon" onClick={(e) => remove(it, e)} aria-label="Delete"><Icon name="trash" size={13} /></button></div></td>
                          </tr>
                        );
                      })}
                    </>
                  ))}
                  <tr className="bg-total-row">
                    <td colSpan={2}>Total</td>
                    <td className="num">{money(totals.est)}</td>
                    <td className="num">{money(totals.act)}</td>
                    <td className={`num ${totals.variance < 0 ? 'bg-neg' : 'bg-pos'}`}>{money(totals.variance)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {(creating || editing) && activeId && (
        <BudgetModal
          projectId={activeId}
          existing={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(it) => { upsert(it); setCreating(false); setEditing(null); }}
        />
      )}
    </AppShell>
  );
}

function BudgetModal({ projectId, existing, onClose, onSaved }: { projectId: number; existing: BudgetItem | null; onClose: () => void; onSaved: (i: BudgetItem) => void }) {
  const toast = useToast();
  const [form, setForm] = useState<BudgetInput>({
    category: existing?.category ?? '', description: existing?.description ?? '', vendor: existing?.vendor ?? '',
    estimated: num(existing?.estimated), actual: num(existing?.actual), status: existing?.status ?? 'pending',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const body: BudgetInput = { ...form, estimated: num(form.estimated), actual: num(form.actual) };
      const saved = existing ? await budgetApi.update(projectId, existing.id, body) : await budgetApi.create(projectId, body);
      toast.success(existing ? 'Line updated' : 'Line added');
      onSaved(saved);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={existing ? 'Edit budget line' : 'New budget line'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}>
      <div className="bf-col bf-gap-4">
        <Field label="Category"><Input placeholder="e.g. Concrete" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
        <Field label="Description"><Input placeholder="e.g. Slab on grade" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Vendor"><Input placeholder="e.g. ABC Concrete" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></Field>
        <div className="bf-row bf-gap-4">
          <Field label="Estimated ($)"><Input type="number" value={String(form.estimated ?? 0)} onChange={(e) => setForm({ ...form, estimated: Number(e.target.value) })} /></Field>
          <Field label="Actual ($)"><Input type="number" value={String(form.actual ?? 0)} onChange={(e) => setForm({ ...form, actual: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {BUDGET_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
