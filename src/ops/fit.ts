import type { LayoutResult } from "../layout/types";
import { defaultGrid, type LayoutDocument, type Surface } from "../schema/document";
import { mergeTokens } from "../schema/tokens";
import { diag, type Diagnostic } from "../validate/diagnostics";

export type FitStrategy = "compact" | "heights" | "spacing" | "type";
/** Mildest first: closing space changes nothing on the page itself; smaller text changes the most. */
export const FIT_STRATEGIES: FitStrategy[] = ["compact", "heights", "spacing", "type"];
/**
 * What `fit` uses when the caller names none: only what leaves the page looking the same
 * (empty space closed, boxes no taller than their content). Tighter spacing and smaller
 * type change how the page reads, so they run only when asked for.
 */
export const DEFAULT_FIT_STRATEGIES: FitStrategy[] = ["compact", "heights"];
/** Smallest text scale `type` goes to when the caller gives no `minScale`. */
export const DEFAULT_MIN_SCALE = 0.9;
/** Spacing steps: never below three quarters, and the gap between boxes never closes. */
const SPACING_STEPS = [0.9, 0.75];

interface Slot {
  page: number;
  x: number;
  w: number;
  bottom: number;
}

/**
 * Move components up into the empty space above them: each goes as high as it
 * can without overlapping what is above it in its columns, keeping `gap` units.
 * With `acrossPages`, a component at the top of its page moves to the end of the
 * previous page when it fits there. Nothing moves down. A component split across
 * pages moves by its first piece, which is then taken to fill its page to the bottom
 * (the next layout decides where the rest goes).
 *
 * The result is written as declared positions, so it also settles boxes the
 * layout had pushed: what the layout draws is now what the document says.
 * Returns the ids that moved.
 */
export function compactDocument(
  doc: LayoutDocument,
  layout: LayoutResult,
  options: { only?: Set<string>; page?: number; gap?: number; acrossPages?: boolean } = {},
): string[] {
  const gap = options.gap ?? doc.grid?.gap ?? defaultGrid.gap;
  const byId = new Map(doc.components.map((c) => [c.id, c] as const));
  const items = Object.values(layout.components).sort((a, b) => a.box.page - b.box.page || a.box.y - b.box.y || a.box.x - b.box.x);
  const placed: Slot[] = [];
  const moved: string[] = [];

  for (const g of items) {
    const c = byId.get(g.id);
    const box = g.box;
    const movable =
      !!c?.at && (!options.only || options.only.has(g.id)) && (options.page === undefined || box.page === options.page);
    const split = g.pieces.length > 1;
    const topOn = (page: number) => {
      let top: number | null = null;
      for (const p of placed) {
        if (p.page === page && p.x < box.x + box.w && box.x < p.x + p.w) top = Math.max(top ?? 0, p.bottom + gap);
      }
      return top;
    };
    let y = box.y;
    let page = box.page;
    if (movable) {
      const above = topOn(box.page);
      y = Math.min(box.y, above ?? 0);
      const rowsBefore = layout.pages[box.page - 2]?.rows;
      if (options.acrossPages && !split && above === null && rowsBefore !== undefined) {
        const end = topOn(box.page - 1) ?? 0;
        if (end + box.h <= rowsBefore) {
          page = box.page - 1;
          y = end;
        }
      }
      const at = c.at as NonNullable<typeof c.at>;
      if (y !== at.y || page !== at.page) {
        c.at = { ...at, page, y };
        moved.push(g.id);
      }
    }
    for (const piece of g.pieces) {
      const first = piece === box;
      const pageRows = layout.pages[(first ? page : piece.page) - 1]?.rows ?? Number.POSITIVE_INFINITY;
      const bottom = first && split ? pageRows : (first ? y : piece.y) + piece.h;
      placed.push({ page: first ? page : piece.page, x: piece.x, w: piece.w, bottom });
    }
  }
  return moved;
}

export interface FitOutcome {
  doc: LayoutDocument;
  /** What was applied, in order (e.g. "compact", "spacing ×0.75", "type ×0.91"). */
  steps: string[];
  pages: number;
  fits: boolean;
}

const round = (n: number, step: number) => Math.round(n / step) * step;

/**
 * Try to make the document take at most `target` pages with the strategies the
 * caller chose, mildest first, stopping as soon as it fits:
 * - `compact`: close the empty space above components (see compactDocument);
 * - `heights`: lower minimum heights (`h`) to what the content needs (boxes that fill
 *   their area — KPIs, charts, images — by at most 20%);
 * - `spacing`: tighten the space tokens (padding, gaps inside components) to 90% then 75%, and the
 *   gap between boxes at the 75% step, never below 1 unit;
 * - `type`: scale the text size tokens down in 3% steps, never below `minScale`.
 * Positions are absolute, so space freed by a smaller box stays empty: with `compact`
 * allowed, every later step compacts again. When nothing fits, the original document
 * is returned with `fits: false`.
 */
