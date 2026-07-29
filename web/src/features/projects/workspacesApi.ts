import { api } from '@/lib/api';

export interface Workspace {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  position: number;
  project_count: number;
}

export const workspacesApi = {
  list: () => api.get<Workspace[]>('/workspaces'),
  create: (input: { name: string; color?: string }) => api.post<Workspace>('/workspaces', input),
  update: (id: number, patch: Partial<{ name: string; color: string; position: number }>) =>
    api.put<Workspace>(`/workspaces/${id}`, patch),
  remove: (id: number) => api.del(`/workspaces/${id}`),
  assignProject: (projectId: number, workspaceId: number | null) =>
    api.put(`/projects/${projectId}`, { workspace_id: workspaceId }),
};
