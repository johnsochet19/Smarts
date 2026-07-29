import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { CreatePunchInput, PunchComment, PunchItem, PunchPhoto } from './types';
import type { PunchStatus } from './constants';

const base = (projectId: number) => `/projects/${projectId}/punch-items`;

export const punchApi = {
  list: (projectId: number) => api.get<PunchItem[]>(base(projectId)),
  create: (projectId: number, input: CreatePunchInput) => api.post<PunchItem>(base(projectId), input),
  update: (id: number, patch: Partial<CreatePunchInput>) => api.put<PunchItem>(`/punch-items/${id}`, patch),
  setStatus: (id: number, status: PunchStatus) => api.put<PunchItem>(`/punch-items/${id}/status`, { status }),
  remove: (id: number) => api.del(`/punch-items/${id}`),
  addPhoto: (id: number, body: { photo_url: string; caption?: string; media_type?: 'photo' | 'voice'; taken_at?: string }) =>
    api.post<PunchPhoto>(`/punch-items/${id}/photos`, body),
  removePhoto: (id: number, photoId: number) => api.del(`/punch-items/${id}/photos/${photoId}`),
  listComments: (id: number) => api.get<PunchComment[]>(`/punch-items/${id}/comments`),
  addComment: (id: number, comment: string) => api.post<PunchComment>(`/punch-items/${id}/comments`, { comment }),
  removeComment: (id: number, commentId: number) => api.del(`/punch-items/${id}/comments/${commentId}`),
};

/** Loads + caches punch items for a project, with optimistic helpers. */
export function usePunchItems(projectId: number | null) {
  const [items, setItems] = useState<PunchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await punchApi.list(projectId);
      setItems(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load punch items');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const upsert = useCallback((item: PunchItem) => {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === item.id);
      if (idx === -1) return [item, ...prev];
      const next = prev.slice();
      next[idx] = { ...next[idx], ...item };
      return next;
    });
  }, []);

  const removeLocal = useCallback((id: number) => {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { items, loading, error, reload, upsert, removeLocal };
}
