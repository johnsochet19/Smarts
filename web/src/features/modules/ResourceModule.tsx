import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button, Card, EmptyState, Field, Input, Select, Spinner, Textarea, Badge } from '@/components/ui/primitives';
import { Modal, Drawer } from '@/components/ui/overlays';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useProjects } from '@/lib/projects';
import { useIsMobile } from '@/lib/hooks';
import { formatDate, titleCase } from '@/lib/format';
import type { FieldConfig, ModuleConfig } from './types';
import './modules.css';

type Row = Record<string, unknown>;

function resourcePath(cfg: ModuleConfig, projectId: number): string {
  return cfg.projectScoped ? `/projects/${projectId}/${cfg.resource}` : `/${cfg.resource}`;
}

// Stable color for an arbitrary status string when not in the config map.
function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 50%)`;
}

function StatusPill({ value, cfg }: { value: string; cfg: ModuleConfig }) {
  if (!value) return <span className="bf-subtle">—</span>;
  const color = cfg.statusMap?.[value] ?? hashColor(value);
  return <Badge color={color} dot>{titleCase(value)}</Badge>;
}

function renderCell(row: Row, key: string, kind: string | undefined, cfg: ModuleConfig) {
  const v = row[key];
  if (kind === 'status') return <StatusPill value={String(v ?? '')} cfg={cfg} />;
  if (v === null || v === undefined || v === '') return <span className="bf-subtle">—</span>;
  if (kind === 'date') return formatDate(String(v));
  if (kind === 'mono') return <span className="bf-mono bf-subtle">#{String(v)}</span>;
  if (kind === 'number') return <span className="bf-mono">{String(v)}</span>;
  return String(v);
}

function CreateForm({ cfg, projectId, onClose, onCreated }: { cfg: ModuleConfig; projectId: number; onClose: () => void; onCreated: (r: Row) => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const fields = cfg.createFields ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.type === 'select' ? f.options?.[0]?.value ?? '' : '']))
  );

  function set(k: string, v: string) {
    setValues((s) => ({ ...s, [k]: v }));
  }

  async function submit() {
    for (const f of fields) {
      if (f.required && !values[f.key]?.trim()) return toast.error(`${f.label} is required`);
    }
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.key];
      if (raw === undefined || raw === '') continue;
      body[f.key] = f.type === 'number' ? Number(raw) : raw;
    }
    setSaving(true);
    try {
      const created = await api.post<Row>(resourcePath(cfg, projectId), body);
      toast.success(`${cfg.title.replace(/s$/, '')} created`);
      onCreated(created);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`New ${cfg.title.replace(/s$/, '').toLowerCase()}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="check" onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
      </>}>
      <div className="bf-col bf-gap-4">
        {fields.map((f: FieldConfig) => (
          <Field key={f.key} label={f.label}>
            {f.type === 'textarea' ? (
              <Textarea value={values[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            ) : f.type === 'select' ? (
              <Select value={values[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : (
              <Input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                value={values[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </Field>
        ))}
      </div>
    </Modal>
  );
}

export function ResourceModule({ cfg }: { cfg: ModuleConfig }) {
  const { activeId, loading: projLoading } = useProjects();
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);

  const load = useCallback(async () => {
    if (!activeId && cfg.projectScoped) {
      setRows([]); setLoading(false); return;
    }
    setLoading(true); setError(null);
    try {
      const data = await api.get<Row[]>(resourcePath(cfg, activeId ?? 0));
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [activeId, cfg]);

  useEffect(() => { load(); }, [load]);

  const columns = cfg.columns ?? (cfg.titleKey ? [{ key: cfg.titleKey, label: cfg.title, grow: true }] : []);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [rows, search]);

  const actions = (
    <Button variant="primary" icon="plus" onClick={() => setCreating(true)} disabled={!activeId && cfg.projectScoped}>
      {isMobile ? '' : `New ${cfg.title.replace(/s$/, '').toLowerCase()}`}
    </Button>
  );

  return (
    <AppShell title={cfg.title} actions={cfg.createFields ? actions : undefined}>
      <div className="bf-toolbar">
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <Icon name="search" size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-subtle)' }} />
          <Input placeholder={`Search ${cfg.title.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <span className="bf-spacer" />
        <span className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {projLoading || loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading {cfg.title.toLowerCase()}…</div>
      ) : !activeId && cfg.projectScoped ? (
        <EmptyState icon={cfg.icon} title="No project selected" hint="Pick a project to view this module." />
      ) : error ? (
        <EmptyState icon="alert" title={`Couldn’t load ${cfg.title.toLowerCase()}`} hint={error} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={cfg.icon} title={`No ${cfg.title.toLowerCase()} yet`} hint={cfg.hint}
          action={cfg.createFields ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Create the first one</Button> : undefined} />
      ) : (
        <Card className="mod-table">
          <div className="mod-thead" style={{ gridTemplateColumns: gridCols(columns) }}>
            {columns.map((c) => <div key={c.key} className="mod-th">{c.label}</div>)}
          </div>
          {filtered.map((row, i) => (
            <div key={String(row.id ?? i)} className="mod-tr" style={{ gridTemplateColumns: gridCols(columns) }} onClick={() => setSelected(row)}>
              {columns.map((c) => <div key={c.key} className="mod-td bf-truncate">{renderCell(row, c.key, c.kind, cfg)}</div>)}
            </div>
          ))}
        </Card>
      )}

      {creating && cfg.createFields && (
        <CreateForm cfg={cfg} projectId={activeId ?? 0} onClose={() => setCreating(false)} onCreated={(r) => setRows((prev) => [r, ...prev])} />
      )}
      {selected && <DetailDrawer cfg={cfg} row={selected} onClose={() => setSelected(null)} />}
    </AppShell>
  );
}

function gridCols(columns: { grow?: boolean }[]): string {
  return columns.map((c) => (c.grow ? 'minmax(160px, 2fr)' : 'minmax(90px, 1fr)')).join(' ');
}

function DetailDrawer({ cfg, row, onClose }: { cfg: ModuleConfig; row: Row; onClose: () => void }) {
  const title = cfg.titleKey ? String(row[cfg.titleKey] ?? cfg.title) : cfg.title;
  const entries = Object.entries(row).filter(([k, v]) =>
    !['id'].includes(k) && typeof v !== 'object' && v !== null && v !== '' && !k.endsWith('_id'));
  return (
    <Drawer open onClose={onClose}
      title={<div className="bf-row bf-gap-3">
        {cfg.numberKey && row[cfg.numberKey] != null && <span className="bf-mono bf-subtle">#{String(row[cfg.numberKey])}</span>}
        {row.status != null && <StatusPill value={String(row.status)} cfg={cfg} />}
      </div>}>
      <div className="pl-detail">
        <div className="pl-detail__title">{cfg.titleKey === 'log_date' ? formatDate(title) : title}</div>
        <div className="pl-detail__grid">
          {entries.map(([k, v]) => (
            <div className="pl-detail__kv" key={k}>
              <span className="k">{titleCase(k)}</span>
              <span>{/_date$|_at$/.test(k) ? formatDate(String(v)) : String(v)}</span>
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  );
}
