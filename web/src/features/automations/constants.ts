import type { ActionType, ConditionOp, TriggerType } from './types';

// `wired` marks triggers that already fire from live backend events today.
export const TRIGGERS: Array<{ value: TriggerType; label: string; wired: boolean; resource?: string }> = [
  { value: 'status_changed', label: 'Status changed', wired: true, resource: 'punch_item' },
  { value: 'task_created', label: 'Task created', wired: true, resource: 'task' },
  { value: 'task_updated', label: 'Task updated', wired: false, resource: 'task' },
  { value: 'punch_created', label: 'Punch item created', wired: false, resource: 'punch_item' },
  { value: 'form_submitted', label: 'Form submitted', wired: true },
  { value: 'date_reached', label: 'Date reached', wired: false },
];

export const RESOURCES = [
  { value: '', label: 'Any record' },
  { value: 'punch_item', label: 'Punch item' },
  { value: 'task', label: 'Task' },
];

export const OPERATORS: Array<{ value: ConditionOp; label: string; unary?: boolean }> = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'less_than', label: 'less than' },
  { value: 'is_empty', label: 'is empty', unary: true },
  { value: 'is_not_empty', label: 'is not empty', unary: true },
];

export const COMMON_FIELDS = ['status', 'priority', 'trade', 'location', 'assignee_id', 'due_date', 'percent_complete', 'type'];

export const ACTIONS: Array<{ value: ActionType; label: string; note?: string }> = [
  { value: 'notify', label: 'Send in-app notification' },
  { value: 'assign', label: 'Assign a user' },
  { value: 'update_field', label: 'Update a field' },
  { value: 'create_task', label: 'Create a task' },
  { value: 'send_email', label: 'Send email', note: 'Stub — needs an SMTP provider configured' },
];

export const USER_TARGETS = [
  { value: 'assignee', label: 'The assignee' },
  { value: 'creator', label: 'The creator' },
  { value: 'owner', label: 'Automation owner' },
];

// Fields each action type exposes in the builder.
export const ACTION_FIELDS: Record<ActionType, Array<{ key: string; label: string; kind: 'text' | 'textarea' | 'target' | 'field' }>> = {
  notify: [
    { key: 'to', label: 'Notify', kind: 'target' },
    { key: 'title', label: 'Title', kind: 'text' },
    { key: 'message', label: 'Message', kind: 'textarea' },
  ],
  assign: [{ key: 'to', label: 'Assign to', kind: 'target' }],
  update_field: [
    { key: 'field', label: 'Field', kind: 'field' },
    { key: 'value', label: 'New value', kind: 'text' },
  ],
  create_task: [
    { key: 'title', label: 'Task title', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'text' },
  ],
  send_email: [
    { key: 'to', label: 'To', kind: 'target' },
    { key: 'subject', label: 'Subject', kind: 'text' },
    { key: 'message', label: 'Message', kind: 'textarea' },
  ],
};
