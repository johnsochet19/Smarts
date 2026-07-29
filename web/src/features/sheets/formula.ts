import type { CellValue, SheetColumn, SheetRow } from './types';

/**
 * Minimal, safe formula evaluator for arithmetic over same-row columns.
 * Supports [Column Name] references, + - * / ( ), and SUM/AVG/MIN/MAX(list).
 * Anything else evaluates to "#ERR". No access to globals — after column
 * substitution the expression must contain only numbers and math operators,
 * or it is rejected (so `new Function` can never see identifiers).
 */
const ALLOWED = /^[0-9+\-*/(). ,]+$/;

function toNumber(v: CellValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function evaluateFormula(
  expr: string,
  row: SheetRow,
  columns: SheetColumn[]
): string {
  if (!expr) return '';
  let src = expr.trim();
  if (src.startsWith('=')) src = src.slice(1);

  // Expand aggregate helpers like SUM([A],[B]) into (a+b) etc.
  src = src.replace(/\b(SUM|AVG|MIN|MAX)\s*\(([^)]*)\)/gi, (_m, fn: string, args: string) => {
    const nums = args
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
      .map((token) => resolveToken(token, row, columns));
    if (nums.some((n) => n === null)) return 'NaN';
    const vals = nums as number[];
    switch (fn.toUpperCase()) {
      case 'SUM': return `(${vals.reduce((s, n) => s + n, 0)})`;
      case 'AVG': return `(${vals.length ? vals.reduce((s, n) => s + n, 0) / vals.length : 0})`;
      case 'MIN': return `(${Math.min(...vals)})`;
      case 'MAX': return `(${Math.max(...vals)})`;
      default: return 'NaN';
    }
  });

  // Replace remaining [Column Name] refs with their numeric value.
  src = src.replace(/\[([^\]]+)\]/g, (_m, name: string) => {
    const n = resolveToken(`[${name}]`, row, columns);
    return n === null ? 'NaN' : String(n);
  });

  if (src.includes('NaN') || !ALLOWED.test(src)) return '#ERR';
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${src});`)();
    if (typeof result !== 'number' || !Number.isFinite(result)) return '#ERR';
    return String(Math.round(result * 1e6) / 1e6);
  } catch {
    return '#ERR';
  }
}

function resolveToken(token: string, row: SheetRow, columns: SheetColumn[]): number | null {
  const m = token.match(/^\[([^\]]+)\]$/);
  if (m) {
    const col = columns.find((c) => c.name.toLowerCase() === m[1].trim().toLowerCase());
    if (!col || col.type === 'formula') return col ? toNumber(row.cells[col.id]) : null;
    return toNumber(row.cells[col.id]);
  }
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}
