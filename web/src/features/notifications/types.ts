export interface AppNotification {
  id: number;
  user_id: number;
  project_id?: number | null;
  type: string;
  entity_type?: string | null;
  entity_id?: number | null;
  title?: string | null;
  message?: string | null;
  link?: string | null;
  read?: boolean;
  is_read?: boolean;
  sent_at?: string;
  created_at?: string;
  project_name?: string | null;
}

export function isUnread(n: AppNotification): boolean {
  return !(n.read || n.is_read);
}
