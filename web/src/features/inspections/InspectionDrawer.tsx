import { useEffect, useMemo, useState } from 'react';
import { Drawer } from '@/components/ui/overlays';
import { Badge, Button, Textarea, Spinner } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { formatDate, titleCase } from '@/lib/format';
import { STATUS_META, STATUS_TRANSITIONS } from './constants';
import type { InspectionStatus } from './types';
import type { Inspection, InspectionItem } from './types';
import { inspectionsApi } from './api';
import './inspections.css';

export function InspectionDrawer({
  inspection, onClose, onChanged, onDeleted,
}: {
  inspection: Inspection;
  onClose: () => void;
  onChanged: (i: Inspection) => void;
  onDeleted: (id: number) => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [full, setFull] = useState<Inspection>(inspection);
  const [items, setItems] = useState<InspectionItem[]>(inspection.items ?? []);
  const [loading, setLoading] = useState(!inspection.items);
  const [busy, setBusy] = useState(false);
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => {
    let active = true;
    inspectionsApi.get(inspection.id).then((f) => {
      if (!active) return;
      setFull(f); setItems(f.items ?? []); setLoading(false);
    }).catch(() => setLoading(false));
    return () => { active = false; };
  }, [inspection.id]);

  const meta = STATUS_META[full.status];
  const transitions = STATUS_TRANSITIONS[full.status] ?? [];
  const deficient = items.filter((i) => i.deficient).length;
  const responded = items.filter((i) => i.response != null && i.response !== '').length;

  async function move(to: InspectionStatus) {
    setBusy(true);
    try {
      const updated = await inspectionsApi.setStatus(full.id, to);
      setFull((f) => ({ ...f, ...updated }));
      onChanged({ ...full, ...updated, items });
      toast.success(`Marked ${STATUS_META[to].label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Status change failed');
    } finally { setBusy(false); }
  }

  async function saveItem(item: InspectionItem, patch: Partial<InspectionItem>) {
    setItems((arr) => arr.map((x) => (x.id === item.id ? { ...x, ...patch } : x)));
    try {
      await inspectionsApi.updateItem(full.id, item.id, patch);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save response');
    }
  }

  async function deleteInspection() {
    if (!confirm(`Delete inspection "${full.title}"?`)) return;
    setBusy(true);
    try { await inspectionsApi.remove(full.id); onDeleted(full.id); toast.success('Inspection deleted'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setBusy(false); }
  }

  // Group items by section (preserve order).
  const sections = useMemo(() => {
    const map = new Map<string, InspectionItem[]>();
    for (const it of items) {
      const key = it.section || '';
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <Drawer
      open onClose={onClose}
      title={<div className="bf-row bf-gap-3"><Badge color={meta.color} dot>{meta.label}</Badge>{deficient > 0 && <span className="in-chip in-chip--def"><Icon name="alert" size={13} /> {deficient}</span>}</div>}
      footer={
        <>
          {isAdmin && <Button variant="danger" icon="trash" onClick={deleteInspection} disabled={busy}>Delete</Button>}
          <span className="bf-spacer" />
          {transitions.map((to) => (
            <Button key={to} variant="primary" icon="arrowRight" onClick={() => move(to)} disabled={busy}>{STATUS_META[to].label}</Button>
          ))}
          {transitions.length === 0 && <span className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>No further actions</span>}
        </>
      }
    >
      <div className="in-detail">
        <div className="in-detail__title">{full.title}</div>
        {full.description && <p className="bf-muted">{full.description}</p>}
        <div className="in-detail__grid">
          <div className="in-kv"><span className="k">Type</span><span>{full.type ? titleCase(full.type) : '—'}</span></div>
          <div className="in-kv"><span className="k">Inspector</span><span>{full.inspector_name || 'Unassigned'}</span></div>
          <div className="in-kv"><span className="k">Trade</span><span>{full.trade ? titleCase(full.trade) : '—'}</span></div>
          <div className="in-kv"><span className="k">Location</span><span>{full.location || '—'}</span></div>
          <div className="in-kv"><span className="k">Scheduled</span><span>{full.scheduled_date ? formatDate(full.scheduled_date) : '—'}</span></div>
          <div className="in-kv"><span className="k">Progress</span><span>{responded}/{items.length} checked</span></div>
        </div>

        <div>
          <div className="bf-label" style={{ marginBottom: 'var(--space-2)' }}>Checklist</div>
          {loading ? (
            <div className="bf-row bf-gap-2 bf-muted"><Spinner size={16} /> Loading items…</div>
          ) : items.length === 0 ? (
            <p className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>No checklist items. This inspection was created without a template.</p>
          ) : (
            <div className="in-items">
              {sections.map(([section, secItems]) => (
                <div key={section || 'general'}>
                  {section && <div className="in-section-label">{section}</div>}
                  {secItems.map((it) => <ItemRow key={it.id} item={it} onSave={saveItem} />)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function ItemRow({ item, onSave }: { item: InspectionItem; onSave: (item: InspectionItem, patch: Partial<InspectionItem>) => void }) {
  const isYesNo = item.item_type === 'yes_no' || item.item_type === 'photo_required' || item.item_type === 'signature';
  return (
    <div className={`in-item${item.deficient ? ' in-item--def' : ''}`}>
      <div className="in-item__desc">{item.description}</div>
      {isYesNo ? (
        <div className="in-resp">
          <button className={`in-resp__btn${item.response === 'pass' ? ' in-resp__btn--pass' : ''}`}
            onClick={() => onSave(item, { response: 'pass', deficient: false, requires_correction: false })}>Pass</button>
          <button className={`in-resp__btn${item.response === 'fail' ? ' in-resp__btn--fail' : ''}`}
            onClick={() => onSave(item, { response: 'fail', deficient: true, requires_correction: true })}>Fail</button>
          <button className={`in-resp__btn${item.response === 'na' ? ' in-resp__btn--na' : ''}`}
            onClick={() => onSave(item, { response: 'na', deficient: false, requires_correction: false })}>N/A</button>
        </div>
      ) : (
        <input
          className="bf-input"
          placeholder={item.item_type === 'number' ? 'Enter a value' : 'Enter response'}
          type={item.item_type === 'number' ? 'number' : 'text'}
          defaultValue={item.response ?? ''}
          onBlur={(e) => e.target.value !== (item.response ?? '') && onSave(item, { response: e.target.value })}
        />
      )}
      {item.deficient && (
        <Textarea
          className="in-defnotes"
          placeholder="Describe the deficiency…"
          defaultValue={item.deficiency_notes ?? ''}
          onBlur={(e) => e.target.value !== (item.deficiency_notes ?? '') && onSave(item, { deficiency_notes: e.target.value })}
        />
      )}
    </div>
  );
}
