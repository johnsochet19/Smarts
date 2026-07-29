import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button, Card, EmptyState, Spinner } from '@/components/ui/primitives';
import { Drawer } from '@/components/ui/overlays';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { useProjects } from '@/lib/projects';
import { formatDate } from '@/lib/format';
import { filesApi, formatBytes, isImage, readAsDataUrl, type DocFile } from './api';
import './files.css';

export function FilesPage() {
  const { activeId } = useProjects();
  const toast = useToast();
  const [docs, setDocs] = useState<DocFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<DocFile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activeId) { setLoading(false); return; }
    setLoading(true);
    filesApi.list(activeId).then((rows) => setDocs(Array.isArray(rows) ? rows : []))
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load files'))
      .finally(() => setLoading(false));
  }, [activeId, toast]);

  // Show only the latest version per name; keep a count.
  const latest = useMemo(() => {
    const byName = new Map<string, DocFile[]>();
    for (const d of docs) { const a = byName.get(d.name) ?? []; a.push(d); byName.set(d.name, a); }
    return [...byName.values()].map((group) => {
      const sorted = group.sort((a, b) => (b.version_number ?? 1) - (a.version_number ?? 1));
      return { ...sorted[0], _versions: group.length };
    }).sort((a, b) => (b.uploaded_at ?? '').localeCompare(a.uploaded_at ?? ''));
  }, [docs]);

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList || !fileList.length || !activeId) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const url = await readAsDataUrl(file);
        const created = await filesApi.create(activeId, { name: file.name, file_url: url, file_size: file.size, file_type: file.type });
        setDocs((d) => [created, ...d]);
      }
      toast.success('Uploaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally { setUploading(false); }
  }

  async function remove(doc: DocFile, e: React.MouseEvent) {
    e.stopPropagation();
    if (!activeId || !confirm(`Delete "${doc.name}"?`)) return;
    setDocs((d) => d.filter((x) => x.id !== doc.id));
    try { await filesApi.remove(activeId, doc.id); } catch (err) { toast.error(err instanceof Error ? err.message : 'Delete failed'); }
  }

  const actions = <Button variant="primary" icon="plus" onClick={() => fileRef.current?.click()} disabled={!activeId || uploading}>{uploading ? 'Uploading…' : 'Upload'}</Button>;

  return (
    <AppShell title="Files" actions={actions}>
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />

      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading…</div>
      ) : !activeId ? (
        <EmptyState icon="list" title="No project selected" hint="Pick a project to manage its files." />
      ) : latest.length === 0 ? (
        <div className={`fl-dropzone${dragOver ? ' fl-dropzone--over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}>
          <Icon name="plus" size={28} />
          <div style={{ marginTop: 'var(--space-2)', fontWeight: 600 }}>Drop files here or click to upload</div>
          <div className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>Photos, PDFs, documents — with version history.</div>
        </div>
      ) : (
        <div className="fl-grid"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}>
          {latest.map((doc) => (
            <Card key={doc.id} className="fl-card" hover onClick={() => setSelected(doc)}>
              <div className="fl-thumb">
                {isImage(doc.file_type) && doc.file_url ? <img src={doc.file_url} alt={doc.name} /> : <Icon name="list" size={30} />}
              </div>
              <div className="fl-body">
                <div className="fl-name" title={doc.name}>{doc.name}</div>
                <div className="fl-meta">
                  <span>{formatBytes(doc.file_size)}</span>
                  {(doc as DocFile & { _versions?: number })._versions! > 1 && <span className="fl-vbadge">v{doc.version_number}</span>}
                  <span className="bf-spacer" />
                  <button className="bf-btn bf-btn--ghost bf-btn--sm bf-btn--icon" onClick={(e) => remove(doc, e)} aria-label="Delete"><Icon name="trash" size={13} /></button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selected && activeId && <FilePreview projectId={activeId} doc={selected} onClose={() => setSelected(null)} onChanged={(d) => setDocs((list) => [d, ...list])} />}
    </AppShell>
  );
}

function FilePreview({ projectId, doc, onClose, onChanged }: { projectId: number; doc: DocFile; onClose: () => void; onChanged: (d: DocFile) => void }) {
  const toast = useToast();
  const [full, setFull] = useState<DocFile | null>(null);
  const verRef = useRef<HTMLInputElement>(null);

  useEffect(() => { filesApi.get(projectId, doc.id).then(setFull).catch(() => setFull(doc)); }, [projectId, doc]);

  async function addVersion(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    try {
      const url = await readAsDataUrl(file);
      const created = await filesApi.addVersion(doc.id, { file_url: url, file_size: file.size, file_type: file.type });
      toast.success(`Version ${created.version_number} uploaded`);
      onChanged(created);
      setFull((f) => (f ? { ...f, versions: [created, ...(f.versions ?? [])], version_number: created.version_number } : f));
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Version upload failed'); }
  }

  const versions = full?.versions ?? [];

  return (
    <Drawer open onClose={onClose} title={<strong className="bf-truncate">{doc.name}</strong>}
      footer={<><input ref={verRef} type="file" hidden onChange={(e) => { addVersion(e.target.files); e.target.value = ''; }} /><span className="bf-spacer" /><Button variant="secondary" icon="plus" onClick={() => verRef.current?.click()}>New version</Button>{doc.file_url && <a href={doc.file_url} download={doc.name}><Button variant="primary" icon="arrowRight">Download</Button></a>}</>}>
      <div className="fl-preview bf-col bf-gap-4">
        {isImage(doc.file_type) && doc.file_url ? <img src={doc.file_url} alt={doc.name} /> : (
          <div className="fl-thumb" style={{ height: 160, borderRadius: 'var(--radius-md)' }}><Icon name="list" size={40} /></div>
        )}
        <div className="bf-col bf-gap-2">
          <div className="bf-row bf-gap-3"><span className="bf-subtle" style={{ width: 90 }}>Type</span><span>{doc.file_type || '—'}</span></div>
          <div className="bf-row bf-gap-3"><span className="bf-subtle" style={{ width: 90 }}>Size</span><span>{formatBytes(doc.file_size)}</span></div>
          <div className="bf-row bf-gap-3"><span className="bf-subtle" style={{ width: 90 }}>Version</span><span>v{doc.version_number ?? 1}</span></div>
          <div className="bf-row bf-gap-3"><span className="bf-subtle" style={{ width: 90 }}>Uploaded</span><span>{formatDate(doc.uploaded_at)}</span></div>
        </div>
        {versions.length > 1 && (
          <div>
            <div className="bf-label" style={{ marginBottom: 'var(--space-2)' }}>Version history</div>
            {versions.map((v) => (
              <div key={v.id} className="fl-version">
                <span className="fl-vbadge">v{v.version_number}</span>
                <span className="bf-spacer" />
                <span className="bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>{formatBytes(v.file_size)} · {formatDate(v.uploaded_at)}</span>
                {v.file_url && <a href={v.file_url} download={doc.name}><Icon name="arrowRight" size={14} /></a>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
