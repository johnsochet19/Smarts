import { useState } from 'react';
import { Avatar } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { BOARD_COLUMNS, STATUS_META, STATUS_TRANSITIONS } from '../constants';
import type { PunchStatus } from '../constants';
import { DueChip, PhotoCount, PriorityBadge } from '../components';
import type { PunchItem } from '../types';

export function BoardView({
  items, onOpen, onMove,
}: {
  items: PunchItem[];
  onOpen: (item: PunchItem) => void;
  onMove: (item: PunchItem, to: PunchStatus) => void;
}) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<PunchStatus | null>(null);

  const byCol = (status: PunchStatus) => items.filter((i) => i.status === status);
  const dragItem = items.find((i) => i.id === dragId) ?? null;

  function canDrop(to: PunchStatus): boolean {
    if (!dragItem) return false;
    if (dragItem.status === to) return false;
    return STATUS_TRANSITIONS[dragItem.status].includes(to);
  }

  return (
    <div className="pl-board">
      {BOARD_COLUMNS.map((status) => {
        const meta = STATUS_META[status];
        const droppable = canDrop(status);
        return (
          <div className="pl-col" key={status}>
            <div className="pl-col__head">
              <span className="bf-badge__dot" style={{ background: meta.color }} />
              <strong style={{ fontSize: 'var(--text-sm)' }}>{meta.label}</strong>
              <span className="pl-col__count">{byCol(status).length}</span>
            </div>
            <div
              className={`pl-col__body${overCol === status && droppable ? ' pl-col__body--over' : ''}`}
              onDragOver={(e) => {
                if (droppable) {
                  e.preventDefault();
                  setOverCol(status);
                }
              }}
              onDragLeave={() => setOverCol((c) => (c === status ? null : c))}
              onDrop={() => {
                if (dragItem && droppable) onMove(dragItem, status);
                setDragId(null);
                setOverCol(null);
              }}
            >
              {byCol(status).map((item) => (
                <div
                  key={item.id}
                  className="pl-card"
                  draggable
                  onDragStart={() => setDragId(item.id)}
                  onDragEnd={() => { setDragId(null); setOverCol(null); }}
                  onClick={() => onOpen(item)}
                >
                  <div className="pl-card__title">{item.title}</div>
                  <div className="bf-row bf-gap-2" style={{ flexWrap: 'wrap' }}>
                    <PriorityBadge priority={item.priority} />
                    <DueChip date={item.due_date} />
                  </div>
                  <div className="pl-card__foot">
                    <span className="bf-mono bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>#{item.punch_number ?? item.id}</span>
                    <PhotoCount item={item} />
                    <span className="bf-spacer" />
                    {item.assignee_name && <Avatar name={item.assignee_name} size={24} />}
                  </div>
                </div>
              ))}
              {byCol(status).length === 0 && (
                <div className="bf-subtle" style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-3)', textAlign: 'center' }}>
                  <Icon name="punch" size={16} /> Empty
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
