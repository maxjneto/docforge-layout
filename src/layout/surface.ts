import { PAGE_SIZES, type Grid, type LayoutDocument, type Surface } from "../schema/document";
import { diag, type Diagnostic } from "../validate/diagnostics";
import type { Frame } from "./types";

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

export function frameFor(surface: Surface, grid: Grid): Frame {
  const size = surfaceSize(surface);
  const margin = margins(surface);
  const contentWidth = size.width - margin.left - margin.right;
  const contentHeight = size.height === null ? Number.POSITIVE_INFINITY : size.height - margin.top - margin.bottom;
  const columnWidth = (contentWidth - (grid.columns - 1) * grid.columnGap) / grid.columns;
  return {
    surface,
    grid,
    width: size.width,
    height: size.height,
    margin,
    contentWidth,
    contentHeight,
    columnWidth,
    areaWidthOf: (span) => span * columnWidth + (span - 1) * grid.columnGap,
    xOf: (colStart) => margin.left + (colStart - 1) * (columnWidth + grid.columnGap),
  };
}
