import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button, Card, EmptyState, Spinner } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { useProjects } from '@/lib/projects';
import { formatDate } from '@/lib/format';
import { sheetsApi } from './api';
import type { FullSheet, SheetMeta } from './types';
import { SheetGrid } from './SheetGrid';
import './sheets.css';

export function SheetsPage() {
  const { activeId } = useProjects();
  const toast = useToast();
  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<FullSheet | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!activeId) { setLoading(false); return; }
    setLoading(true);
    setOpen(null);
    sheetsApi.list(activeId)
      .then((rows) => setSheets(Array.isArray(rows) ? rows : []))
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load sheets'))
      .finally(() => setLoading(false));
  }, [activeId, toast]);

  async function createSheet() {
    if (!activeId) return;
    const name = prompt('Name your sheet', 'Untitled Sheet');
    if (name == null) return;
    try {
      const full = await sheetsApi.create(activeId, name || 'Untitled Sheet');
      setSheets((s) => [full.sheet, ...s]);
      setOpen(full);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create sheet'); }
  }

  async function openSheet(id: number) {
    setOpening(true);
    try { setOpen(await sheetsApi.get(id)); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not open sheet'); }
    finally { setOpening(false); }
  }

  async function deleteSheet(id: number) {
    if (!confirm('Delete this sheet and all its rows?')) return;
    setSheets((s) => s.filter((x) => x.id !== id));
    try { await sheetsApi.remove(id); } catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed'); }
  }

  // ---- Open sheet view ----
  if (open) {
    return (
      <AppShell
        title={open.sheet.name}
        actions={<Button variant="ghost" icon="chevronLeft" onClick={() => setOpen(null)}>All sheets</Button>}
      >
        <SheetGrid key={open.sheet.id} initial={open} />
      </AppShell>
    );
  }

  // ---- Sheet list view ----
  return (
    <AppShell
      title="Sheets"
      actions={<Button variant="primary" icon="plus" onClick={createSheet} disabled={!activeId}>New sheet</Button>}
    >
      {loading || opening ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading…</div>
      ) : !activeId ? (
        <EmptyState icon="grid" title="No project selected" hint="Pick a project to see its sheets." />
      ) : sheets.length === 0 ? (
        <EmptyState icon="grid" title="No sheets yet" hint="Create your first Smartsheet-style grid — custom columns, row hierarchy, formulas."
          action={<Button variant="primary" icon="plus" onClick={createSheet}>New sheet</Button>} />
      ) : (
        <div className="sh-list">
          {sheets.map((s) => (
            <Card key={s.id} pad hover className="sh-tile" onClick={() => openSheet(s.id)}>
              <div className="bf-row bf-gap-3">
                <span style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="grid" size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="sh-tile__name bf-truncate">{s.name}</div>
                  <div className="bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>{s.row_count ?? 0} rows · {formatDate(s.updated_at)}</div>
                </div>
                <button className="sh-rowbtn" style={{ opacity: 1 }} onClick={(e) => { e.stopPropagation(); deleteSheet(s.id); }} aria-label="Delete sheet"><Icon name="trash" size={15} /></button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
