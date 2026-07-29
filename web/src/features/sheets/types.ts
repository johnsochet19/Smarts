export type ColumnType =
  | 'text' | 'number' | 'currency' | 'percent' | 'dropdown' | 'multi_select'
  | 'status' | 'priority' | 'date' | 'time' | 'checkbox' | 'contact'
  | 'formula' | 'auto_number';

export interface Choice {
  value: string;
  label: string;
  color?: string;
}

export interface ColumnOptions {
  choices?: Choice[];
  formula?: string;
  currencySymbol?: string;
  precision?: number;
}

export interface SheetColumn {
  id: number;
  sheet_id: number;
  name: string;
  type: ColumnType;
  position: number;
  width: number;
  options: ColumnOptions;
  is_primary?: boolean;
  hidden?: boolean;
  locked?: boolean;
}

export type CellValue = string | number | boolean | null;

export interface SheetRow {
  id: number;
  sheet_id: number;
  parent_id: number | null;
  position: number;
  cells: Record<string, CellValue>;
  locked?: boolean;
}

export interface SheetMeta {
  id: number;
  project_id: number;
  name: string;
  description?: string | null;
  row_count?: number;
  updated_at?: string;
}

export interface FullSheet {
  sheet: SheetMeta;
  columns: SheetColumn[];
  rows: SheetRow[];
}
