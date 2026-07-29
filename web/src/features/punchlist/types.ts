import type { PunchPriority, PunchStatus, PunchType } from './constants';

export interface PunchPhoto {
  id: number;
  punch_item_id: number;
  photo_url: string;
  caption?: string | null;
  media_type?: 'photo' | 'voice' | null;
  taken_at?: string | null;
  uploaded_by?: number | null;
}

export interface PunchItem {
  id: number;
  project_id: number;
  punch_number?: number | null;
  title: string;
  description?: string | null;
  type: PunchType;
  status: PunchStatus;
  priority: PunchPriority;
  assignee_id?: number | null;
  assignee_name?: string | null;
  trade?: string | null;
  location?: string | null;
  due_date?: string | null;
  closed_date?: string | null;
  gps_lat?: number | string | null;
  gps_lng?: number | string | null;
  cost_impact?: boolean;
  cost_amount?: number | string | null;
  created_by?: number | null;
  created_at?: string;
  updated_at?: string;
  photos?: PunchPhoto[];
}

export interface CreatePunchInput {
  title: string;
  description?: string;
  type?: PunchType;
  priority?: PunchPriority;
  assignee_id?: number | null;
  trade?: string;
  location?: string;
  due_date?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
}
