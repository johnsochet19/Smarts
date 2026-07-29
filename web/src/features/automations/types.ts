export type TriggerType =
  | 'task_created' | 'task_updated' | 'status_changed'
  | 'date_reached' | 'form_submitted' | 'punch_created';

export type ConditionOp =
  | 'equals' | 'not_equals' | 'contains'
  | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty';

export type ActionType = 'notify' | 'assign' | 'update_field' | 'create_task' | 'send_email';

export interface Trigger {
  type: TriggerType;
  resource?: string;
}
export interface Condition {
  field: string;
  op: ConditionOp;
  value?: string;
}
export interface Action {
  type: ActionType;
  config: Record<string, string>;
}

export interface Automation {
  id: number;
  project_id: number;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
  run_count?: number;
  last_run?: string | null;
  created_at?: string;
}

export interface AutomationRun {
  id: number;
  automation_id: number;
  event_type: string;
  status: string;
  detail: string;
  created_at: string;
}

export type AutomationDraft = Omit<Automation, 'id' | 'project_id' | 'run_count' | 'last_run' | 'created_at'>;
