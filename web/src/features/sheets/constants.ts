import type { ColumnType } from './types';
import type { IconName } from '@/components/ui/Icon';

export const COLUMN_TYPE_META: Record<ColumnType, { label: string; icon: IconName }> = {
  text: { label: 'Text', icon: 'list' },
  number: { label: 'Number', icon: 'grid' },
  currency: { label: 'Currency', icon: 'grid' },
  percent: { label: 'Percent', icon: 'grid' },
  dropdown: { label: 'Dropdown', icon: 'chevronDown' },
  multi_select: { label: 'Multi-select', icon: 'board' },
  status: { label: 'Status', icon: 'punch' },
  priority: { label: 'Priority', icon: 'alert' },
  date: { label: 'Date', icon: 'calendar' },
  time: { label: 'Time', icon: 'clock' },
  checkbox: { label: 'Checkbox', icon: 'check' },
  contact: { label: 'Contact', icon: 'user' },
  formula: { label: 'Formula', icon: 'grid' },
  auto_number: { label: 'Auto-number', icon: 'grid' },
};

// Types offered in the "change type" menu (auto_number/formula included).
export const SELECTABLE_TYPES: ColumnType[] = [
  'text', 'number', 'currency', 'percent', 'checkbox', 'date', 'time',
  'dropdown', 'status', 'priority', 'contact', 'formula', 'auto_number',
];

export const DEFAULT_STATUS_CHOICES = [
  { value: 'open', label: 'Open', color: '#3b82f6' },
  { value: 'in_progress', label: 'In Progress', color: '#f59e0b' },
  { value: 'blocked', label: 'Blocked', color: '#ef4444' },
  { value: 'done', label: 'Done', color: '#22c55e' },
];

export const DEFAULT_PRIORITY_CHOICES = [
  { value: 'low', label: 'Low', color: '#64748b' },
  { value: 'normal', label: 'Normal', color: '#3b82f6' },
  { value: 'high', label: 'High', color: '#ef4444' },
];
