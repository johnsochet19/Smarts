import { api } from '@/lib/api';
import type { Dependency, Task, TaskPatch } from './types';

export const scheduleApi = {
  listTasks: (projectId: number) => api.get<Task[]>(`/projects/${projectId}/tasks`),
  updateTask: (projectId: number, taskId: number, patch: TaskPatch) =>
    api.put<Task>(`/projects/${projectId}/tasks/${taskId}`, patch),
  createTask: (projectId: number, body: { title: string; start_date?: string; finish_date?: string; status?: string }) =>
    api.post<Task>(`/projects/${projectId}/tasks`, body),

  // Dependencies are a global collection in the backend; filter client-side by task set.
  listDependencies: () => api.get<Dependency[]>('/dependencies'),
  addDependency: (task_id: number, depends_on_id: number) =>
    api.post<Dependency>('/dependencies', { task_id, depends_on_id }),
  removeDependency: (id: number) => api.del(`/dependencies/${id}`),
};
