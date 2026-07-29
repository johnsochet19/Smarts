import { api } from '@/lib/api';

export interface BudgetItem {
  id: number;
  project_id: number;
  category?: string | null;
  description?: string | null;
  vendor?: string | null;
  estimated?: number | string | null;
  actual?: number | string | null;
  status?: string | null;
  notes?: string | null;
  sort_order?: number | null;
}

export interface BudgetInput {
  category?: string;
  description?: string;
  vendor?: string;
  estimated?: number;
  actual?: number;
  status?: string;
  notes?: string;
}

export const budgetApi = {
  list: (projectId: number) => api.get<BudgetItem[]>(`/budget/${projectId}`),
  create: (projectId: number, body: BudgetInput) => api.post<BudgetItem>(`/budget/${projectId}`, body),
  update: (projectId: number, id: number, body: BudgetInput) => api.put<BudgetItem>(`/budget/${projectId}/${id}`, body),
  remove: (projectId: number, id: number) => api.del(`/budget/${projectId}/${id}`),
};

export const BUDGET_STATUSES = [
  { value: 'pending', label: 'Pending', color: 'var(--slate-500)' },
  { value: 'approved', label: 'Approved', color: 'var(--blue-500)' },
  { value: 'invoiced', label: 'Invoiced', color: 'var(--amber-500)' },
  { value: 'paid', label: 'Paid', color: 'var(--green-500)' },
  { value: 'over_budget', label: 'Over budget', color: 'var(--red-500)' },
];

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
export function money(v: unknown): string {
  return `$${num(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
