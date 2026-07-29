import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Spinner } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { formsApi } from './api';
import type { PublicForm } from './types';
import { FormRenderer } from './FormRenderer';
import './forms.css';

// Standalone, unauthenticated public form page (route /f/:token).
export function PublicFormPage() {
  const { token = '' } = useParams();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    formsApi.getPublic(token)
      .then(setForm)
      .catch((e) => setError(e instanceof Error ? e.message : 'Form not available'))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(values: Record<string, unknown>) {
    setSubmitting(true);
    try {
      await formsApi.submit(token, values);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fm-public">
      <Card pad className="fm-public__card">
        <div className="fm-public__brand"><span className="bf-brand__mark" style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="punch" size={15} /></span> BuildForge</div>
        {loading ? (
          <div className="bf-row bf-gap-3 bf-muted" style={{ justifyContent: 'center', padding: 'var(--space-8)' }}><Spinner /> Loading…</div>
        ) : done ? (
          <div className="fm-success">
            <div className="fm-success__mark"><Icon name="check" size={26} /></div>
            <h2 style={{ marginBottom: 'var(--space-2)' }}>Thank you</h2>
            <p className="bf-muted">Your response has been submitted.</p>
          </div>
        ) : error ? (
          <div className="fm-success">
            <div className="fm-success__mark" style={{ background: 'color-mix(in srgb, var(--red-500) 15%, transparent)', color: 'var(--red-500)' }}><Icon name="alert" size={26} /></div>
            <h2 style={{ marginBottom: 'var(--space-2)' }}>Unavailable</h2>
            <p className="bf-muted">{error}</p>
          </div>
        ) : form ? (
          <>
            <h1 className="fm-public__title">{form.name}</h1>
            {form.description && <p className="bf-muted" style={{ marginBottom: 'var(--space-5)' }}>{form.description}</p>}
            <FormRenderer fields={form.fields} submitting={submitting} onSubmit={submit} />
          </>
        ) : null}
      </Card>
    </div>
  );
}
