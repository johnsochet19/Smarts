import { api } from '@/lib/api';

export interface TimesheetEntry {
  id: number;
  project_id: number;
  employee_id?: number | null;
  employee_name?: string | null;
  date: string;
  time_in?: string | null;
  time_out?: string | null;
  hours?: number | string | null;
  cost_type?: string | null;
  location?: string | null;
  description?: string | null;
  status?: string | null;
}

export interface TimesheetInput {
  date: string;
  employee_id?: number | null;
  time_in?: string;
  time_out?: string;
  hours?: number;
  cost_type?: string;
  location?: string;
  description?: string;
  status?: string;
}

export const timesheetsApi = {
  list: (projectId: number) => api.get<TimesheetEntry[]>(`/projects/${projectId}/timesheets`),
  create: (projectId: number, body: TimesheetInput) => api.post<TimesheetEntry>(`/projects/${projectId}/timesheets`, body),
  update: (projectId: number, id: number, body: Partial<TimesheetInput>) => api.put<TimesheetEntry>(`/projects/${projectId}/timesheets/${id}`, body),
  remove: (projectId: number, id: number) => api.del(`/projects/${projectId}/timesheets/${id}`),
};

export const TS_STATUSES = [
  { value: 'draft', label: 'Draft', color: 'var(--slate-500)' },
  { value: 'submitted', label: 'Submitted', color: 'var(--blue-500)' },
  { value: 'approved', label: 'Approved', color: 'var(--green-500)' },
  { value: 'rejected', label: 'Rejected', color: 'var(--red-500)' },
];
export const TS_COST_TYPES = [
  { value: 'labor', label: 'Labor' },
  { value: 'material', label: 'Material' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'other', label: 'Other' },
];

export function hoursNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
