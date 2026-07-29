import { useEffect, useRef, useState } from 'react';
import { formatDate } from '@/lib/format';
import { Avatar } from '@/components/ui/primitives';
import type { CellValue, SheetColumn, SheetRow } from './types';
import { evaluateFormula } from './formula';

interface CellProps {
  column: SheetColumn;
  row: SheetRow;
  columns: SheetColumn[];
  rowIndex: number;
  readOnly?: boolean;
  onCommit: (value: CellValue) => void;
}

export function Cell({ column, row, columns, rowIndex, readOnly, onCommit }: CellProps) {
  const [editing, setEditing] = useState(false);
  const raw = row.cells[column.id] ?? null;
  const choices = column.options?.choices ?? [];
  const locked = readOnly || column.locked || row.locked;

  // Non-editable computed types
  if (column.type === 'auto_number') {
    return <div className="sh-cell sh-cell--ro bf-mono">{rowIndex + 1}</div>;
  }
  if (column.type === 'formula') {
    const out = evaluateFormula(column.options?.formula ?? '', row, columns);
    return <div className="sh-cell sh-cell--ro bf-mono" title={column.options?.formula}>{out}</div>;
  }
  if (column.type === 'checkbox') {
    return (
      <div className="sh-cell sh-cell--center">
        <input type="checkbox" checked={!!raw} disabled={locked} onChange={(e) => onCommit(e.target.checked)} />
      </div>
    );
  }

  if (editing && !locked) {
    return <CellEditor column={column} value={raw} onDone={(v) => { setEditing(false); if (v !== raw) onCommit(v); }} />;
  }

  return (
    <div
      className={`sh-cell${locked ? ' sh-cell--locked' : ''}`}
      tabIndex={0}
      onClick={() => !locked && setEditing(true)}
      onKeyDown={(e) => { if (!locked && (e.key === 'Enter' || e.key === 'F2')) setEditing(true); }}
    >
      <CellDisplay column={column} value={raw} choices={choices} />
    </div>
  );
}

function CellDisplay({ column, value, choices }: { column: SheetColumn; value: CellValue; choices: { value: string; label: string; color?: string }[] }) {
  if (value == null || value === '') return <span className="sh-empty" />;
  switch (column.type) {
    case 'currency': {
      const sym = column.options?.currencySymbol ?? '$';
      const n = Number(value);
      return <span className="bf-mono">{Number.isFinite(n) ? `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(value)}</span>;
    }
    case 'percent': {
      const n = Math.max(0, Math.min(100, Number(value) || 0));
      return (
        <div className="sh-pct">
          <div className="sh-pct__track"><div className="sh-pct__fill" style={{ width: `${n}%` }} /></div>
          <span className="bf-mono sh-pct__val">{n}%</span>
        </div>
      );
    }
    case 'number':
      return <span className="bf-mono">{String(value)}</span>;
    case 'date':
      return <span>{formatDate(String(value))}</span>;
    case 'status':
    case 'priority':
    case 'dropdown': {
      const c = choices.find((x) => x.value === value);
      if (!c) return <span>{String(value)}</span>;
      return <span className="sh-chip" style={{ background: (c.color ?? '#64748b') + '22', color: c.color ?? 'var(--text)' }}><span className="sh-chip__dot" style={{ background: c.color }} />{c.label}</span>;
    }
    case 'contact':
      return <span className="bf-row bf-gap-2"><Avatar name={String(value)} size={20} /> {String(value)}</span>;
    default:
      return <span className="bf-truncate">{String(value)}</span>;
  }
}

function CellEditor({ column, value, onDone }: { column: SheetColumn; value: CellValue; onDone: (v: CellValue) => void }) {
  const [val, setVal] = useState<string>(value == null ? '' : String(value));
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const choices = column.options?.choices ?? [];

  useEffect(() => {
    ref.current?.focus();
    if (ref.current && 'select' in ref.current && column.type !== 'date' && column.type !== 'time') {
      try { (ref.current as HTMLInputElement).select(); } catch { /* select not supported */ }
    }
  }, [column.type]);

  function commit() {
    if (column.type === 'number' || column.type === 'currency' || column.type === 'percent') {
      const n = val === '' ? null : Number(val);
      onDone(n == null ? null : Number.isFinite(n) ? n : null);
    } else {
      onDone(val === '' ? null : val);
    }
  }

  if (column.type === 'status' || column.type === 'priority' || column.type === 'dropdown') {
    return (
      <select
        ref={ref}
        className="sh-editor"
        value={val}
        onChange={(e) => { setVal(e.target.value); onDone(e.target.value || null); }}
        onBlur={() => onDone(val || null)}
      >
        <option value="">—</option>
        {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
    );
  }

  const inputType = column.type === 'date' ? 'date' : column.type === 'time' ? 'time' : column.type === 'number' || column.type === 'currency' || column.type === 'percent' ? 'number' : 'text';
  return (
    <input
      ref={ref}
      className="sh-editor"
      type={inputType}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') onDone(value);
      }}
    />
  );
}
