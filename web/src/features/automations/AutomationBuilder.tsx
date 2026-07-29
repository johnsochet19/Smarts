import { useState } from 'react';
import { Modal } from '@/components/ui/overlays';
import { Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { ACTION_FIELDS, ACTIONS, COMMON_FIELDS, OPERATORS, RESOURCES, TRIGGERS, USER_TARGETS } from './constants';
import type { Action, ActionType, Automation, AutomationDraft, Condition, ConditionOp, TriggerType } from './types';
import { automationsApi } from './api';

const EMPTY: AutomationDraft = {
  name: '',
  enabled: true,
  trigger: { type: 'status_changed', resource: 'punch_item' },
  conditions: [],
  actions: [{ type: 'notify', config: { to: 'assignee', title: '', message: '' } }],
};

export function AutomationBuilder({
  projectId, existing, onClose, onSaved,
}: {
  projectId: number;
  existing?: Automation | null;
  onClose: () => void;
  onSaved: (a: Automation) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<AutomationDraft>(() =>
    existing
      ? { name: existing.name, enabled: existing.enabled, trigger: existing.trigger, conditions: existing.conditions ?? [], actions: existing.actions ?? [] }
      : structuredClone(EMPTY)
  );
  const [saving, setSaving] = useState(false);

  function setTrigger(type: TriggerType) {
    const meta = TRIGGERS.find((t) => t.value === type);
    setDraft({ ...draft, trigger: { type, resource: meta?.resource ?? draft.trigger.resource } });
  }

  function addCondition() {
    setDraft({ ...draft, conditions: [...draft.conditions, { field: 'status', op: 'equals', value: '' }] });
  }
  function setCondition(i: number, patch: Partial<Condition>) {
    setDraft({ ...draft, conditions: draft.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  }
  function removeCondition(i: number) {
    setDraft({ ...draft, conditions: draft.conditions.filter((_, idx) => idx !== i) });
  }

  function addAction() {
    setDraft({ ...draft, actions: [...draft.actions, { type: 'notify', config: { to: 'assignee', title: '', message: '' } }] });
  }
  function setActionType(i: number, type: ActionType) {
    setDraft({ ...draft, actions: draft.actions.map((a, idx) => (idx === i ? { type, config: {} } : a)) });
  }
  function setActionConfig(i: number, key: string, value: string) {
    setDraft({ ...draft, actions: draft.actions.map((a, idx) => (idx === i ? { ...a, config: { ...a.config, [key]: value } } : a)) });
  }
  function removeAction(i: number) {
    setDraft({ ...draft, actions: draft.actions.filter((_, idx) => idx !== i) });
  }

  async function save() {
    if (!draft.name.trim()) return toast.error('Give your automation a name');
    if (!draft.actions.length) return toast.error('Add at least one action');
    setSaving(true);
    try {
      const saved = existing
        ? await automationsApi.update(existing.id, draft)
        : await automationsApi.create(projectId, draft);
      toast.success(existing ? 'Automation updated' : 'Automation created');
      onSaved(saved);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  }

  const triggerMeta = TRIGGERS.find((t) => t.value === draft.trigger.type);

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? 'Edit automation' : 'New automation'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save automation'}</Button></>}
    >
      <Field label="Name">
        <Input autoFocus placeholder="e.g. Notify PM when a high-priority item closes" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </Field>

      {/* WHEN */}
      <div className="au-section" style={{ marginTop: 'var(--space-4)' }}>
        <div className="au-section__label"><span className="au-badge-step" style={{ background: 'var(--blue-500)' }}>1</span> When {triggerMeta && (triggerMeta.wired ? <span className="au-wired">live</span> : <span className="au-unwired">not wired yet</span>)}</div>
        <div className="au-row">
          <div className="au-row__grow">
            <Select value={draft.trigger.type} onChange={(e) => setTrigger(e.target.value as TriggerType)}>
              {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </div>
          <div className="au-row__grow">
            <Select value={draft.trigger.resource ?? ''} onChange={(e) => setDraft({ ...draft, trigger: { ...draft.trigger, resource: e.target.value || undefined } })}>
              {RESOURCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </div>
        </div>
      </div>

      {/* IF */}
      <div className="au-section">
        <div className="au-section__label"><span className="au-badge-step" style={{ background: 'var(--amber-500)' }}>2</span> If (all must match)</div>
        {draft.conditions.map((c, i) => {
          const op = OPERATORS.find((o) => o.value === c.op);
          return (
            <div className="au-row" key={i}>
              <Input list="au-fields" placeholder="field" value={c.field} onChange={(e) => setCondition(i, { field: e.target.value })} />
              <Select value={c.op} onChange={(e) => setCondition(i, { op: e.target.value as ConditionOp })}>
                {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
              {!op?.unary && <Input className="au-row__grow" placeholder="value" value={c.value ?? ''} onChange={(e) => setCondition(i, { value: e.target.value })} />}
              <Button variant="ghost" size="sm" iconOnly icon="trash" onClick={() => removeCondition(i)} aria-label="Remove condition" />
            </div>
          );
        })}
        <datalist id="au-fields">{COMMON_FIELDS.map((f) => <option key={f} value={f} />)}</datalist>
        <Button variant="ghost" size="sm" icon="plus" onClick={addCondition}>Add condition</Button>
      </div>

      {/* THEN */}
      <div className="au-section">
        <div className="au-section__label"><span className="au-badge-step" style={{ background: 'var(--violet-500)' }}>3</span> Then</div>
        {draft.actions.map((a, i) => (
          <div className="au-action" key={i}>
            <div className="au-row">
              <div className="au-row__grow">
                <Select value={a.type} onChange={(e) => setActionType(i, e.target.value as ActionType)}>
                  {ACTIONS.map((ac) => <option key={ac.value} value={ac.value}>{ac.label}</option>)}
                </Select>
              </div>
              <Button variant="ghost" size="sm" iconOnly icon="trash" onClick={() => removeAction(i)} aria-label="Remove action" />
            </div>
            <ActionFields action={a} onChange={(k, v) => setActionConfig(i, k, v)} />
            {ACTIONS.find((ac) => ac.value === a.type)?.note && (
              <div className="bf-subtle" style={{ fontSize: 'var(--text-xs)', marginTop: 4 }}>{ACTIONS.find((ac) => ac.value === a.type)?.note}</div>
            )}
          </div>
        ))}
        <Button variant="ghost" size="sm" icon="plus" onClick={addAction}>Add action</Button>
      </div>

      <label className="bf-row bf-gap-2" style={{ cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
        Enabled
      </label>
      <div className="bf-subtle" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
        Tip: use <code className="bf-mono">{'{{field}}'}</code> in titles/messages to insert record values, e.g. <code className="bf-mono">{'#{{punch_number}}'}</code>.
      </div>
    </Modal>
  );
}

function ActionFields({ action, onChange }: { action: Action; onChange: (key: string, value: string) => void }) {
  const fields = ACTION_FIELDS[action.type] ?? [];
  return (
    <div className="bf-col bf-gap-2" style={{ marginTop: 'var(--space-2)' }}>
      {fields.map((f) => {
        const val = action.config[f.key] ?? '';
        if (f.kind === 'target') {
          return (
            <Field label={f.label} key={f.key}>
              <Select value={val} onChange={(e) => onChange(f.key, e.target.value)}>
                {USER_TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                <option value="">Specific user id…</option>
              </Select>
            </Field>
          );
        }
        if (f.kind === 'textarea') {
          return <Field label={f.label} key={f.key}><Textarea value={val} onChange={(e) => onChange(f.key, e.target.value)} /></Field>;
        }
        if (f.kind === 'field') {
          return <Field label={f.label} key={f.key}><Input list="au-fields" value={val} onChange={(e) => onChange(f.key, e.target.value)} /></Field>;
        }
        return <Field label={f.label} key={f.key}><Input value={val} onChange={(e) => onChange(f.key, e.target.value)} /></Field>;
      })}
    </div>
  );
}
