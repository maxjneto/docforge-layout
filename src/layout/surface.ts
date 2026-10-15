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

function rowsOf(surface: Surface, unit: number): number {
  const size = surfaceSize(surface);
  if (size.height === null) return Number.POSITIVE_INFINITY;
  const m = margins(surface);
  return unitsIn(size.height - m.top - m.bottom, unit);
}

export function frameFor(surface: Surface, grid: Grid, doc: LayoutDocument): Frame {
  const size = surfaceSize(surface);
  const margin = margins(surface);
  const contentWidth = size.width - margin.left - margin.right;
  const contentHeight = size.height === null ? Number.POSITIVE_INFINITY : size.height - margin.top - margin.bottom;
  const rows = rowsOf(surface, grid.unit);
  // A continuous surface stacks the declared pages of the first paged surface.
  const paged = doc.surfaces.find((s) => s.kind === "page");
  const pageStride = Number.isFinite(rows) ? rows : paged ? rowsOf(paged, grid.unit) : Number.POSITIVE_INFINITY;
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
    pageStride,
    guides: guidesFor(contentWidth, grid),
  };
}
