export type TableCell = {
  element: HTMLTableCellElement;
  row: number;
  col: number;
  bottom: number;
  right: number;
};
export type TableRange = { row: number; col: number; bottom: number; right: number };

// Use visual coordinates, including slots occupied by merged cells.
export function buildTableGrid(table: HTMLTableElement) {
  const grid: TableCell[][] = [];
  const cells: TableCell[] = [];
  const rows = Array.from(table.rows);
  rows.forEach((row, r) => {
    grid[r] ??= [];
    let col = 0;
    Array.from(row.cells).forEach(element => {
      while (grid[r][col]) col++;
      const groupRows = Array.from(row.parentElement!.children).filter(el => el.tagName === 'TR');
      const remaining = groupRows.length - groupRows.indexOf(row);
      const height = Math.min(element.rowSpan || remaining, remaining);
      const cell = { element, row: r, col, bottom: r + height - 1, right: col + element.colSpan - 1 };
      cells.push(cell);
      for (let y = r; y <= cell.bottom; y++) {
        grid[y] ??= [];
        for (let x = col; x <= cell.right; x++) grid[y][x] = cell;
      }
      col = cell.right + 1;
    });
  });
  return { grid, cells };
}

// Expand until no merged cell is only partially selected.
export function expandTableRange(cells: TableCell[], initial: TableRange): TableRange {
  const range = { ...initial };
  let changed = true;
  while (changed) {
    changed = false;
    for (const cell of cells) {
      if (cell.row > range.bottom || cell.bottom < range.row || cell.col > range.right || cell.right < range.col) continue;
      const next = { row: Math.min(range.row, cell.row), col: Math.min(range.col, cell.col),
        bottom: Math.max(range.bottom, cell.bottom), right: Math.max(range.right, cell.right) };
      if (Object.keys(next).some(key => next[key as keyof TableRange] !== range[key as keyof TableRange])) {
        Object.assign(range, next);
        changed = true;
      }
    }
  }
  return range;
}

export function tableRangeTSV(grid: TableCell[][], range: TableRange): string {
  const rows: string[] = [];
  for (let r = range.row; r <= range.bottom; r++) {
    const values: string[] = [];
    for (let c = range.col; c <= range.right; c++) {
      const cell = grid[r]?.[c];
      // Merged values appear once; covered slots stay empty to preserve alignment.
      const text = cell && cell.row === r && cell.col === c ? cell.element.innerText.trim() : '';
      values.push(/[\r\n\t"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    }
    rows.push(values.join('\t'));
  }
  return rows.join('\n');
}
