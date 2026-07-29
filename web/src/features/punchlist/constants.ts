export const PUNCH_STATUSES = ['draft', 'open', 'in_progress', 'ready_for_review', 'closed'] as const;
export type PunchStatus = (typeof PUNCH_STATUSES)[number];

export const PUNCH_TYPES = ['quality', 'safety', 'commissioning', 'warranty', 'general'] as const;
export type PunchType = (typeof PUNCH_TYPES)[number];

export const PUNCH_PRIORITIES = ['low', 'normal', 'high'] as const;
export type PunchPriority = (typeof PUNCH_PRIORITIES)[number];

// Mirrors the backend STATUS_TRANSITIONS map so the UI only offers valid moves.
export const STATUS_TRANSITIONS: Record<PunchStatus, PunchStatus[]> = {
  draft: ['open'],
  open: ['in_progress', 'closed'],
  in_progress: ['ready_for_review'],
  ready_for_review: ['closed', 'in_progress'],
  closed: [],
};

export const STATUS_META: Record<PunchStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'var(--status-draft)' },
  open: { label: 'Open', color: 'var(--status-open)' },
  in_progress: { label: 'In Progress', color: 'var(--status-in_progress)' },
  ready_for_review: { label: 'Ready for Review', color: 'var(--status-ready_for_review)' },
  closed: { label: 'Closed', color: 'var(--status-closed)' },
};

export const PRIORITY_META: Record<PunchPriority, { label: string; color: string }> = {
  low: { label: 'Low', color: 'var(--prio-low)' },
  normal: { label: 'Normal', color: 'var(--prio-normal)' },
  high: { label: 'High', color: 'var(--prio-high)' },
};

// Board columns exclude 'draft' by default (drafts are pre-publish).
export const BOARD_COLUMNS: PunchStatus[] = ['open', 'in_progress', 'ready_for_review', 'closed'];
