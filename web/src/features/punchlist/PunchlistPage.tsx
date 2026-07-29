import { useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button, Input, Select, Spinner, EmptyState } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/overlays';
import { Icon } from '@/components/ui/Icon';
import { useProjects } from '@/lib/projects';
import { useIsMobile, usePersistentState } from '@/lib/hooks';
import { titleCase } from '@/lib/format';
import { PUNCH_PRIORITIES, PUNCH_STATUSES } from './constants';
import type { PunchStatus } from './constants';
import { usePunchItems } from './api';
import { punchApi } from './api';
import type { PunchItem } from './types';
import { ListView } from './views/ListView';
import { BoardView } from './views/BoardView';
import { CalendarView } from './views/CalendarView';
import { MapView } from './views/MapView';
import { PunchCreateModal } from './PunchCreateModal';
import { PunchDrawer } from './PunchDrawer';
import { useToast } from '@/components/ui/toast';

type ViewKey = 'list' | 'board' | 'calendar' | 'map';

export function PunchlistPage() {
  const { activeId, active, loading: projLoading } = useProjects();
  const isMobile = useIsMobile();
  const toast = useToast();
  const { items, loading, error, upsert, removeLocal } = usePunchItems(activeId);

  const [view, setView] = usePersistentState<ViewKey>('bf_punch_view', 'list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<PunchItem | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (statusFilter && it.status !== statusFilter) return false;
      if (priorityFilter && it.priority !== priorityFilter) return false;
      if (q) {
        const hay = `${it.punch_number ?? ''} ${it.title} ${it.trade ?? ''} ${it.location ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, statusFilter, priorityFilter]);

  const counts = useMemo(() => {
    const open = items.filter((i) => i.status !== 'closed').length;
    const overdue = items.filter((i) => i.due_date && i.status !== 'closed' && new Date(i.due_date) < new Date(new Date().toDateString())).length;
    return { total: items.length, open, overdue };
  }, [items]);

  async function moveItem(item: PunchItem, to: PunchStatus) {
    // optimistic
    upsert({ ...item, status: to });
    try {
      const updated = await punchApi.setStatus(item.id, to);
      upsert(updated);
    } catch (e) {
      upsert(item); // revert
      toast.error(e instanceof Error ? e.message : 'Move failed');
    }
  }

  const actions = (
    <Button variant="primary" icon="plus" onClick={() => setCreating(true)} disabled={!activeId}>
      {isMobile ? '' : 'New item'}
    </Button>
  );

  const viewOptions: Array<{ value: ViewKey; label: string; icon: 'list' | 'board' | 'calendar' | 'map' }> = [
    { value: 'list', label: isMobile ? '' : 'List', icon: 'list' },
    { value: 'board', label: isMobile ? '' : 'Board', icon: 'board' },
    { value: 'calendar', label: isMobile ? '' : 'Calendar', icon: 'calendar' },
    { value: 'map', label: isMobile ? '' : 'Map', icon: 'map' },
  ];

  return (
    <AppShell title="Punchlist" actions={actions}>
      {/* KPI strip */}
      <div className="bf-row bf-gap-4" style={{ marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <KpiPill label="Total" value={counts.total} />
        <KpiPill label="Open" value={counts.open} color="var(--status-open)" />
        <KpiPill label="Overdue" value={counts.overdue} color="var(--red-500)" />
      </div>

      <div className="bf-toolbar">
        <SegmentedControl value={view} options={viewOptions} onChange={setView} />
        <span className="bf-spacer" />
        <div style={{ position: 'relative', minWidth: isMobile ? 0 : 220, flex: isMobile ? 1 : undefined }}>
          <Icon name="search" size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-subtle)' }} />
          <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        {!isMobile && (
          <>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 150 }}>
              <option value="">All statuses</option>
              {PUNCH_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </Select>
            <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ width: 130 }}>
              <option value="">All priority</option>
              {PUNCH_PRIORITIES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
            </Select>
          </>
        )}
      </div>

      {projLoading || loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading punch items…</div>
      ) : !activeId ? (
        <EmptyState icon="punch" title="No project selected" hint="Create or pick a project to start tracking punch items." />
      ) : error ? (
        <EmptyState icon="alert" title="Couldn’t load punch items" hint={error} />
      ) : view === 'list' ? (
        <ListView items={filtered} onOpen={setSelected} />
      ) : view === 'board' ? (
        <BoardView items={filtered} onOpen={setSelected} onMove={moveItem} />
      ) : view === 'calendar' ? (
        <CalendarView items={filtered} onOpen={setSelected} />
      ) : (
        <MapView items={filtered} onOpen={setSelected} />
      )}

      {creating && activeId && (
        <PunchCreateModal projectId={activeId} open={creating} onClose={() => setCreating(false)} onCreated={(it) => upsert(it)} />
      )}
      {selected && (
        <PunchDrawer
          item={selected}
          onClose={() => setSelected(null)}
          onChanged={(it) => { upsert(it); setSelected(it); }}
          onDeleted={(id) => { removeLocal(id); setSelected(null); }}
        />
      )}
      {active && <span style={{ display: 'none' }}>{active.name}</span>}
    </AppShell>
  );
}

function KpiPill({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bf-card bf-card--pad" style={{ padding: 'var(--space-3) var(--space-5)', display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
      <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: color ?? 'var(--text)' }}>{value}</span>
      <span className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>{label}</span>
    </div>
  );
}
