import type { LayoutResult, UnitBox } from "../layout/types";
import { defaultGrid, type LayoutDocument } from "../schema/document";
import type { Op } from "./schema";

type MoveOp = Extract<Op, { op: "move" }>;

export interface MoveOutcome {
  /** The components of the block, in reading order. */
  block: string[];
  /** Components that moved up into the block's old place or down to make room for it. */
  followed: string[];
  /** Rows the block takes, with the gap after it. */
  rows: number;
  /** True when the block crossed a page break and moved in the document's reading flow. */
  flow: boolean;
}

/** Where a component is drawn: its page, top row and bottom row (all pieces on one page). */
interface Band {
  id: string;
  page: number;
  top: number;
  bottom: number;
}

function bandOf(id: string, layout: LayoutResult): Band | null {
  const g = layout.components[id];
  if (!g) return null;
  const last = (g.pieces[g.pieces.length - 1] ?? g.box) as UnitBox;
  return { id, page: g.box.page, top: g.box.y, bottom: last.page === g.box.page ? last.y + last.h : Number.POSITIVE_INFINITY };
}

/**
 * The same band with the pages laid end to end (row = (page − 1) × rows + y), so a block
 * that crosses a page break has a top and a bottom like any other. Everything is on page 1
 * of that strip; writing positions back turns rows past a page into the next page.
 */
function flowBandOf(id: string, layout: LayoutResult, rows: number): Band | null {
  const g = layout.components[id];
  if (!g) return null;
  const last = (g.pieces[g.pieces.length - 1] ?? g.box) as UnitBox;
  return { id, page: 1, top: (g.box.page - 1) * rows + g.box.y, bottom: (last.page - 1) * rows + last.y + last.h };
}

/**
 * Move a block of components before or after another one, the way a section moves in a
 * text: what was below the block moves up into its place, and what is below the target
 * moves down to make room. A block is a vertical band of one page: `component`, or every
 * component whose top is between `component`'s and `through`'s (rows move whole). A block
 * that crosses a page break moves in the reading flow of the whole document (see below).
 * Components beside the band (in other columns) stay where they are. Positions are taken
 * from the layout as drawn and written back as declared positions.
 * Returns what moved, or a message.
 */
