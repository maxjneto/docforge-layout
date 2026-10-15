import type { ComponentGeometry, LayoutResult } from "./types";

export interface RowGroup {
  /** 1-based page. */
  page: number;
  /** Component ids, left to right. */
  ids: string[];
}

/**
 * Components drawn side by side: on the same page with overlapping vertical ranges,
 * chained (A beside B beside C). Computed from the layout, never stored: the
 * document only knows positions. Split components count by their first piece.
 */
export function rowsOf(layout: LayoutResult): RowGroup[] {
  const boxes = Object.values(layout.components).map((g: ComponentGeometry) => ({ id: g.id, box: g.box }));
  boxes.sort((a, b) => a.box.page - b.box.page || a.box.y - b.box.y || a.box.x - b.box.x);
  const rows: (RowGroup & { bottom: number })[] = [];
  for (const { id, box } of boxes) {
    const last = rows[rows.length - 1];
    if (last && last.page === box.page && box.y < last.bottom) {
      last.ids.push(id);
      last.bottom = Math.max(last.bottom, box.y + box.h);
    } else {
      rows.push({ page: box.page, ids: [id], bottom: box.y + box.h });
    }
  }
  return rows.map(({ page, ids }) => ({
    page,
    ids: [...ids].sort((a, b) => (layout.components[a]?.box.x ?? 0) - (layout.components[b]?.box.x ?? 0)),
  }));
}
