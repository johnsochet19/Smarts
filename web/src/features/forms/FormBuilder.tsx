import { useState } from 'react';
import { Modal } from '@/components/ui/overlays';
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { formsApi } from './api';
import { FormRenderer } from './FormRenderer';
import type { FieldType, Form, FormField, TargetResource } from './types';

const FIELD_TYPES: FieldType[] = ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'email'];
const TARGETS: Array<{ value: TargetResource; label: string; keys?: string[] }> = [
  { value: 'none', label: 'Store submissions only' },
  { value: 'punch_item', label: 'Create a Punch item', keys: ['title', 'description', 'priority', 'trade', 'location', 'due_date'] },
  { value: 'task', label: 'Create a Task', keys: ['title', 'description', 'priority'] },
];

function slug(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
}

export function FormBuilder({
  projectId, existing, onClose, onSaved,
}: {
  projectId: number;
  existing?: Form | null;
  onClose: () => void;
  onSaved: (f: Form) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [target, setTarget] = useState<TargetResource>(existing?.target_resource ?? 'none');
  const [fields, setFields] = useState<FormField[]>(existing?.fields ?? [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea' },
  ]);
  const [saving, setSaving] = useState(false);

  const targetMeta = TARGETS.find((t) => t.value === target);

  function addField() {
    setFields([...fields, { key: `field_${fields.length + 1}`, label: 'Untitled', type: 'text' }]);
  }
  function patchField(i: number, patch: Partial<FormField>) {
    setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeField(i: number) {
    setFields(fields.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = fields.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
  }

  async function save() {
    if (!name.trim()) return toast.error('Give the form a name');
    if (!fields.length) return toast.error('Add at least one field');
    setSaving(true);
    try {
      const body = { name, description, target_resource: target, fields };
      const saved = existing ? await formsApi.update(existing.id, body) : await formsApi.create(projectId, body);
      toast.success(existing ? 'Form updated' : 'Form created');
      onSaved(saved);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? 'Edit form' : 'New form'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save form'}</Button></>}
    >
      <div className="bf-col bf-gap-4">
        <Field label="Form name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Field issue report" /></Field>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown to people filling out the form" /></Field>
        <Field label="On submit">
          <Select value={target} onChange={(e) => setTarget(e.target.value as TargetResource)}>
            {TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        {targetMeta?.keys && (
          <div className="bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>
            Map fields to these keys to populate the record: <span className="bf-mono">{targetMeta.keys.join(', ')}</span>
          </div>
        )}

        <div className="bf-label">Fields</div>
        {fields.map((f, i) => (
          <div className="fm-fieldrow" key={i}>
            <div className="fm-fieldrow__head">
              <Input value={f.label} onChange={(e) => { const label = e.target.value; patchField(i, { label, key: f.key && f.key !== slug(f.label) ? f.key : slug(label) }); }} placeholder="Field label" />
              <div style={{ width: 140 }}>
                <Select value={f.type} onChange={(e) => patchField(i, { type: e.target.value as FieldType })}>
                  {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <Button variant="ghost" size="sm" iconOnly icon="chevronLeft" onClick={() => move(i, -1)} aria-label="Move up" style={{ transform: 'rotate(90deg)' }} />
              <Button variant="ghost" size="sm" iconOnly icon="chevronRight" onClick={() => move(i, 1)} aria-label="Move down" style={{ transform: 'rotate(90deg)' }} />
              <Button variant="ghost" size="sm" iconOnly icon="trash" onClick={() => removeField(i)} aria-label="Remove field" />
            </div>
            <div className="fm-fieldrow__opts">
              <label className="bf-row bf-gap-1"><input type="checkbox" checked={!!f.required} onChange={(e) => patchField(i, { required: e.target.checked })} /> Required</label>
              <label className="bf-row bf-gap-1"><input type="checkbox" checked={!!f.hidden} onChange={(e) => patchField(i, { hidden: e.target.checked })} /> Hidden</label>
              <span className="bf-mono bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>key: {f.key}</span>
              {f.type === 'select' && (
                <Input
                  style={{ flex: 1, minWidth: 160 }}
                  placeholder="Options: comma,separated,values"
                  defaultValue={(f.options ?? []).map((o) => o.label).join(', ')}
                  onBlur={(e) => patchField(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).map((v) => ({ value: v, label: v })) })}
                />
              )}
            </div>
          </div>
        ))}
        <Button variant="ghost" size="sm" icon="plus" onClick={addField}>Add field</Button>

        <Card pad style={{ background: 'var(--bg-sunken)' }}>
          <div className="bf-label" style={{ marginBottom: 'var(--space-3)' }}><Icon name="punch" size={13} /> Live preview</div>
          <FormRenderer fields={fields} submitLabel="Submit (preview)" onSubmit={() => toast.show('Preview only — not submitted')} />
        </Card>
      </div>
    </Modal>
  );
}
