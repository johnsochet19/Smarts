import { api } from '@/lib/api';
import type { AppNotification } from './types';

export const notificationsApi = {
  list: (opts: { read?: boolean; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.read !== undefined) q.set('read', String(opts.read));
    q.set('limit', String(opts.limit ?? 50));
    return api.get<AppNotification[]>(`/notifications?${q.toString()}`);
  },
  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
  markRead: (id: number) => api.put(`/notifications/${id}/read`, {}),
  markAllRead: () => api.put('/notifications/read-all', {}),
  remove: (id: number) => api.del(`/notifications/${id}`),
  clearRead: () => api.del('/notifications'),
};

import type { IconName } from '@/components/ui/Icon';

// Map a notification type to an icon + accent color.
export function notificationVisual(type: string): { icon: IconName; color: string } {
  if (type.includes('overdue') || type.includes('incident') || type.includes('deficient')) return { icon: 'alert', color: 'var(--red-500)' };
  if (type.includes('due') || type.includes('expiring')) return { icon: 'clock', color: 'var(--amber-500)' };
  if (type.includes('assigned') || type.includes('ball_in_court')) return { icon: 'user', color: 'var(--blue-500)' };
  if (type.includes('approved') || type.includes('status')) return { icon: 'check', color: 'var(--green-500)' };
  if (type.includes('mention') || type.includes('comment')) return { icon: 'bell', color: 'var(--violet-500)' };
  if (type === 'automation') return { icon: 'zap', color: 'var(--violet-500)' };
  return { icon: 'bell', color: 'var(--text-muted)' };
}

// Best-effort map of legacy notification links to new-app routes.
const LINK_MAP: Record<string, string> = {
  '/punch-list': '/punchlist',
  '/tasks': '/schedule',
  '/schedule': '/schedule',
};
export function resolveLink(link?: string | null): string | null {
  if (!link || !link.startsWith('/')) return null;
  if (LINK_MAP[link]) return LINK_MAP[link];
  // Only navigate to routes the new app actually serves.
  const known = ['/', '/punchlist', '/sheets', '/schedule', '/automations', '/forms'];
  return known.includes(link) ? link : null;
}
