import { api } from '@/lib/api';

export interface DocFile {
  id: number;
  project_id: number;
  name: string;
  file_url?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  version_number?: number | null;
  description?: string | null;
  uploaded_at?: string;
  uploaded_by_name?: string | null;
  versions?: DocFile[];
}

export const filesApi = {
  list: (projectId: number) => api.get<DocFile[]>(`/projects/${projectId}/documents`),
  get: (projectId: number, docId: number) => api.get<DocFile>(`/projects/${projectId}/documents/${docId}`),
  create: (projectId: number, body: Partial<DocFile>) => api.post<DocFile>(`/projects/${projectId}/documents`, body),
  addVersion: (docId: number, body: Partial<DocFile>) => api.post<DocFile>(`/documents/${docId}/version`, body),
  remove: (projectId: number, docId: number) => api.del(`/projects/${projectId}/documents/${docId}`),
};

export function formatBytes(n?: number | null): string {
  const b = Number(n || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function isImage(type?: string | null): boolean {
  return !!type && type.startsWith('image/');
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
