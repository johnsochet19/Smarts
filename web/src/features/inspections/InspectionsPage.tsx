import { useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Badge, Button, EmptyState, Input, Select, Spinner } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useProjects } from '@/lib/projects';
import { useIsMobile } from '@/lib/hooks';
import { formatDate, titleCase } from '@/lib/format';
import { STATUS_META } from './constants';
import type { InspectionStatus } from './types';
import type { Inspection } from './types';
import { useInspections } from './api';
import { InspectionCreateModal } from './InspectionCreateModal';
import { InspectionDrawer } from './InspectionDrawer';
import './inspections.css';

const STATUSES: InspectionStatus[] = ['pending', 'in_progress', 'deficient', 'passed', 'closed'];

export function InspectionsPage() {
  const { activeId } = useProjects();
  const isMobile = useIsMobile();
  const { items, loading, error, upsert, removeLocal } = useInspections(activeId);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Inspection | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (statusFilter && i.status !== statusFilter) return false;
      if (q && !`${i.title} ${i.trade ?? ''} ${i.location ?? ''} ${i.type ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, statusFilter]);

  const counts = useMemo(() => ({
    total: items.length,
    open: items.filter((i) => i.status !== 'closed' && i.status !== 'passed').length,
    deficient: items.filter((i) => (i.deficiency_count ?? 0) > 0 || i.status === 'deficient').length,
  }), [items]);

  const actions = <Button variant="primary" icon="plus" onClick={() => setCreating(true)} disabled={!activeId}>{isMobile ? '' : 'New inspection'}</Button>;

  return (
    <AppShell title="Inspections" actions={actions}>
      <div className="bf-row bf-gap-4" style={{ marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <Kpi label="Total" value={counts.total} />
        <Kpi label="Open" value={counts.open} color="var(--amber-500)" />
        <Kpi label="With deficiencies" value={counts.deficient} color="var(--red-500)" />
      </div>

      <div className="bf-toolbar">
        <div style={{ position: 'relative', minWidth: isMobile ? 0 : 240, flex: isMobile ? 1 : undefined }}>
          <Icon name="search" size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-subtle)' }} />
          <Input placeholder="Search inspections…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 160 }}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </Select>
      </div>

      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading inspections…</div>
      ) : !activeId ? (
        <EmptyState icon="check" title="No project selected" hint="Pick a project to see its inspections." />
      ) : error ? (
        <EmptyState icon="alert" title="Couldn’t load inspections" hint={error} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="check" title="No inspections" hint="Create an inspection — optionally from a checklist template."
          action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New inspection</Button>} />
      ) : (
        <div className="in-list">
          {filtered.map((i) => {
            const meta = STATUS_META[i.status];
            const total = i.items?.length ?? 0;
            const responded = i.items?.filter((it) => it.response != null && it.response !== '').length ?? 0;
            return (
              <div key={i.id} className="in-row" onClick={() => setSelected(i)} role="button" tabIndex={0}>
                <div className="in-row__main">
                  <div className="in-row__title bf-truncate">{i.title}</div>
                  <div className="in-row__meta">
                    {i.type && <span className="in-chip">{titleCase(i.type)}</span>}
                    {i.trade && <span className="in-chip">{titleCase(i.trade)}</span>}
                    {i.location && <span className="in-chip">{i.location}</span>}
                    {i.scheduled_date && <span className="in-chip"><Icon name="calendar" size={12} /> {formatDate(i.scheduled_date)}</span>}
                    {(i.deficiency_count ?? 0) > 0 && <span className="in-chip in-chip--def"><Icon name="alert" size={12} /> {i.deficiency_count} deficient</span>}
                  </div>
                </div>
                {total > 0 && (
                  <div className="in-progress" title={`${responded}/${total} checked`}>
                    <div className="in-progress__track"><div className="in-progress__fill" style={{ width: `${total ? (responded / total) * 100 : 0}%` }} /></div>
                    <span className="bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>{responded}/{total}</span>
                  </div>
                )}
                <Badge color={meta.color} dot>{meta.label}</Badge>
              </div>
            );
          })}
        </div>
      )}

      {creating && activeId && (
        <InspectionCreateModal projectId={activeId} open={creating} onClose={() => setCreating(false)} onCreated={(i) => upsert(i)} />
      )}
      {selected && (
        <InspectionDrawer
          inspection={selected}
          onClose={() => setSelected(null)}
          onChanged={(i) => { upsert(i); setSelected(i); }}
          onDeleted={(id) => { removeLocal(id); setSelected(null); }}
        />
      )}
    </AppShell>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bf-card bf-card--pad" style={{ padding: 'var(--space-3) var(--space-5)', display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
      <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: color ?? 'var(--text)' }}>{value}</span>
      <span className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>{label}</span>
    </div>
  );
}
