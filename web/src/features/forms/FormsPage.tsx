import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button, Card, EmptyState, Spinner } from '@/components/ui/primitives';
import { Drawer } from '@/components/ui/overlays';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { useProjects } from '@/lib/projects';
import { formatDate } from '@/lib/format';
import { formsApi, publicFormUrl } from './api';
import type { Form, FormSubmission } from './types';
import { FormBuilder } from './FormBuilder';
import './forms.css';

export function FormsPage() {
  const { activeId } = useProjects();
  const toast = useToast();
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Form | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Form | null>(null);

  useEffect(() => {
    if (!activeId) { setLoading(false); return; }
    setLoading(true);
    formsApi.list(activeId)
      .then((rows) => setForms(Array.isArray(rows) ? rows : []))
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load forms'))
      .finally(() => setLoading(false));
  }, [activeId, toast]);

  function upsert(f: Form) {
    setForms((list) => {
      const i = list.findIndex((x) => x.id === f.id);
      if (i === -1) return [f, ...list];
      const next = list.slice(); next[i] = f; return next;
    });
  }
  async function toggle(f: Form) {
    upsert({ ...f, enabled: !f.enabled });
    try { await formsApi.update(f.id, { enabled: !f.enabled }); }
    catch (e) { upsert(f); toast.error(e instanceof Error ? e.message : 'Toggle failed'); }
  }
  async function remove(f: Form) {
    if (!confirm(`Delete form "${f.name}"?`)) return;
    setForms((list) => list.filter((x) => x.id !== f.id));
    try { await formsApi.remove(f.id); } catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed'); }
  }
  function copyLink(f: Form) {
    const url = publicFormUrl(f.token);
    navigator.clipboard?.writeText(url).then(() => toast.success('Public link copied'), () => toast.show(url));
  }

  const actions = <Button variant="primary" icon="plus" onClick={() => setCreating(true)} disabled={!activeId}>New form</Button>;

  return (
    <AppShell title="Forms" actions={actions}>
      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading…</div>
      ) : !activeId ? (
        <EmptyState icon="list" title="No project selected" hint="Pick a project to manage its forms." />
      ) : forms.length === 0 ? (
        <EmptyState icon="list" title="No forms yet"
          hint="Build a public or internal form — punchlist submission, issue reporting, service request — that creates records on submit."
          action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New form</Button>} />
      ) : (
        <div className="fm-list">
          {forms.map((f) => (
            <Card key={f.id} pad className="fm-card" hover>
              <div className="fm-card__top">
                <span className="bf-empty__icon" style={{ width: 36, height: 36 }}><Icon name="list" size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="fm-card__name bf-truncate">{f.name}</div>
                  <div className="fm-card__meta">
                    <span>{f.submission_count ?? 0} submissions</span>
                    <span>·</span>
                    <span>{f.enabled ? 'Live' : 'Disabled'}</span>
                  </div>
                </div>
              </div>
              <div className="fm-card__actions">
                <Button variant="secondary" size="sm" icon="arrowRight" onClick={() => copyLink(f)}>Copy link</Button>
                <Button variant="ghost" size="sm" onClick={() => setViewing(f)}>Responses</Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(f)}>Edit</Button>
                <span className="bf-spacer" />
                <Button variant="ghost" size="sm" onClick={() => toggle(f)}>{f.enabled ? 'Disable' : 'Enable'}</Button>
                <Button variant="ghost" size="sm" iconOnly icon="trash" onClick={() => remove(f)} aria-label="Delete" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && activeId && <FormBuilder projectId={activeId} onClose={() => setCreating(false)} onSaved={upsert} />}
      {editing && activeId && <FormBuilder projectId={activeId} existing={editing} onClose={() => setEditing(null)} onSaved={upsert} />}
      {viewing && <SubmissionsDrawer form={viewing} onClose={() => setViewing(null)} />}
    </AppShell>
  );
}

function SubmissionsDrawer({ form, onClose }: { form: Form; onClose: () => void }) {
  const toast = useToast();
  const [subs, setSubs] = useState<FormSubmission[] | null>(null);
  useEffect(() => {
    formsApi.submissions(form.id).then(setSubs).catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load'));
  }, [form.id, toast]);

  const keys = Array.from(new Set((subs ?? []).flatMap((s) => Object.keys(s.data ?? {})))).slice(0, 6);

  return (
    <Drawer open onClose={onClose} title={<strong>{form.name} — responses</strong>}>
      {!subs ? (
        <div className="bf-row bf-gap-3 bf-muted"><Spinner /> Loading…</div>
      ) : subs.length === 0 ? (
        <EmptyState icon="list" title="No submissions yet" hint="Share the public link to start collecting responses." />
      ) : (
        <table className="fm-sub-table">
          <thead><tr><th>When</th>{keys.map((k) => <th key={k}>{k}</th>)}<th>Created</th></tr></thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.id}>
                <td className="bf-subtle">{formatDate(s.created_at)}</td>
                {keys.map((k) => <td key={k} className="bf-truncate" style={{ maxWidth: 160 }}>{String(s.data?.[k] ?? '')}</td>)}
                <td>{s.created_record_type ? `${s.created_record_type} #${s.created_record_id}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Drawer>
  );
}
