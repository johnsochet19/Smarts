import { useRef, useState } from 'react';
import { Drawer } from '@/components/ui/overlays';
import { Avatar, Badge, Button } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { formatDate, titleCase } from '@/lib/format';
import { PRIORITY_META, STATUS_META, STATUS_TRANSITIONS } from './constants';
import type { PunchStatus } from './constants';
import { punchApi } from './api';
import type { PunchItem, PunchPhoto } from './types';

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

export function PunchDrawer({
  item, onClose, onChanged, onDeleted,
}: {
  item: PunchItem;
  onClose: () => void;
  onChanged: (item: PunchItem) => void;
  onDeleted: (id: number) => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<PunchPhoto[]>(item.photos ?? []);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const meta = STATUS_META[item.status];
  const transitions = STATUS_TRANSITIONS[item.status];
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  async function move(to: PunchStatus) {
    setBusy(true);
    try {
      const updated = await punchApi.setStatus(item.id, to);
      onChanged(updated);
      toast.success(`Moved to ${STATUS_META[to].label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Status change failed');
    } finally {
      setBusy(false);
    }
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const url = await fileToDataUrl(file);
      const photo = await punchApi.addPhoto(item.id, { photo_url: url, media_type: 'photo', taken_at: new Date().toISOString() });
      setPhotos((p) => [...p, photo]);
      toast.success('Photo added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) return toast.error('Microphone not available');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => ev.data.size && chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          const url = await fileToDataUrl(blob);
          const photo = await punchApi.addPhoto(item.id, { photo_url: url, media_type: 'voice', caption: 'Voice note', taken_at: new Date().toISOString() });
          setPhotos((p) => [...p, photo]);
          toast.success('Voice note added');
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Could not save voice note');
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      toast.error('Microphone permission denied');
    }
  }

  async function removePhoto(p: PunchPhoto) {
    try {
      await punchApi.removePhoto(item.id, p.id);
      setPhotos((arr) => arr.filter((x) => x.id !== p.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function deleteItem() {
    if (!confirm(`Delete punch item #${item.punch_number ?? item.id}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await punchApi.remove(item.id);
      toast.success('Punch item deleted');
      onDeleted(item.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  const imagePhotos = photos.filter((p) => (p.media_type ?? 'photo') === 'photo');
  const voiceNotes = photos.filter((p) => p.media_type === 'voice');

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <div className="bf-row bf-gap-3">
          <span className="bf-mono bf-subtle">#{item.punch_number ?? item.id}</span>
          <Badge color={meta.color} dot>{meta.label}</Badge>
        </div>
      }
      footer={
        <>
          {isAdmin && <Button variant="danger" icon="trash" onClick={deleteItem} disabled={busy}>Delete</Button>}
          <span className="bf-spacer" />
          {transitions.map((to) => (
            <Button key={to} variant="primary" icon="arrowRight" onClick={() => move(to)} disabled={busy}>
              {STATUS_META[to].label}
            </Button>
          ))}
          {transitions.length === 0 && <span className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>No further actions</span>}
        </>
      }
    >
      <div className="pl-detail">
        <div className="pl-detail__title">{item.title}</div>
        {item.description && <p className="bf-muted">{item.description}</p>}

        <div className="pl-detail__grid">
          <div className="pl-detail__kv"><span className="k">Priority</span>
            <span><Badge color={PRIORITY_META[item.priority].color} solid={item.priority === 'high'} dot={item.priority !== 'high'}>{PRIORITY_META[item.priority].label}</Badge></span>
          </div>
          <div className="pl-detail__kv"><span className="k">Type</span><span>{titleCase(item.type)}</span></div>
          <div className="pl-detail__kv"><span className="k">Assignee</span>
            <span className="bf-row bf-gap-2">{item.assignee_name ? <><Avatar name={item.assignee_name} size={22} /> {item.assignee_name}</> : <span className="bf-subtle">Unassigned</span>}</span>
          </div>
          <div className="pl-detail__kv"><span className="k">Trade</span><span>{item.trade ? titleCase(item.trade) : '—'}</span></div>
          <div className="pl-detail__kv"><span className="k">Location</span><span>{item.location || '—'}</span></div>
          <div className="pl-detail__kv"><span className="k">Due</span><span>{item.due_date ? formatDate(item.due_date) : '—'}</span></div>
          {(item.gps_lat != null && item.gps_lng != null) && (
            <div className="pl-detail__kv"><span className="k">GPS</span>
              <span className="bf-mono" style={{ fontSize: 'var(--text-xs)' }}>{Number(item.gps_lat).toFixed(5)}, {Number(item.gps_lng).toFixed(5)}</span>
            </div>
          )}
        </div>

        {/* Field capture */}
        <div>
          <div className="bf-label" style={{ marginBottom: 'var(--space-2)' }}>Photos & voice notes</div>
          <div className="pl-capture">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPickPhoto} />
            <Button variant="secondary" size="sm" icon="camera" onClick={() => fileRef.current?.click()} disabled={busy}>Add photo</Button>
            <Button variant={recording ? 'danger' : 'secondary'} size="sm" icon={recording ? 'stop' : 'mic'} onClick={toggleRecording} disabled={busy}>
              {recording ? 'Stop recording' : 'Voice note'}
            </Button>
            {recording && <span className="bf-row bf-gap-2 bf-subtle" style={{ fontSize: 'var(--text-xs)' }}><span className="pl-rec-dot" /> recording…</span>}
          </div>

          {imagePhotos.length > 0 && (
            <div className="pl-photos" style={{ marginTop: 'var(--space-3)' }}>
              {imagePhotos.map((p) => (
                <div key={p.id} className="pl-photo">
                  <img src={p.photo_url} alt={p.caption ?? 'Punch photo'} />
                  <button className="pl-photo__del" onClick={() => removePhoto(p)} aria-label="Delete photo"><Icon name="close" size={13} /></button>
                </div>
              ))}
            </div>
          )}

          {voiceNotes.length > 0 && (
            <div className="bf-col bf-gap-2" style={{ marginTop: 'var(--space-3)' }}>
              {voiceNotes.map((p) => (
                <div key={p.id} className="bf-row bf-gap-3" style={{ padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                  <Icon name="mic" size={16} />
                  <audio controls src={p.photo_url} style={{ height: 32, flex: 1 }} />
                  <button className="bf-btn bf-btn--ghost bf-btn--sm bf-btn--icon" onClick={() => removePhoto(p)} aria-label="Delete voice note"><Icon name="trash" size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
