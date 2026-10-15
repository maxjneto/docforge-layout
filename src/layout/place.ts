import { defOf, type Chunk } from "../components";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { renderBox } from "./box";
import type { ComponentGeometry, Frame, PageLayout, Prepared, UnitBox } from "./types";

/** A box already on the canvas, in global rows (page breaks every `frame.rows`). */
interface Occupied {
  id: string;
  x: number;
  w: number;
  top: number;
  bottom: number;
}

/** One piece of a component to draw: global top row, height in rows, the chunks it holds. */
interface Piece {
  top: number;
  rows: number;
  chunks: Chunk[];
}

const rowsFor = (px: number, unit: number) => Math.max(1, Math.ceil(px / unit - 1e-6));

/**
 * Put every component where it was declared, then resolve what the content changed:
 *
 * - a box is as tall as its declared `h` or as its content needs, whichever is more;
 * - components are taken in declared order (page, y, x); one that runs into a box
 *   already placed (overlapping columns and rows) moves down below it, `grid.gap`
 *   rows apart — so growing pushes only what it actually invades, in a chain;
 * - on a paged surface, a box that crosses the bottom of the page splits between
 *   chunks when it can (text, list, table, code, steps, timeline) or moves whole to
 *   the top of the next page; either way it pushes what it meets there.
 *
 * Nothing here is written back: the document keeps the declared positions, so a box
 * that was pushed returns to its place when whatever pushed it shrinks.
 */
