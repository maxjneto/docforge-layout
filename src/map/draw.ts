import type { Guide, UnitBox } from "../layout/types";

export interface DrawBox {
  box: UnitBox;
  label: string;
}

/** Characters left of the drawing: the row number and a space. */
export function gutterFor(rows: number): number {
  return String(rows).length + 1;
}

/** Column numbers every 10 units, then the guide columns at their first unit. */
export function rulers(cols: number, guides: Guide[], gutter: number): string[] {
  const numbers = Array.from({ length: cols }, () => " ");
  for (let x = 0; x < cols; x += 10) {
    const digits = String(x);
    for (let i = 0; i < digits.length && x + i < cols; i++) numbers[x + i] = digits[i] as string;
  }
  const guideLine = Array.from({ length: cols }, () => " ");
  for (const g of guides) {
    const digits = String(g.col);
    // Skip a number that would run into the next one.
    if (guideLine.slice(g.x, g.x + digits.length + 1).some((c) => c !== " ")) continue;
    for (let i = 0; i < digits.length && g.x + i < cols; i++) guideLine[g.x + i] = digits[i] as string;
  }
  const pad = " ".repeat(gutter);
  return [`${pad}${numbers.join("").trimEnd()}   ← x (units)`, `${pad}${guideLine.join("").trimEnd()}   ← guide columns`];
}

/**
 * One page drawn in ASCII: one character per unit across, one line per row down,
 * every box outlined with its label in the top edge. Rows identical to the row above
 * are left out (the row numbers show the jump), so a page stays a few dozen lines.
 */
export function drawPage(cols: number, rows: number, boxes: DrawBox[], gutter: number): string[] {
  const canvas = Array.from({ length: rows }, () => Array.from({ length: cols }, () => " "));
  const put = (x: number, y: number, ch: string) => {
    const row = canvas[y];
    if (row && x >= 0 && x < cols) row[x] = ch;
  };

  for (const { box, label } of boxes) {
    const { x, y, w, h } = box;
    const right = x + w - 1;
    const bottom = y + h - 1;
    if (h === 1) {
      for (let i = x; i <= right; i++) put(i, y, "=");
    } else {
      for (let i = x; i <= right; i++) {
        put(i, y, "-");
        put(i, bottom, "-");
      }
      for (let j = y + 1; j < bottom; j++) {
        put(x, j, "|");
        put(right, j, "|");
      }
      for (const [cx, cy] of [
        [x, y],
        [right, y],
        [x, bottom],
        [right, bottom],
      ] as const) {
        put(cx, cy, "+");
      }
    }
    // The label sits in the top edge: "+-label----+".
    const room = w - 3;
    if (room > 0) {
      const text = label.slice(0, room);
      for (let i = 0; i < text.length; i++) put(x + 2 + i, y, text[i] as string);
    }
  }

  const lines: string[] = [];
  let previous: string | null = null;
  canvas.forEach((row, r) => {
    const line = row.join("").trimEnd();
    if (line === previous) return;
    previous = line;
    lines.push(`${String(r).padStart(gutter - 1)} ${line}`.trimEnd());
  });
  lines.push(`${String(rows).padStart(gutter - 1)} (end of page)`);
  return lines;
}
