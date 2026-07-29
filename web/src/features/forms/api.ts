import { api } from '@/lib/api';
import type { Form, FormSubmission, PublicForm } from './types';

export const formsApi = {
  list: (projectId: number) => api.get<Form[]>(`/projects/${projectId}/forms`),
  create: (projectId: number, body: Partial<Form>) => api.post<Form>(`/projects/${projectId}/forms`, body),
  update: (formId: number, patch: Partial<Form>) => api.put<Form>(`/forms/${formId}`, patch),
  remove: (formId: number) => api.del(`/forms/${formId}`),
  submissions: (formId: number) => api.get<FormSubmission[]>(`/forms/${formId}/submissions`),

  // Public (works without auth token).
  getPublic: (token: string) => api.get<PublicForm>(`/forms/public/${token}`),
  submit: (token: string, data: Record<string, unknown>) =>
    api.post<{ ok: boolean; submission_id: number; created: { type: string; id: number } | null }>(`/forms/public/${token}/submit`, { data }),
};

export function publicFormUrl(token: string): string {
  return `${window.location.origin}/f/${token}`;
}