export function placeComponents(
  prepared: Prepared[],
  frame: Frame,
  out: Diagnostic[],
): { pages: PageLayout[]; components: Record<string, ComponentGeometry> } {
  const { grid, margin } = frame;
  const unit = grid.unit;
  const paged = Number.isFinite(frame.rows);
  const R = frame.rows;
  const stride = frame.pageStride;
  const occupied: Occupied[] = [];
  const components: Record<string, ComponentGeometry> = {};
  const placedPieces = new Map<string, Piece[]>();

  const pageStart = (row: number) => (paged ? Math.floor(row / R) * R : 0);
  const pageEnd = (row: number) => (paged ? pageStart(row) + R : Number.POSITIVE_INFINITY);

  const items = prepared.map((p) => {
    const { declared } = p;
    let page = declared.page;
    if (!Number.isFinite(stride) && page > 1) {
      out.push(
        diag("warning", "unknown-page", `"${p.component.id}" is on page ${page}, but the document has no paged surface; it is drawn on page 1.`, {
          component: p.component.id,
        }),
      );
      page = 1;
    }
    const neededPx = p.laid.needed + p.inset * 2;
    const naturalPx = p.laid.natural + p.inset * 2;
    const required = rowsFor(neededPx, unit);
    const base = declared.h ?? rowsFor(naturalPx, unit);
    const rows = Math.max(base, required);
    return {
      p,
      top: (Number.isFinite(stride) ? (page - 1) * stride : 0) + declared.y,
      rows,
      grew: declared.h !== undefined ? Math.max(0, required - declared.h) : 0,
      neededPx,
      naturalPx,
    };
  });
  items.sort((a, b) => a.top - b.top || a.p.x - b.p.x || a.p.order - b.p.order);

  for (const item of items) {
    const { p } = item;
    const x = p.x;
    const w = p.w;
    const def = defOf(p.component.type);
    const splittable = paged && p.laid.splittable && def.sizing === "content" && p.laid.chunks.length > 1;
    const header = p.laid.header;
    const queue = [...p.laid.chunks];
    const pieces: Piece[] = [];
    let pushedBy: string | undefined;
    let top = item.top;

    const chunkRows = (chunks: Chunk[]) => rowsFor(chunks.reduce((s, c) => s + c.height, 0) + p.inset * 2, unit);
    const restRows = () => (pieces.length === 0 ? item.rows : chunkRows(header ? [header, ...queue] : queue));

    // Move `top` down until [top, top + rows) collides with nothing placed in these columns.
    const settle = (rows: () => number) => {
      for (;;) {
        const r = rows();
        const hit = occupied.find((o) => o.x < x + w && x < o.x + o.w && o.top < top + r && o.bottom > top);
        if (!hit) return;
        top = hit.bottom + grid.gap;
        pushedBy = hit.id;
      }
    };

    for (;;) {
      const full = restRows();
      // A box that may split only needs room down to the end of the page it starts on.
      settle(() => (splittable ? Math.min(full, pageEnd(top) - top) : full));
      if (!paged || top + full <= pageEnd(top)) {
        pieces.push({ top, rows: full, chunks: pieces.length === 0 ? queue.splice(0) : [...(header ? [header] : []), ...queue.splice(0)] });
        break;
      }
      const atPageTop = top === pageStart(top);
      if (!splittable) {
        if (atPageTop) {
          out.push(
            diag("warning", "too-tall", `"${p.component.id}" is ${full} rows tall; a page holds ${R}. It is cut at the bottom of the page.`, {
              component: p.component.id,
              data: { rows: full, pageRows: R },
              suggestions: ["Lower its h.", "Make it wider so its content takes fewer rows.", "Split its content into two components."],
            }),
          );
          pieces.push({ top, rows: full, chunks: queue.splice(0) });
          break;
        }
        top = pageEnd(top);
        continue;
      }

      const roomPx = (pageEnd(top) - top) * unit - p.inset * 2;
      const take: Chunk[] = pieces.length > 0 && header ? [header] : [];
      let used = take.reduce((s, c) => s + c.height, 0);
      while (queue.length && used + (queue[0] as Chunk).height <= roomPx + 0.01) {
        const c = queue.shift() as Chunk;
        take.push(c);
        used += c.height;
      }
      const tookContent = take.length > (pieces.length > 0 && header ? 1 : 0);
      if (!tookContent) {
        if (!atPageTop) {
          top = pageEnd(top);
          continue;
        }
        // Not even one chunk fits on an empty page: place it anyway and report.
        take.push(queue.shift() as Chunk);
        out.push(diag("warning", "too-tall", `A slice of "${p.component.id}" is taller than the page content area.`, { component: p.component.id }));
      }
      pieces.push({ top, rows: chunkRows(take), chunks: take });
      if (!queue.length) break;
      top = pageEnd(top);
    }

    // Area components draw into their final height.
    const first = pieces[0] as Piece;
    if (def.sizing === "area") {
      p.ctx.height = Math.max(0, first.rows * unit - p.inset * 2);
      p.laid = def.layout(p.component as never, p.ctx);
      first.chunks = p.laid.chunks;
    }
    for (const d of p.laid.diagnostics) out.push({ ...d, component: d.component ?? p.component.id });

    for (const piece of pieces) occupied.push({ id: p.component.id, x, w, top: piece.top, bottom: piece.top + piece.rows });
    placedPieces.set(p.component.id, pieces);

    const toBox = (piece: Piece): UnitBox => {
      const start = pageStart(piece.top);
      return { page: (paged ? start / R : 0) + 1, x, y: piece.top - start, w, h: piece.rows };
    };
    const boxes = pieces.map(toBox);
    components[p.component.id] = {
      id: p.component.id,
      type: p.component.type,
      sizing: def.sizing,
      declared: p.declared,
      box: boxes[0] as UnitBox,
      pieces: boxes,
      area: { width: w * unit, height: first.rows * unit },
      needed: Math.ceil(item.neededPx),
      natural: Math.ceil(item.naturalPx),
      shifted: first.top - item.top,
      ...(first.top !== item.top && pushedBy ? { pushedBy } : {}),
      grew: item.grew,
      clamped: p.clamped,
      pages: [...new Set(boxes.map((b) => b.page - 1))],
      facts: p.laid.facts ?? {},
      labels: p.component.labels ?? [],
      style: p.styleWithOrigin,
    };
  }

  // Pages: as many as the lowest box reaches (at least one).
  const lowest = Math.max(0, ...occupied.map((o) => o.bottom));
  const pageCount = paged ? Math.max(1, Math.ceil(lowest / R)) : 1;
  const pages: PageLayout[] = [];
  for (let i = 0; i < pageCount; i++) {
    const contentHeight = paged ? frame.contentHeight : lowest * unit;
    pages.push({
      index: i,
      width: frame.width,
      height: paged ? (frame.height as number) : margin.top + contentHeight + margin.bottom,
      boxes: [],
      content: { x: margin.left, y: margin.top, width: frame.contentWidth, height: contentHeight },
      rows: paged ? R : lowest,
    });
  }

  for (const p of prepared) {
    const pieces = placedPieces.get(p.component.id);
    if (!pieces) continue;
    const split = pieces.length > 1;
    pieces.forEach((piece, index) => {
      const start = pageStart(piece.top);
      const page = pages[paged ? start / R : 0] as PageLayout;
      const px = margin.left + p.x * unit;
      const py = margin.top + (piece.top - start) * unit;
      const hgt = piece.rows * unit;
      page.boxes.push({
        component: p.component.id,
        x: px,
        y: py,
        width: p.areaWidth,
        height: hgt,
        html: renderBox(p, px, py, p.areaWidth, hgt, piece.chunks, { piece: index }),
        ...(split ? { piece: index } : {}),
      });
    });
  }
  for (const page of pages) page.boxes.sort((a, b) => a.y - b.y || a.x - b.x);

  const surface = frame.surface;
  if (surface.kind === "page" && surface.maxPages !== undefined && pageCount > surface.maxPages) {
    const overRows = lowest - surface.maxPages * R;
    const onExtra = Object.values(components)
      .filter((g) => g.pages.some((i) => i >= (surface.maxPages as number)))
      .sort((a, b) => b.area.height - a.area.height)
      .slice(0, 3)
      .map((g) => g.id);
    out.push(
      diag("warning", "page-limit", `The document takes ${pageCount} pages; the limit is ${surface.maxPages} — ${overRows} rows (${overRows * unit}px) over.`, {
        data: { pages: pageCount, maxPages: surface.maxPages, overRows },
        suggestions: [
          ...(onExtra.length ? [`Past the limit: ${onExtra.join(", ")}.`] : []),
          "Shorten the tallest content or make it wider, lower fixed heights (h), or raise maxPages.",
        ],
      }),
    );
  }

  return { pages, components };
}
