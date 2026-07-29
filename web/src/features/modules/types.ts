// Config-driven module engine. Each existing BuildForge resource is described
// once here, then rendered in the new design system by <ResourceModule>.
import type { IconName } from '@/components/ui/Icon';

export type FieldType = 'text' | 'textarea' | 'select' | 'date' | 'number';

export interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export type ColumnKind = 'text' | 'number' | 'date' | 'status' | 'mono';

export interface ColumnConfig {
  key: string;
  label: string;
  kind?: ColumnKind;
  grow?: boolean;
}

export interface ModuleConfig {
  /** Route segment in the new app, e.g. "rfis". */
  slug: string;
  /** Display name. */
  title: string;
  /** Sidebar icon. */
  icon: IconName;
  /** Nav group label. */
  group: string;
  /** Short empty-state hint. */
  hint?: string;

  /** Ported = rendered in the new design via the engine. */
  ported: boolean;

  /** Backend resource path. project-scoped → /projects/:id/<resource>. */
  resource?: string;
  projectScoped?: boolean;

  /** Field used as the primary title in lists/detail. */
  titleKey?: string;
  /** Optional human-readable record number field, e.g. rfi_number. */
  numberKey?: string;
  /** List columns. */
  columns?: ColumnConfig[];
  /** Create-form fields. */
  createFields?: FieldConfig[];
  /** Status value → color (CSS var or hex). */
  statusMap?: Record<string, string>;

  /** For not-yet-ported modules: where it lives in the classic app. */
  classicPath?: string;
}
