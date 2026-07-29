import { api } from '@/lib/api';
import type { CellValue, ColumnOptions, ColumnType, FullSheet, SheetColumn, SheetMeta, SheetRow } from './types';

export const sheetsApi = {
  list: (projectId: number) => api.get<SheetMeta[]>(`/projects/${projectId}/sheets`),
  create: (projectId: number, name: string) => api.post<FullSheet>(`/projects/${projectId}/sheets`, { name }),
  get: (sheetId: number) => api.get<FullSheet>(`/sheets/${sheetId}`),
  rename: (sheetId: number, name: string) => api.put<SheetMeta>(`/sheets/${sheetId}`, { name }),
  remove: (sheetId: number) => api.del(`/sheets/${sheetId}`),

  addColumn: (sheetId: number, body: { name: string; type: ColumnType; options?: ColumnOptions; position?: number }) =>
    api.post<SheetColumn>(`/sheets/${sheetId}/columns`, body),
  updateColumn: (sheetId: number, colId: number, patch: Partial<Pick<SheetColumn, 'name' | 'type' | 'width' | 'hidden' | 'locked' | 'position'>> & { options?: ColumnOptions }) =>
    api.put<SheetColumn>(`/sheets/${sheetId}/columns/${colId}`, patch),
  removeColumn: (sheetId: number, colId: number) => api.del(`/sheets/${sheetId}/columns/${colId}`),

  addRow: (sheetId: number, body: { parent_id?: number | null; position?: number; cells?: Record<string, CellValue> }) =>
    api.post<SheetRow>(`/sheets/${sheetId}/rows`, body),
  updateRow: (sheetId: number, rowId: number, patch: { cells?: Record<string, CellValue>; parent_id?: number | null; position?: number; locked?: boolean }) =>
    api.put<SheetRow>(`/sheets/${sheetId}/rows/${rowId}`, patch),
  duplicateRow: (sheetId: number, rowId: number) => api.post<SheetRow>(`/sheets/${sheetId}/rows/${rowId}/duplicate`, {}),
  removeRow: (sheetId: number, rowId: number) => api.del(`/sheets/${sheetId}/rows/${rowId}`),
};
