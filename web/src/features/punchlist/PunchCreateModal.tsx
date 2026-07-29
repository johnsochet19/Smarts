import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/overlays';
import { Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { PUNCH_PRIORITIES, PUNCH_TYPES } from './constants';
import type { PunchPriority, PunchType } from './constants';
import { punchApi } from './api';
import type { PunchItem } from './types';

interface Member { id: number; name: string }

export function PunchCreateModal({
  projectId, open, onClose, onCreated,
}: {
  projectId: number;
  open: boolean;
  onClose: () => void;
  onCreated: (item: PunchItem) => void;
}) {
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', type: 'general' as PunchType,
    priority: 'normal' as PunchPriority, trade: '', location: '',
    due_date: '', assignee_id: '',
  });

  useEffect(() => {
    if (!open) return;
    setForm({ title: '', description: '', type: 'general', priority: 'normal', trade: '', location: '', due_date: '', assignee_id: '' });
    setGps(null);
    api.get<Member[]>(`/users/project/${projectId}`).then((rows) => setMembers(Array.isArray(rows) ? rows : [])).catch(() => setMembers([]));
  }, [open, projectId]);

  function captureGps() {
    if (!navigator.geolocation) return toast.error('Geolocation not supported on this device');
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsBusy(false); toast.success('Location captured'); },
      () => { setGpsBusy(false); toast.error('Could not get location (permission denied?)'); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function submit() {
    if (!form.title.trim()) return toast.error('Title is required');
    setSaving(true);
    try {
      const created = await punchApi.create(projectId, {
        title: form.title.trim(),
        description: form.description || undefined,
        type: form.type,
        priority: form.priority,
        trade: form.trade || undefined,
        location: form.location || undefined,
        due_date: form.due_date || null,
        assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
      });
      toast.success(`Punch item #${created.punch_number ?? created.id} created`);
      onCreated(created);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New punch item"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create item'}</Button>
        </>
      }
    >
      <div className="bf-col bf-gap-4">
        <Field label="Title">
          <Input autoFocus placeholder="e.g. Touch-up paint in stairwell B" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Description">
          <Textarea placeholder="What needs to be corrected?" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="pl-detail__grid">
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PunchType })}>
              {PUNCH_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as PunchPriority })}>
              {PUNCH_PRIORITIES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
            </Select>
          </Field>
          <Field label="Trade">
            <Input placeholder="e.g. Electrical" value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} />
          </Field>
          <Field label="Location">
            <Input placeholder="e.g. Level 3 — Unit 304" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </Field>
          <Field label="Assignee">
            <Select value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        </div>
        <Button variant={gps ? 'secondary' : 'ghost'} icon="pin" onClick={captureGps} disabled={gpsBusy}>
          {gpsBusy ? 'Locating…' : gps ? `GPS: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'Tag GPS location'}
        </Button>
        {gps && (
          <button className="bf-btn bf-btn--ghost bf-btn--sm" onClick={() => setGps(null)} style={{ alignSelf: 'flex-start' }}>
            <Icon name="close" size={14} /> Clear location
          </button>
        )}
      </div>
    </Modal>
  );
}
