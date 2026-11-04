import { PAGE_SIZES, type Grid, type LayoutDocument, type Surface } from "../schema/document";
import { diag, type Diagnostic } from "../validate/diagnostics";
import type { Frame, Guide } from "./types";

export function surfaceSize(surface: Surface): { width: number; height: number | null } {
  if (surface.kind === "continuous") return { width: surface.width, height: null };
  const size = typeof surface.size === "string" ? PAGE_SIZES[surface.size] : surface.size;
  return { width: size.width, height: size.height };
}

function margins(surface: Surface) {
  const m = surface.margin;
  return typeof m === "number" ? { top: m, right: m, bottom: m, left: m } : m;
}

/** The requested surface, or the first one (with an error) when it does not exist. */
export function pickSurface(doc: LayoutDocument, surfaceId: string | undefined, out: Diagnostic[]): Surface {
  const first = doc.surfaces[0] as Surface;
  if (!surfaceId) return first;
  const found = doc.surfaces.find((s) => s.id === surfaceId);
  if (found) return found;
  out.push(diag("error", "unknown-surface", `Surface "${surfaceId}" does not exist; using "${first.id}".`));
  return first;
}

/** Whole units in `px`, tolerating float noise (713.99999 → 89 at 8px). */
const unitsIn = (px: number, unit: number) => Math.max(0, Math.floor(px / unit + 1e-6));

/**
 * Guide columns snapped to whole units, so a component placed by `cols` sits exactly
 * on its guides. Columns and gutters keep their px proportions as closely as rounding allows.
 */
export function guidesFor(contentWidth: number, grid: Grid): Guide[] {
  const { columns, gutter, unit } = grid;
  const colPx = (contentWidth - (columns - 1) * gutter) / columns;
  const guides: Guide[] = [];
  for (let i = 0; i < columns; i++) {
    const start = Math.round((i * (colPx + gutter)) / unit);
    const end = Math.round((i * (colPx + gutter) + colPx) / unit);
    guides.push({ col: i + 1, x: start, w: Math.max(1, end - start) });
  }
  return guides;
}

/** Whole units down one page inside the margins (Infinity for a continuous surface). */
export function rowsOf(surface: Surface, unit: number): number {
  const size = surfaceSize(surface);
  if (size.height === null) return Number.POSITIVE_INFINITY;
  const m = margins(surface);
  return unitsIn(size.height - m.top - m.bottom, unit);
}

/** Rows a page master keeps for itself at the top and bottom of every page. */
export function reserveOf(surface: Surface): { top: number; bottom: number } {
  const r = surface.kind === "page" ? surface.master?.reserve : undefined;
  return { top: r?.top ?? 0, bottom: r?.bottom ?? 0 };
}

/** Whether the surface's master is drawn on page `index` (0-based). */
export function masterOn(surface: Surface, index: number): boolean {
  const master = surface.kind === "page" ? surface.master : undefined;
  if (!master || !master.components.length) return false;
  const which = master.pages ?? "all";
  return which === "all" ? true : which === "except-first" ? index > 0 : which.includes(index + 1);
}

/** Rows of a page left to the body once the master took its reserve. */
function bodyRowsOf(surface: Surface, unit: number): number {
  const rows = rowsOf(surface, unit);
  if (!Number.isFinite(rows)) return rows;
  const r = reserveOf(surface);
  return Math.max(1, rows - r.top - r.bottom);
}

/** Whole units across the content area. */
export function colsOf(surface: Surface, unit: number): number {
  const m = margins(surface);
  return unitsIn(surfaceSize(surface).width - m.left - m.right, unit);
}

export function frameFor(surface: Surface, grid: Grid, doc: LayoutDocument): Frame {
  const size = surfaceSize(surface);
  const margin = margins(surface);
  const contentWidth = size.width - margin.left - margin.right;
  const rows = bodyRowsOf(surface, grid.unit);
  const reserve = reserveOf(surface);
  const contentHeight = size.height === null ? Number.POSITIVE_INFINITY : rows * grid.unit;
  // A continuous surface stacks the declared pages of the first paged surface.
  const paged = doc.surfaces.find((s) => s.kind === "page");
  const pageStride = Number.isFinite(rows) ? rows : paged ? bodyRowsOf(paged, grid.unit) : Number.POSITIVE_INFINITY;
  return {
    surface,
    grid,
    width: size.width,
    height: size.height,
    margin,
    contentWidth,
    contentHeight,
    cols: unitsIn(contentWidth, grid.unit),
    rows,
    pageRows: rowsOf(surface, grid.unit),
    bodyTop: Number.isFinite(rows) ? reserve.top * grid.unit : 0,
    pageStride,
    guides: guidesFor(contentWidth, grid),
  };
}
