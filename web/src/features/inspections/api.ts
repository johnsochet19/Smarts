import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { CreateInspectionInput, Inspection, InspectionItem, InspectionStatus, InspectionTemplate } from './types';

export const inspectionsApi = {
  list: (projectId: number) => api.get<Inspection[]>(`/projects/${projectId}/inspections`),
  templates: (projectId: number) => api.get<InspectionTemplate[]>(`/projects/${projectId}/inspections/templates`),
  create: (projectId: number, input: CreateInspectionInput) => api.post<Inspection>(`/projects/${projectId}/inspections`, input),
  get: (inspId: number) => api.get<Inspection>(`/project-inspections/${inspId}`),
  setStatus: (inspId: number, status: InspectionStatus) => api.put<Inspection>(`/project-inspections/${inspId}/status`, { status }),
  updateItem: (inspId: number, itemId: number, patch: Partial<InspectionItem>) =>
    api.put<InspectionItem>(`/project-inspections/${inspId}/items/${itemId}`, patch),
  remove: (inspId: number) => api.del(`/project-inspections/${inspId}`),
};

export function useInspections(projectId: number | null) {
  const [items, setItems] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const rows = await inspectionsApi.list(projectId);
      setItems(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inspections');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  const upsert = useCallback((insp: Inspection) => {
    setItems((prev) => {
      const i = prev.findIndex((x) => x.id === insp.id);
      if (i === -1) return [insp, ...prev];
      const next = prev.slice(); next[i] = { ...next[i], ...insp }; return next;
    });
  }, []);
  const removeLocal = useCallback((id: number) => setItems((p) => p.filter((x) => x.id !== id)), []);

  return { items, loading, error, reload, upsert, removeLocal };
}
