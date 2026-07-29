import { api } from '@/lib/api';
import type { Automation, AutomationDraft, AutomationRun } from './types';

export const automationsApi = {
  list: (projectId: number) => api.get<Automation[]>(`/projects/${projectId}/automations`),
  create: (projectId: number, draft: AutomationDraft) => api.post<Automation>(`/projects/${projectId}/automations`, draft),
  update: (autoId: number, patch: Partial<AutomationDraft>) => api.put<Automation>(`/automations/${autoId}`, patch),
  remove: (autoId: number) => api.del(`/automations/${autoId}`),
  runs: (autoId: number) => api.get<AutomationRun[]>(`/automations/${autoId}/runs`),
  test: (autoId: number, event: { type: string; resource?: string }, record: Record<string, unknown>) =>
    api.post<{ fire: boolean; plannedActions: Array<{ type: string; config: Record<string, string> }> }>(`/automations/${autoId}/test`, { event, record }),
};
