import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { STATUS_META } from '../constants';
import type { PunchItem } from '../types';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CalendarView({ items, onOpen }: { items: PunchItem[]; onOpen: (item: PunchItem) => void }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const byDate = useMemo(() => {
    const map = new Map<string, PunchItem[]>();
    for (const it of items) {
      if (!it.due_date) continue;
      const key = it.due_date.slice(0, 10);
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return map;
  }, [items]);

  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const result: Array<{ date: Date; inMonth: boolean }> = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      result.push({ date: d, inMonth: d.getMonth() === month });
    }
    return result;
  }, [cursor]);

  const todayKey = ymd(new Date());

  return (
    <div className="pl-cal">
      <div className="bf-row bf-gap-3">
        <Button variant="ghost" size="sm" iconOnly icon="chevronLeft" aria-label="Previous month"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} />
        <strong style={{ minWidth: 150, textAlign: 'center' }}>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</strong>
        <Button variant="ghost" size="sm" iconOnly icon="chevronRight" aria-label="Next month"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} />
        <Button variant="secondary" size="sm" onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); }}>Today</Button>
      </div>
      <div className="pl-cal__grid">
        {DOW.map((d) => <div key={d} className="pl-cal__dow">{d}</div>)}
        {cells.map(({ date, inMonth }, i) => {
          const key = ymd(date);
          const dayItems = byDate.get(key) ?? [];
          return (
            <div key={i} className={`pl-cal__cell${inMonth ? '' : ' pl-cal__cell--muted'}${dayItems.length ? ' pl-cal__cell--has' : ''}`}>
              <span className={key === todayKey ? 'pl-cal__date pl-cal__date--today' : 'pl-cal__date'}>{date.getDate()}</span>
              {dayItems.slice(0, 3).map((it) => (
                <div key={it.id} className="pl-cal__pill" style={{ background: STATUS_META[it.status].color }}
                  title={it.title} onClick={() => onOpen(it)}>
                  #{it.punch_number ?? it.id} {it.title}
                </div>
              ))}
              {dayItems.length > 3 && <span className="bf-subtle" style={{ fontSize: 10 }}>+{dayItems.length - 3} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
