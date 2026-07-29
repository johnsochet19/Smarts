import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { classNames } from '@/lib/format';
import { sheetsApi } from './api';
import { COLUMN_TYPE_META, DEFAULT_PRIORITY_CHOICES, DEFAULT_STATUS_CHOICES, SELECTABLE_TYPES } from './constants';
import type { CellValue, ColumnType, FullSheet, SheetColumn, SheetRow } from './types';
import { Cell } from './Cell';
import './sheets.css';

interface MenuState {
  x: number;
  y: number;
  kind: 'column' | 'row';
  id: number;
}

export function SheetGrid({ initial }: { initial: FullSheet }) {
  const toast = useToast();
  const sheetId = initial.sheet.id;
  const [columns, setColumns] = useState<SheetColumn[]>(() => sortCols(initial.columns));
  const [rows, setRows] = useState<SheetRow[]>(() => [...initial.rows]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const resizeRef = useRef<{ colId: number; startX: number; startW: number } | null>(null);

  const visibleColumns = useMemo(() => columns.filter((c) => !c.hidden), [columns]);

  // Flatten row tree into display order with depth, honoring collapse state.
  const displayRows = useMemo(() => flattenTree(rows, collapsed), [rows, collapsed]);
  const childrenOf = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of rows) if (r.parent_id != null) map.set(r.parent_id, (map.get(r.parent_id) ?? 0) + 1);
    return map;
  }, [rows]);

  /* ---- column resize ---- */
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const st = resizeRef.current;
      if (!st) return;
      const w = Math.max(70, st.startW + (e.clientX - st.startX));
      setColumns((cols) => cols.map((c) => (c.id === st.colId ? { ...c, width: w } : c)));
    }
    function onUp() {
      const st = resizeRef.current;
      if (st) {
        const col = columnsRef.current.find((c) => c.id === st.colId);
        if (col) sheetsApi.updateColumn(sheetId, st.colId, { width: col.width }).catch(() => {});
      }
      resizeRef.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [sheetId]);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  /* ---- cell edit ---- */
  async function commitCell(row: SheetRow, col: SheetColumn, value: CellValue) {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, cells: { ...r.cells, [col.id]: value } } : r)));
    try {
      await sheetsApi.updateRow(sheetId, row.id, { cells: { [col.id]: value } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  }

  /* ---- rows ---- */
  async function addRow(parentId: number | null = null) {
    try {
      const maxPos = rows.reduce((m, r) => Math.max(m, r.position), 0);
      const created = await sheetsApi.addRow(sheetId, { parent_id: parentId, position: maxPos + 1 });
      setRows((rs) => [...rs, created]);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add row'); }
  }
  async function duplicateRow(rowId: number) {
    try { const dup = await sheetsApi.duplicateRow(sheetId, rowId); setRows((rs) => [...rs, dup]); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Duplicate failed'); }
  }
  async function deleteRow(rowId: number) {
    const ids = descendants(rows, rowId);
    setRows((rs) => rs.filter((r) => !ids.has(r.id)));
    try { await sheetsApi.removeRow(sheetId, rowId); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed'); }
  }
  async function reparent(rowId: number, parentId: number | null) {
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, parent_id: parentId } : r)));
    try { await sheetsApi.updateRow(sheetId, rowId, { parent_id: parentId }); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Move failed'); }
  }
  function indentRow(rowId: number) {
    const order = displayRows;
    const idx = order.findIndex((d) => d.row.id === rowId);
    if (idx <= 0) return;
    const above = order[idx - 1];
    // Can't parent to own descendant.
    if (descendants(rows, rowId).has(above.row.id)) return;
    reparent(rowId, above.row.id);
    setCollapsed((c) => { const n = new Set(c); n.delete(above.row.id); return n; });
  }
  function outdentRow(rowId: number) {
    const row = rows.find((r) => r.id === rowId);
    if (!row || row.parent_id == null) return;
    const parent = rows.find((r) => r.id === row.parent_id);
    reparent(rowId, parent?.parent_id ?? null);
  }
  async function toggleLockRow(rowId: number, locked: boolean) {
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, locked } : r)));
    try { await sheetsApi.updateRow(sheetId, rowId, { locked }); } catch { /* noop */ }
  }

  /* ---- columns ---- */
  async function addColumn() {
    try {
      const col = await sheetsApi.addColumn(sheetId, { name: 'New Column', type: 'text', position: columns.length });
      setColumns((cs) => sortCols([...cs, col]));
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add column'); }
  }
  async function changeType(colId: number, type: ColumnType) {
    const options = type === 'status' ? { choices: DEFAULT_STATUS_CHOICES }
      : type === 'priority' ? { choices: DEFAULT_PRIORITY_CHOICES }
      : type === 'currency' ? { currencySymbol: '$' } : {};
    setColumns((cs) => cs.map((c) => (c.id === colId ? { ...c, type, options: { ...c.options, ...options } } : c)));
    try { await sheetsApi.updateColumn(sheetId, colId, { type, options }); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Type change failed'); }
  }
  async function renameColumn(colId: number, name: string) {
    setColumns((cs) => cs.map((c) => (c.id === colId ? { ...c, name } : c)));
    try { await sheetsApi.updateColumn(sheetId, colId, { name }); } catch { /* noop */ }
  }
  async function setColumnFlag(colId: number, patch: { hidden?: boolean; locked?: boolean }) {
    setColumns((cs) => cs.map((c) => (c.id === colId ? { ...c, ...patch } : c)));
    try { await sheetsApi.updateColumn(sheetId, colId, patch); } catch { /* noop */ }
  }
  async function deleteColumn(colId: number) {
    if (columns.filter((c) => !c.hidden).length <= 1) return toast.error('A sheet needs at least one column');
    setColumns((cs) => cs.filter((c) => c.id !== colId));
    try { await sheetsApi.removeColumn(sheetId, colId); } catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed'); }
  }

  const menuColumn = menu?.kind === 'column' ? columns.find((c) => c.id === menu.id) : null;
  const menuRow = menu?.kind === 'row' ? rows.find((r) => r.id === menu.id) : null;

  return (
    <div className="sh-wrap">
      <div className="sh-scroll">
        <div className="sh-grid">
          {/* Header */}
          <div className="sh-head">
            <div className="sh-gutter"><Icon name="grid" size={14} /></div>
            {visibleColumns.map((col) => (
              <div key={col.id} className="sh-hcell" style={{ width: col.width }}>
                <Icon name={COLUMN_TYPE_META[col.type].icon} size={13} />
                {renaming === col.id ? (
                  <input
                    className="sh-editor"
                    autoFocus
                    defaultValue={col.name}
                    onBlur={(e) => { renameColumn(col.id, e.target.value.trim() || col.name); setRenaming(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                  />
                ) : (
                  <span className="sh-hcell__name" onDoubleClick={() => !col.locked && setRenaming(col.id)} title="Double-click to rename">
                    {col.name}{col.is_primary ? '' : ''}
                  </span>
                )}
                {col.locked && <Icon name="logout" size={11} className="sh-hcell__lock" />}
                <button className="sh-hcell__menu" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, kind: 'column', id: col.id })} aria-label="Column menu">
                  <Icon name="more" size={15} />
                </button>
                <div className="sh-hcell__resize" onMouseDown={(e) => { resizeRef.current = { colId: col.id, startX: e.clientX, startW: col.width }; e.preventDefault(); }} />
              </div>
            ))}
            <button className="sh-addcol" onClick={addColumn} aria-label="Add column"><Icon name="plus" size={16} /></button>
          </div>

          {/* Rows */}
          {displayRows.map(({ row, depth }, i) => {
            const kids = childrenOf.get(row.id) ?? 0;
            return (
              <div key={row.id} className={classNames('sh-row', row.locked && 'sh-row--locked')}>
                <div className="sh-gutter-cell">
                  <span className="sh-rownum">{i + 1}</span>
                  <button className="sh-rowbtn" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, kind: 'row', id: row.id })} aria-label="Row menu"><Icon name="more" size={14} /></button>
                </div>
                {visibleColumns.map((col, ci) => (
                  <div key={col.id} className="sh-cell-wrap" style={{ width: col.width, flex: 'none' }}>
                    {ci === 0 ? (
                      <div className="sh-primary" style={{ paddingLeft: depth * 16 }}>
                        {kids > 0 ? (
                          <button className="sh-expander" onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(row.id) ? n.delete(row.id) : n.add(row.id); return n; })}>
                            <Icon name={collapsed.has(row.id) ? 'chevronRight' : 'chevronDown'} size={14} />
                          </button>
                        ) : <span style={{ width: 16 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Cell column={col} row={row} columns={columns} rowIndex={i} onCommit={(v) => commitCell(row, col, v)} />
                        </div>
                      </div>
                    ) : (
                      <Cell column={col} row={row} columns={columns} rowIndex={i} onCommit={(v) => commitCell(row, col, v)} />
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          <button className="sh-addrow" onClick={() => addRow(null)}><Icon name="plus" size={15} /> New row</button>
        </div>
      </div>

      {/* Popover menus */}
      {menu && menuColumn && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <div className="sh-menu__label">Column</div>
          <button className="sh-menu__item" onClick={() => { setRenaming(menuColumn.id); setMenu(null); }}><Icon name="list" size={15} /> Rename</button>
          <button className="sh-menu__item" onClick={() => { setColumnFlag(menuColumn.id, { locked: !menuColumn.locked }); setMenu(null); }}><Icon name="logout" size={15} /> {menuColumn.locked ? 'Unlock' : 'Lock'} column</button>
          <button className="sh-menu__item" onClick={() => { setColumnFlag(menuColumn.id, { hidden: true }); setMenu(null); }}><Icon name="close" size={15} /> Hide column</button>
          <div className="sh-menu__sep" />
          <div className="sh-menu__label">Change type</div>
          <div style={{ maxHeight: 190, overflow: 'auto' }}>
            {SELECTABLE_TYPES.map((t) => (
              <button key={t} className="sh-menu__item" onClick={() => { changeType(menuColumn.id, t); setMenu(null); }}>
                <Icon name={COLUMN_TYPE_META[t].icon} size={15} /> {COLUMN_TYPE_META[t].label}{menuColumn.type === t ? ' ✓' : ''}
              </button>
            ))}
          </div>
          {menuColumn.type === 'formula' && (
            <>
              <div className="sh-menu__sep" />
              <button className="sh-menu__item" onClick={() => {
                const f = prompt('Formula (e.g. =[Qty]*[Price] or =SUM([A],[B]))', menuColumn.options?.formula ?? '');
                if (f != null) {
                  setColumns((cs) => cs.map((c) => (c.id === menuColumn.id ? { ...c, options: { ...c.options, formula: f } } : c)));
                  sheetsApi.updateColumn(sheetId, menuColumn.id, { options: { ...menuColumn.options, formula: f } }).catch(() => {});
                }
                setMenu(null);
              }}><Icon name="grid" size={15} /> Edit formula…</button>
            </>
          )}
          <div className="sh-menu__sep" />
          <button className="sh-menu__item sh-menu__item--danger" onClick={() => { deleteColumn(menuColumn.id); setMenu(null); }}><Icon name="trash" size={15} /> Delete column</button>
        </Popover>
      )}
      {menu && menuRow && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <div className="sh-menu__label">Row</div>
          <button className="sh-menu__item" onClick={() => { addRow(menuRow.id); setMenu(null); }}><Icon name="plus" size={15} /> Add child row</button>
          <button className="sh-menu__item" onClick={() => { indentRow(menuRow.id); setMenu(null); }}><Icon name="chevronRight" size={15} /> Indent</button>
          <button className="sh-menu__item" onClick={() => { outdentRow(menuRow.id); setMenu(null); }}><Icon name="chevronLeft" size={15} /> Outdent</button>
          <button className="sh-menu__item" onClick={() => { duplicateRow(menuRow.id); setMenu(null); }}><Icon name="board" size={15} /> Duplicate</button>
          <button className="sh-menu__item" onClick={() => { toggleLockRow(menuRow.id, !menuRow.locked); setMenu(null); }}><Icon name="logout" size={15} /> {menuRow.locked ? 'Unlock' : 'Lock'} row</button>
          <div className="sh-menu__sep" />
          <button className="sh-menu__item sh-menu__item--danger" onClick={() => { deleteRow(menuRow.id); setMenu(null); }}><Icon name="trash" size={15} /> Delete row</button>
        </Popover>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */
function sortCols(cols: SheetColumn[]): SheetColumn[] {
  return [...cols].sort((a, b) => a.position - b.position || a.id - b.id);
}

function flattenTree(rows: SheetRow[], collapsed: Set<number>): Array<{ row: SheetRow; depth: number }> {
  const byParent = new Map<number | null, SheetRow[]>();
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const key = r.parent_id != null && ids.has(r.parent_id) ? r.parent_id : null;
    const arr = byParent.get(key) ?? [];
    arr.push(r);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.position - b.position || a.id - b.id);
  const out: Array<{ row: SheetRow; depth: number }> = [];
  function walk(parent: number | null, depth: number) {
    for (const row of byParent.get(parent) ?? []) {
      out.push({ row, depth });
      if (!collapsed.has(row.id)) walk(row.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

function descendants(rows: SheetRow[], rootId: number): Set<number> {
  const byParent = new Map<number, SheetRow[]>();
  for (const r of rows) if (r.parent_id != null) { const a = byParent.get(r.parent_id) ?? []; a.push(r); byParent.set(r.parent_id, a); }
  const set = new Set<number>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of byParent.get(id) ?? []) { if (!set.has(child.id)) { set.add(child.id); stack.push(child.id); } }
  }
  return set;
}

function Popover({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = () => onClose();
    window.addEventListener('click', h);
    window.addEventListener('resize', h);
    return () => { window.removeEventListener('click', h); window.removeEventListener('resize', h); };
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 210);
  const top = Math.min(y, window.innerHeight - 260);
  return (
    <div className="sh-menu" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
