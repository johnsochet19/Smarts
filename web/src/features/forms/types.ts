export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'email';

export interface FormFieldOption { value: string; label: string }

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  hidden?: boolean;
  options?: FormFieldOption[];
  /** Conditional visibility: show only when another field equals a value. */
  visibleIf?: { field: string; value: string };
}

export type TargetResource = 'none' | 'punch_item' | 'task';

export interface Form {
  id: number;
  project_id: number;
  name: string;
  description?: string | null;
  token: string;
  enabled: boolean;
  is_public: boolean;
  target_resource: TargetResource;
  fields: FormField[];
  submission_count?: number;
  created_at?: string;
}

export interface PublicForm {
  token: string;
  name: string;
  description?: string | null;
  fields: FormField[];
  enabled: boolean;
  target_resource: TargetResource;
}

export interface FormSubmission {
  id: number;
  form_id: number;
  data: Record<string, unknown>;
  created_record_type?: string | null;
  created_record_id?: number | null;
  created_at: string;
}

export type FormValues = Record<string, string | boolean>;
