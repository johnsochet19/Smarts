import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Button, EmptyState, Spinner } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/overlays';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { notificationsApi, notificationVisual, resolveLink } from './api';
import { isUnread, type AppNotification } from './types';
import { useNotifications } from './context';
import { timeAgo } from './time';
import './notifications.css';

type Filter = 'all' | 'unread';

export function NotificationsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { refresh, markRead, markAllRead } = useNotifications();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    notificationsApi.list({ limit: 100, read: filter === 'unread' ? false : undefined })
      .then((rows) => setItems(Array.isArray(rows) ? rows : []))
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [filter, toast]);

  useEffect(() => { load(); }, [load]);

  function open(n: AppNotification) {
    if (isUnread(n)) { markRead(n.id); setItems((l) => l.map((x) => (x.id === n.id ? { ...x, read: true } : x))); }
    const dest = resolveLink(n.link);
    if (dest) navigate(dest);
  }

  async function remove(n: AppNotification, e: React.MouseEvent) {
    e.stopPropagation();
    setItems((l) => l.filter((x) => x.id !== n.id));
    if (isUnread(n)) refresh();
    try { await notificationsApi.remove(n.id); } catch { load(); }
  }

  async function clearRead() {
    try { await notificationsApi.clearRead(); toast.success('Cleared read notifications'); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Clear failed'); }
  }

  const actions = (
    <>
      <Button variant="ghost" onClick={() => { markAllRead(); setItems((l) => l.map((x) => ({ ...x, read: true }))); }}>Mark all read</Button>
      <Button variant="secondary" icon="trash" onClick={clearRead}>Clear read</Button>
    </>
  );

  return (
    <AppShell title="Notifications" actions={actions}>
      <div className="nt-page">
        <div className="nt-toolbar">
          <SegmentedControl value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} />
        </div>

        {loading ? (
          <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading…</div>
        ) : items.length === 0 ? (
          <EmptyState icon="bell" title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} hint="Assignments, status changes, mentions and automation alerts will appear here." />
        ) : (
          <div className="bf-card" style={{ overflow: 'hidden' }}>
            {items.map((n) => {
              const v = notificationVisual(n.type);
              return (
                <div key={n.id} className={`nt-item${isUnread(n) ? ' nt-item--unread' : ''}`} onClick={() => open(n)}>
                  <span className="nt-item__icon" style={{ color: v.color }}><Icon name={v.icon} size={16} /></span>
                  <div className="nt-item__body">
                    <div className="nt-item__title">{n.title || n.message}</div>
                    {n.title && n.message && <div className="nt-item__msg">{n.message}</div>}
                    <div className="nt-item__time">{timeAgo(n.sent_at || n.created_at)}{n.project_name ? ` · ${n.project_name}` : ''}</div>
                  </div>
                  {isUnread(n) && <span className="nt-item__dot" />}
                  <button className="bf-btn bf-btn--ghost bf-btn--sm bf-btn--icon" onClick={(e) => remove(n, e)} aria-label="Delete"><Icon name="close" size={14} /></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
