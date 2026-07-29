import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { notificationsApi } from './api';

interface NotificationsState {
  unread: number;
  refresh: () => void;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  decrement: (by?: number) => void;
}
const Ctx = createContext<NotificationsState | null>(null);

const POLL_MS = 45000;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    notificationsApi.unreadCount().then((r) => setUnread(r.count ?? 0)).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const decrement = useCallback((by = 1) => setUnread((u) => Math.max(0, u - by)), []);

  const markRead = useCallback(async (id: number) => {
    decrement(1);
    try { await notificationsApi.markRead(id); } catch { refresh(); }
  }, [decrement, refresh]);

  const markAllRead = useCallback(async () => {
    setUnread(0);
    try { await notificationsApi.markAllRead(); } catch { refresh(); }
  }, [refresh]);

  return <Ctx.Provider value={{ unread, refresh, markRead, markAllRead, decrement }}>{children}</Ctx.Provider>;
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
