import { useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/primitives';
import { StatusBadge } from '../components';
import type { PunchItem } from '../types';

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lightweight map: GPS-tagged items are projected onto a normalized grid
 * (relative min/max of the set) so no external map/tile dependency is needed.
 * Items without coordinates are listed below as "unmapped".
 */
export function MapView({ items, onOpen }: { items: PunchItem[]; onOpen: (item: PunchItem) => void }) {
  const geo = useMemo(() => {
    const tagged = items
      .map((it) => ({ it, lat: num(it.gps_lat), lng: num(it.gps_lng) }))
      .filter((x): x is { it: PunchItem; lat: number; lng: number } => x.lat !== null && x.lng !== null);
    if (!tagged.length) return { tagged: [] as Array<{ it: PunchItem; x: number; y: number }>, unmapped: items };
    const lats = tagged.map((t) => t.lat);
    const lngs = tagged.map((t) => t.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const spanLat = maxLat - minLat || 1;
    const spanLng = maxLng - minLng || 1;
    const placed = tagged.map(({ it, lat, lng }) => ({
      it,
      x: 8 + ((lng - minLng) / spanLng) * 84, // percent, padded
      y: 8 + ((maxLat - lat) / spanLat) * 84, // invert lat for screen space
    }));
    const unmapped = items.filter((it) => num(it.gps_lat) === null || num(it.gps_lng) === null);
    return { tagged: placed, unmapped };
  }, [items]);

  if (!geo.tagged.length) {
    return (
      <EmptyState
        icon="map"
        title="No GPS-tagged items yet"
        hint="Open an item on a phone and tap “Tag GPS” to capture its location. Tagged items will plot here."
      />
    );
  }

  return (
    <div className="pl-map">
      <div className="pl-map__canvas">
        {geo.tagged.map(({ it, x, y }) => (
          <div key={it.id} className="pl-map__pin" style={{ left: `${x}%`, top: `${y}%` }} title={it.title} onClick={() => onOpen(it)}>
            <Icon name="pin" size={28} />
            <span>{it.punch_number ?? it.id}</span>
          </div>
        ))}
      </div>
      <div className="pl-map__list">
        {geo.tagged.map(({ it }) => (
          <div key={it.id} className="pl-row" onClick={() => onOpen(it)}>
            <Icon name="pin" size={16} />
            <div className="pl-row__main">
              <div className="bf-truncate" style={{ fontWeight: 500 }}>#{it.punch_number ?? it.id} {it.title}</div>
              <div className="bf-subtle bf-mono" style={{ fontSize: 'var(--text-xs)' }}>
                {num(it.gps_lat)?.toFixed(5)}, {num(it.gps_lng)?.toFixed(5)}
              </div>
            </div>
            <StatusBadge status={it.status} />
          </div>
        ))}
        {geo.unmapped.length > 0 && (
          <div className="bf-subtle" style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2)' }}>
            {geo.unmapped.length} item(s) without GPS tags
          </div>
        )}
      </div>
    </div>
  );
}
