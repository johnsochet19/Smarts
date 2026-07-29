import { Badge } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { relativeDays } from '@/lib/format';
import { PRIORITY_META, STATUS_META } from './constants';
import type { PunchPriority, PunchStatus } from './constants';
import type { PunchItem } from './types';
import './punchlist.css';

export function StatusBadge({ status }: { status: PunchStatus }) {
  const m = STATUS_META[status];
  return <Badge color={m.color} dot>{m.label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: PunchPriority }) {
  const m = PRIORITY_META[priority];
  if (priority === 'high') return <Badge color={m.color} solid>High</Badge>;
  return <Badge color={m.color} dot>{m.label}</Badge>;
}

export function DueChip({ date }: { date?: string | null }) {
  const rel = relativeDays(date);
  if (!rel) return null;
  return (
    <span className={`pl-meta-chip${rel.overdue ? ' pl-meta-chip--overdue' : ''}`}>
      <Icon name="clock" size={13} />
      {rel.label}
    </span>
  );
}

export function PhotoCount({ item }: { item: PunchItem }) {
  const photos = item.photos?.filter((p) => (p.media_type ?? 'photo') === 'photo').length ?? 0;
  const voice = item.photos?.filter((p) => p.media_type === 'voice').length ?? 0;
  if (!photos && !voice) return null;
  return (
    <span className="pl-meta-chip">
      {photos > 0 && (<><Icon name="camera" size={13} />{photos}</>)}
      {voice > 0 && (<><Icon name="mic" size={13} />{voice}</>)}
    </span>
  );
}
