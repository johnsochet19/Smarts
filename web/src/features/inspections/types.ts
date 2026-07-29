export type InspectionStatus = 'pending' | 'in_progress' | 'deficient' | 'passed' | 'closed';
export type ItemType = 'yes_no' | 'text' | 'multiple_choice' | 'number' | 'photo_required' | 'signature';

export interface InspectionItem {
  id: number;
  inspection_id: number;
  description: string;
  item_type: ItemType;
  options?: unknown;
  order?: number;
  section?: string | null;
  response?: string | null;
  deficient?: boolean;
  deficiency_notes?: string | null;
  requires_correction?: boolean;
  corrected_at?: string | null;
  photo_url?: string | null;
}

export interface Inspection {
  id: number;
  project_id: number;
  template_id?: number | null;
  title: string;
  description?: string | null;
  type?: string | null;
  status: InspectionStatus;
  inspector_id?: number | null;
  inspector_name?: string | null;
  trade?: string | null;
  location?: string | null;
  scheduled_date?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_by_name?: string | null;
  items?: InspectionItem[];
  deficiency_count?: number;
}

export interface InspectionTemplate {
  id: number;
  name: string;
  description?: string | null;
  trade?: string | null;
  items?: Array<{ id: number; description: string; item_type: ItemType; section?: string | null }>;
}

export interface CreateInspectionInput {
  title: string;
  type?: string;
  trade?: string;
  location?: string;
  scheduled_date?: string | null;
  inspector_id?: number | null;
  template_id?: number | null;
}
