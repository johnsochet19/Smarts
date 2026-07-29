import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/overlays';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { INSPECTION_TYPES } from './constants';
import { inspectionsApi } from './api';
import type { Inspection, InspectionTemplate } from './types';

interface Member { id: number; name: string }

export function InspectionCreateModal({
  projectId, open, onClose, onCreated,
}: {
  projectId: number;
  open: boolean;
  onClose: () => void;
  onCreated: (i: Inspection) => void;
}) {
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'quality', trade: '', location: '', scheduled_date: '', inspector_id: '', template_id: '' });

  useEffect(() => {
    if (!open) return;
    setForm({ title: '', type: 'quality', trade: '', location: '', scheduled_date: '', inspector_id: '', template_id: '' });
    api.get<Member[]>(`/users/project/${projectId}`).then((r) => setMembers(Array.isArray(r) ? r : [])).catch(() => setMembers([]));
    inspectionsApi.templates(projectId).then((r) => setTemplates(Array.isArray(r) ? r : [])).catch(() => setTemplates([]));
  }, [open, projectId]);

  async function submit() {
    if (!form.title.trim()) return toast.error('Title is required');
    setSaving(true);
    try {
      const created = await inspectionsApi.create(projectId, {
        title: form.title.trim(),
        type: form.type,
        trade: form.trade || undefined,
        location: form.location || undefined,
        scheduled_date: form.scheduled_date || null,
        inspector_id: form.inspector_id ? Number(form.inspector_id) : null,
        template_id: form.template_id ? Number(form.template_id) : null,
      });
      toast.success('Inspection created');
      onCreated(created);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create');
    } finally { setSaving(false); }
  }

  return (
    <Modal
      open={open} onClose={onClose} title="New inspection"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button></>}
    >
      <div className="bf-col bf-gap-4">
        <Field label="Title"><Input autoFocus placeholder="e.g. Level 3 pre-drywall inspection" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Checklist template" hint={templates.length ? 'Picking a template copies its checklist items onto this inspection.' : 'No templates yet — you can still create a blank inspection.'}>
          <Select value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
            <option value="">No template (blank)</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.items ? ` (${t.items.length} items)` : ''}</option>)}
          </Select>
        </Field>
        <div className="in-detail__grid">
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {INSPECTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Trade"><Input placeholder="e.g. Framing" value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} /></Field>
          <Field label="Location"><Input placeholder="e.g. Level 3" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Scheduled date"><Input type="date" value={form.scheduled_date} onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })} /></Field>
          <Field label="Inspector">
            <Select value={form.inspector_id} onChange={(e) => setForm({ ...form, inspector_id: e.target.value })}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
