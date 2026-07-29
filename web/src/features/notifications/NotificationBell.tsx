import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Spinner } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { notificationsApi, notificationVisual, resolveLink } from './api';
import { isUnread, type AppNotification } from './types';
import { useNotifications } from './context';
import { timeAgo } from './time';
import './notifications.css';

export function NotificationBell() {
  const { unread, refresh, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setItems(null);
    notificationsApi.list({ limit: 12 }).then(setItems).catch(() => setItems([]));
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  function onOpen(n: AppNotification) {
    if (isUnread(n)) { markRead(n.id); setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? null); }
    const dest = resolveLink(n.link);
    setOpen(false);
    if (dest) navigate(dest);
  }

  return (
    <div className="nt-bell" ref={ref}>
      <Button variant="ghost" size="sm" iconOnly icon="bell" aria-label="Notifications" onClick={() => { setOpen((o) => !o); refresh(); }} />
      {unread > 0 && <span className="nt-badge">{unread > 99 ? '99+' : unread}</span>}

      {open && (
        <div className="nt-panel">
          <div className="nt-panel__head">
            <strong style={{ fontSize: 'var(--text-sm)' }}>Notifications</strong>
            <span className="bf-spacer" />
            {unread > 0 && <button className="bf-btn bf-btn--ghost bf-btn--sm" onClick={() => { markAllRead(); setItems((l) => l?.map((x) => ({ ...x, read: true })) ?? null); }}>Mark all read</button>}
          </div>
          <div className="nt-panel__list">
            {items === null ? (
              <div className="bf-row bf-gap-2 bf-muted" style={{ padding: 'var(--space-5)', justifyContent: 'center' }}><Spinner size={16} /> Loading…</div>
            ) : items.length === 0 ? (
              <div className="bf-empty" style={{ padding: 'var(--space-8) var(--space-4)' }}>
                <div className="bf-empty__icon"><Icon name="bell" size={22} /></div>
                <div className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>You're all caught up</div>
              </div>
            ) : (
              items.map((n) => {
                const v = notificationVisual(n.type);
                return (
                  <div key={n.id} className={`nt-item${isUnread(n) ? ' nt-item--unread' : ''}`} onClick={() => onOpen(n)}>
                    <span className="nt-item__icon" style={{ color: v.color }}><Icon name={v.icon} size={16} /></span>
                    <div className="nt-item__body">
                      <div className="nt-item__title bf-truncate">{n.title || n.message}</div>
                      {n.title && n.message && <div className="nt-item__msg">{n.message}</div>}
                      <div className="nt-item__time">{timeAgo(n.sent_at || n.created_at)}{n.project_name ? ` · ${n.project_name}` : ''}</div>
                    </div>
                    {isUnread(n) && <span className="nt-item__dot" />}
                  </div>
                );
              })
            )}
          </div>
          <div className="nt-panel__foot">
            <button className="bf-btn bf-btn--ghost bf-btn--sm bf-btn--block" onClick={() => { setOpen(false); navigate('/notifications'); }}>See all notifications</button>
          </div>
        </div>
      )}
    </div>
  );
}
