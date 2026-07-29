import { useMemo, useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import type { FormField, FormValues } from './types';

/**
 * Renders a form from its field schema and collects values. Handles required
 * validation and conditional visibility (visibleIf). Used by both the public
 * form page and the builder preview.
 */
export function FormRenderer({
  fields, submitting, onSubmit, submitLabel = 'Submit',
}: {
  fields: FormField[];
  submitting?: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const visible = useMemo(
    () => fields.filter((f) => !f.hidden && isVisible(f, values)),
    [fields, values]
  );

  function set(key: string, value: string | boolean) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  }

  function submit() {
    const errs: Record<string, string> = {};
    for (const f of visible) {
      if (f.required) {
        const v = values[f.key];
        if (v === undefined || v === '' || v === false) errs[f.key] = 'Required';
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    // Only include visible fields' values.
    const payload: Record<string, unknown> = {};
    for (const f of visible) if (values[f.key] !== undefined) payload[f.key] = values[f.key];
    onSubmit(payload);
  }

  return (
    <div className="bf-col bf-gap-4">
      {visible.map((f) => (
        <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
          {renderInput(f, values[f.key], (v) => set(f.key, v))}
          {errors[f.key] && <span style={{ color: 'var(--red-500)', fontSize: 'var(--text-xs)' }}>{errors[f.key]}</span>}
        </Field>
      ))}
      <Button variant="primary" size="lg" onClick={submit} disabled={submitting}>
        {submitting ? 'Submitting…' : submitLabel}
      </Button>
    </div>
  );
}

function isVisible(f: FormField, values: FormValues): boolean {
  if (!f.visibleIf) return true;
  return String(values[f.visibleIf.field] ?? '') === String(f.visibleIf.value);
}

function renderInput(f: FormField, value: string | boolean | undefined, onChange: (v: string | boolean) => void) {
  switch (f.type) {
    case 'textarea':
      return <Textarea placeholder={f.placeholder} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <Input type="number" placeholder={f.placeholder} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <Input type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'email':
      return <Input type="email" placeholder={f.placeholder} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return (
        <label className="bf-row bf-gap-2" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {f.placeholder || 'Yes'}
        </label>
      );
    case 'select':
      return (
        <Select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      );
    default:
      return <Input placeholder={f.placeholder} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
}