export function moveBlock(doc: LayoutDocument, op: MoveOp, layout: LayoutResult): MoveOutcome | string {
  const targetId = op.before ?? op.after;
  if ((op.before === undefined) === (op.after === undefined)) return "give before or after (one of them).";
  for (const id of [op.component, op.through, targetId]) {
    if (id !== undefined && !doc.components.some((c) => c.id === id)) return `Component "${id}" does not exist.`;
  }

  const collect = (of: (id: string) => Band | null) => {
    const map = new Map<string, Band>();
    for (const c of doc.components) {
      const b = c.at ? of(c.id) : null;
      if (b) map.set(c.id, b);
    }
    return map;
  };
  let bands = collect((id) => bandOf(id, layout));
  const pageFirst = bands.get(op.component);
  const pageLast = bands.get(op.through ?? op.component);
  if (!pageFirst || !pageLast || !bands.get(targetId as string)) return "the block and the target must be placed components.";
  const blockOf = (map: Map<string, Band>, first: Band, last: Band) =>
    op.through === undefined ? [op.component] : [...map.values()].filter((b) => b.page === first.page && b.top >= first.top && b.top <= last.top).map((b) => b.id);

  // A block that spans pages (through on a later page, or a box split across the break) is
  // moved in the document's reading flow: the pages are treated as one long strip, so what
  // follows the block anywhere moves up and what follows the target moves down. The same
  // when the target's row is split across a break: "after" it is on the next page. Slides
  // stand alone, so there it stays a page-by-page move.
  const rowsPerPage = layout.units.rows;
  const split = (b: Band) => b.bottom === Number.POSITIVE_INFINITY;
  const targetBand = bands.get(targetId as string) as Band;
  const targetRow = [...bands.values()].filter((b) => b.page === targetBand.page && b.top >= targetBand.top && b.top < targetBand.bottom);
  const crosses =
    pageLast.page !== pageFirst.page ||
    blockOf(bands, pageFirst, pageLast).some((id) => split(bands.get(id) as Band)) ||
    split(targetBand) ||
    (op.after !== undefined && targetRow.some(split));
  if (crosses) {
    if (layout.surface?.kind === "page" && layout.surface.size === "Slide") {
      return "on slides a block cannot cross slides; move components within a slide, or whole slides with the page op.";
    }
    if (!rowsPerPage) return "the block crosses a page break on a surface without pages.";
    bands = collect((id) => flowBandOf(id, layout, rowsPerPage));
  }
  const first = bands.get(op.component) as Band;
  const last = bands.get(op.through ?? op.component) as Band;
  const target = bands.get(targetId as string) as Band;
  if (last.page !== first.page || last.top < first.top) return `"${op.through}" (through) must be at or below "${op.component}".`;

  const blockIds = blockOf(bands, first, last);
  const block = blockIds.map((id) => bands.get(id) as Band);
  if (blockIds.includes(targetId as string)) return `"${targetId}" is in the block; move it before or after something outside it.`;

  const page = first.page;
  const top = Math.min(...block.map((b) => b.top));
  const bottom = Math.max(...block.map((b) => b.bottom));
  if (target.page === page && target.top >= top && target.top < bottom) {
    return `"${targetId}" is beside the block, not above or below it; pick a component above or below it.`;
  }
  const gap = op.gap ?? doc.grid?.gap ?? defaultGrid.gap;
  const height = bottom - top + gap;
  const inBlock = new Set(blockIds);
  const others = [...bands.values()].filter((b) => !inBlock.has(b.id));

  // New top row of every component that moves, starting from where it is drawn.
  const tops = new Map<string, { page: number; top: number }>();
  const now = (b: Band) => tops.get(b.id) ?? { page: b.page, top: b.top };

  // 1. Close the hole: what is wholly below the block comes up to where the block began.
  const below = others.filter((b) => b.page === page && b.top >= bottom);
  const lift = below.length ? Math.min(...below.map((b) => b.top)) - top : 0;
  for (const b of below) tops.set(b.id, { page, top: b.top - lift });

  // 2. Find the line the block goes to, in positions after step 1.
  const shifted = (b: Band) => ({ ...b, top: now(b).top, bottom: now(b).top + (b.bottom - b.top) });
  const t = shifted(target);
  let line: number;
  let from: number;
  if (op.before !== undefined) {
    line = t.top;
    from = t.top;
  } else {
    // After a row means after the whole row: everything that started beside the target
    // (found where they were drawn, since closing the hole may line others up with it).
    const row = others.filter((b) => b.page === target.page && b.top >= target.top && b.top < target.bottom);
    from = Math.max(...row.map((b) => shifted(b).bottom));
    line = from + gap;
  }

  // 3. Make room: what starts at or below the line moves down by the block's height.
  for (const b of others.map(shifted)) {
    if (b.page === t.page && b.top >= from) tops.set(b.id, { page: t.page, top: b.top + height });
  }
  for (const b of block) tops.set(b.id, { page: t.page, top: line + (b.top - top) });
  // Never write a position the layout could not draw.
  if ([...tops.values()].some((p) => !Number.isFinite(p.top))) return "could not work out where the block goes; place it with place instead.";

  const rows = layout.units.rows;
  const followed: string[] = [];
  for (const c of doc.components) {
    const next = tops.get(c.id);
    if (!next || !c.at) continue;
    let p = next.page;
    let y = Math.max(0, next.top);
    // Keep stored positions inside a page, like every other op.
    if (rows !== null && rows > 0 && y >= rows) {
      p += Math.floor(y / rows);
      y %= rows;
    }
    if (p === c.at.page && y === c.at.y) continue;
    c.at = { ...c.at, page: p, y };
    // A box the layout had pushed may only get its drawn position written down: that is not following.
    const drawn = bands.get(c.id) as Band;
    if (!inBlock.has(c.id) && (next.page !== drawn.page || next.top !== drawn.top)) followed.push(c.id);
  }
  const order = [...block].sort((a, b) => a.top - b.top || (layout.components[a.id]?.box.x ?? 0) - (layout.components[b.id]?.box.x ?? 0));
  return { block: order.map((b) => b.id), followed, rows: height, flow: crosses };
}