export function fitDocument(
  input: LayoutDocument,
  target: number,
  strategies: FitStrategy[],
  minScale: number,
  layout: (doc: LayoutDocument) => LayoutResult,
): FitOutcome {
  const pagesOf = (doc: LayoutDocument) => layout(doc).pages.length;
  const settles = strategies.includes("compact");
  /** Close what a step freed, when compacting is allowed. */
  const settle = (next: LayoutDocument) => {
    if (!settles) return next;
    for (let pass = 0; pass < 4; pass++) if (!compactDocument(next, layout(next), { acrossPages: true }).length) break;
    return next;
  };
  let doc = structuredClone(input);
  const steps: string[] = [];
  let pages = pagesOf(doc);
  if (pages <= target) return { doc: input, steps, pages, fits: true };
  const base = mergeTokens(input.tokens);

  for (const strategy of FIT_STRATEGIES.filter((s) => strategies.includes(s))) {
    if (strategy === "compact") {
      const before = JSON.stringify(doc.components);
      settle(doc);
      if (JSON.stringify(doc.components) !== before) steps.push("compact");
      pages = pagesOf(doc);
    } else if (strategy === "heights") {
      const result = layout(doc);
      const unit = result.grid.unit;
      let lowered = 0;
      for (const c of doc.components) {
        const g = result.components[c.id];
        if (!c.at?.h || !g) continue;
        const needs = Math.max(1, Math.ceil(g.needed / unit - 1e-6));
        const floor = g.sizing === "area" ? Math.max(needs, Math.round(c.at.h * 0.8)) : needs;
        if (floor < c.at.h) {
          c.at = { ...c.at, h: floor };
          lowered++;
        }
      }
      if (lowered) {
        settle(doc);
        steps.push("heights");
      }
      pages = pagesOf(doc);
    } else if (strategy === "spacing") {
      const gap = doc.grid?.gap ?? defaultGrid.gap;
      for (const scale of SPACING_STEPS) {
        const next = structuredClone(doc);
        next.grid = { ...(next.grid ?? {}), gap: scale >= 0.9 ? gap : Math.max(Math.min(gap, 1), Math.floor(gap * scale)) };
        next.tokens = { ...(next.tokens ?? {}), space: Object.fromEntries(Object.entries(base.space).map(([k, v]) => [k, Math.round(v * scale)])) };
        doc = settle(next);
        pages = pagesOf(doc);
        steps.push(`spacing ×${scale}`);
        if (pages <= target) break;
      }
    } else {
      for (let scale = 0.97; scale >= minScale - 1e-9; scale -= 0.03) {
        const next = structuredClone(doc);
        next.tokens = { ...(next.tokens ?? {}), size: Object.fromEntries(Object.entries(base.size).map(([k, v]) => [k, round(v * scale, 0.5)])) };
        settle(next);
        const p = pagesOf(next);
        doc = next;
        pages = p;
        if (p <= target) {
          steps.push(`type ×${scale.toFixed(2)}`);
          break;
        }
        if (scale - 0.03 < minScale - 1e-9) steps.push(`type ×${scale.toFixed(2)}`);
      }
    }
    if (pages <= target) return { doc, steps, pages, fits: true };
  }
  return { doc: input, steps, pages, fits: false };
}

/** The page limit a `fit` op aims at: its own `pages`, else the first paged surface's `maxPages`. */
export function fitTarget(doc: LayoutDocument, pages: number | undefined): number | null {
  if (pages !== undefined) return pages;
  const surface = doc.surfaces.find((s): s is Extract<Surface, { kind: "page" }> => s.kind === "page");
  return surface?.maxPages ?? null;
}

export function fitNote(outcome: FitOutcome, target: number, before: number, strategies: readonly FitStrategy[] = FIT_STRATEGIES): Diagnostic {
  if (outcome.fits && !outcome.steps.length) {
    return diag("info", "fit-result", `Already within ${target} page${target === 1 ? "" : "s"}; nothing changed.`, { data: { pages: before, target } });
  }
  if (outcome.fits) {
    return diag("info", "fit-result", `Now ${outcome.pages} page${outcome.pages === 1 ? "" : "s"} (was ${before}), with: ${outcome.steps.join(", ")}.`, {
      data: { pages: outcome.pages, before, target, steps: outcome.steps },
    });
  }
  return diag(
    "warning",
    "fit-failed",
    `Could not fit within ${target} page${target === 1 ? "" : "s"}: the best was ${outcome.pages} with ${outcome.steps.join(", ") || "nothing to try"}. Nothing changed.`,
    {
      data: { pages: outcome.pages, before, target, steps: outcome.steps },
      suggestions: [
        "Shorten or remove content (edit), or raise the page limit.",
        ...(strategies.includes("spacing") && strategies.includes("type")
          ? ["Allow a smaller minScale."]
          : [`For a denser page, allow tighter spacing and smaller type: {"op": "fit", "pages": ${target}, "strategies": ["compact", "heights", "spacing", "type"]}.`]),
      ],
    },
  );
}
