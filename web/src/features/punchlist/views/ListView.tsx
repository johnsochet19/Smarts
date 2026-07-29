import { Avatar } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/primitives';
import { titleCase } from '@/lib/format';
import { DueChip, PhotoCount, PriorityBadge, StatusBadge } from '../components';
import type { PunchItem } from '../types';

export function ListView({ items, onOpen }: { items: PunchItem[]; onOpen: (item: PunchItem) => void }) {
  if (!items.length) {
    return <EmptyState icon="punch" title="No punch items match" hint="Adjust filters or create a new item." />;
  }
  return (
    <div className="pl-list">
      {items.map((item) => (
        <div key={item.id} className="pl-row" onClick={() => onOpen(item)} role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onOpen(item)}>
          <span className="pl-row__num">#{item.punch_number ?? item.id}</span>
          <div className="pl-row__main">
            <div className="pl-row__title bf-truncate">{item.title}</div>
            <div className="pl-row__meta">
              <PriorityBadge priority={item.priority} />
              {item.trade && <span className="pl-meta-chip">{titleCase(item.trade)}</span>}
              {item.location && <span className="pl-meta-chip">{item.location}</span>}
              <DueChip date={item.due_date} />
              <PhotoCount item={item} />
            </div>
          </div>
          <div className="pl-row__side">
            <StatusBadge status={item.status} />
            {item.assignee_name && <Avatar name={item.assignee_name} size={28} />}
          </div>
        </div>
      ))}
    </div>
  );
}
