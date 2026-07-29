import type { InspectionStatus } from './types';

export const STATUS_META: Record<InspectionStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'var(--slate-500)' },
  in_progress: { label: 'In Progress', color: 'var(--amber-500)' },
  deficient: { label: 'Deficient', color: 'var(--red-500)' },
  passed: { label: 'Passed', color: 'var(--green-500)' },
  closed: { label: 'Closed', color: 'var(--slate-500)' },
};

// Mirrors the backend STATUS_TRANSITIONS.
export const STATUS_TRANSITIONS: Record<InspectionStatus, InspectionStatus[]> = {
  pending: ['in_progress'],
  in_progress: ['passed', 'deficient'],
  deficient: ['in_progress', 'closed'],
  passed: ['closed'],
  closed: [],
};

export const INSPECTION_TYPES = [
  { value: 'quality', label: 'Quality' },
  { value: 'safety', label: 'Safety' },
  { value: 'commissioning', label: 'Commissioning' },
  { value: 'pre_pour', label: 'Pre-pour' },
  { value: 'punch', label: 'Punch' },
  { value: 'final', label: 'Final' },
  { value: 'other', label: 'Other' },
];
