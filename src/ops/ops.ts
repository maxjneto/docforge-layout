import type { LayoutResult } from "../layout/types";
import type { Component } from "../schema/components";
import { defaultGrid, type LayoutDocument } from "../schema/document";
import type { Placement } from "../schema/placement";
import type { StyleProps } from "../schema/style";
import type { TokenOverrides } from "../schema/tokens";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { editContent, replaceInContent } from "./content";
import { compactDocument, DEFAULT_FIT_STRATEGIES, DEFAULT_MIN_SCALE, fitDocument, fitNote, fitTarget } from "./fit";
import { moveBlock } from "./move";
import { parseOp, type AtInput, type Op } from "./schema";

export type { AtInput, Op } from "./schema";

export interface OpsResult {
  doc: LayoutDocument;
  /** Problems applying the operations themselves (unknown ids…). Layout diagnostics come from the engine. */
  errors: Diagnostic[];
  /** Components the operations touched directly. */
  touched: { components: string[] };
  /** What ops like `fit` want to report (never a refusal). */
  notes: Diagnostic[];
}

export interface OpsContext {
  /** Lay out a document as it stands mid-way through the ops (for `below`, `end` and `cols`). */
  layout: (doc: LayoutDocument) => LayoutResult;
}

function opError(message: string, extra: Partial<Diagnostic> = {}): Diagnostic {
  return diag("error", "invalid-op", message, extra);
}

/**
 * Turn an `at` from an op into a stored position. `current` is the component's
 * position before the op (for `place`), `null` for a new component.
 */
function resolveAt(doc: LayoutDocument, at: AtInput, current: Placement | null, ctx: OpsContext, self: string): Placement | string {
  if (at.below !== undefined && (at.y !== undefined || at.end)) return "use one of y, below or end.";
  if (at.cols && (at.x !== undefined || at.w !== undefined)) return "use cols or x/w, not both.";
  if (at.below === self) return "a component cannot be placed below itself.";

  let layout: LayoutResult | null = null;
  const laid = () => (layout ??= ctx.layout(doc));

  let page = at.page ?? current?.page ?? 1;
  let x = at.x ?? current?.x;
  let w = at.w ?? current?.w;
  let y = at.y ?? current?.y;
  const gap = at.gap ?? doc.grid?.gap ?? defaultGrid.gap;

  if (at.cols) {
    const [first, last] = at.cols;
    const guides = laid().guides;
    const a = guides.find((g) => g.col === first);
    const b = guides.find((g) => g.col === last);
    if (!a || !b || last < first) return `cols [${first}, ${last}] must be guide columns 1–${guides.length}, first ≤ last.`;
    x = a.x;
    w = b.x + b.w - a.x;
  }

  if (at.below !== undefined) {
    const ref = laid().components[at.below];
    if (!ref) return `"${at.below}" (below) is not a placed component.`;
    const lastPiece = ref.pieces[ref.pieces.length - 1] ?? ref.box;
    page = lastPiece.page;
    y = lastPiece.y + lastPiece.h + gap;
    if (at.x === undefined && !at.cols) x = ref.box.x;
    if (at.w === undefined && !at.cols) w = ref.box.w;
  } else if (at.end) {
    const result = laid();
    const target = at.page ?? Math.max(1, result.pages.length);
    page = target;
    const bottoms = Object.values(result.components)
      .filter((g) => g.id !== self)
      .flatMap((g) => g.pieces)
      .filter((b) => b.page === target)
      .map((b) => b.y + b.h);
    y = bottoms.length ? Math.max(...bottoms) + gap : 0;
  }

  if (x === undefined) x = 0;
  if (w === undefined) return "give w (or cols, or below) for a new component.";
  if (y === undefined) return "give y (or below, or end) for a new component.";

  // Keep stored positions inside a page: y past the bottom goes to the next page.
  const rows = laid().units.rows;
  if (rows !== null && rows > 0 && y >= rows) {
    page += Math.floor(y / rows);
    y %= rows;
  }

  const h = at.h === null ? undefined : (at.h ?? current?.h);
  return { page, x, y, w, ...(h !== undefined ? { h } : {}) };
}

/** Split `n` whole columns by `weights`, each at least 1 (largest remainders get the rest). */
export function splitColumns(n: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / total) * n);
  const counts = raw.map((r) => Math.max(1, Math.floor(r)));
  let left = n - counts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) counts[(order[k] as { i: number }).i]! += 1;
  // Too many forced 1s: take back from the widest.
  while (left < 0) {
    const widest = counts.indexOf(Math.max(...counts));
    counts[widest]! -= 1;
    left++;
  }
  return counts;
}

type RowOp = Extract<Op, { op: "row" }>;

/** Lay out a row (see the `row` op). Returns the ids it placed, or a message. */
function placeRow(doc: LayoutDocument, op: RowOp, ctx: OpsContext): string[] | string {
  const ids = op.items.map((item) => (typeof item === "string" ? item : item.id));
  if (new Set(ids).size !== ids.length) return "an item appears twice in the row.";
  for (const item of op.items) {
    const exists = doc.components.some((c) => c.id === (typeof item === "string" ? item : item.id));
    if (typeof item === "string" && !exists) return `Component "${item}" does not exist.`;
    if (typeof item !== "string" && exists) return `Component "${item.id}" already exists; pass its id to move it.`;
  }
  if (op.below !== undefined && ids.includes(op.below)) return `"${op.below}" is in the row; place the row below something else.`;
  if (op.widths && op.widths.length !== ids.length) return `widths has ${op.widths.length} values for ${ids.length} items.`;

  const guides = ctx.layout(doc).guides;
  const [first, last] = op.cols ?? [1, guides.length];
  if (!guides.find((g) => g.col === first) || !guides.find((g) => g.col === last) || last < first) {
    return `cols [${first}, ${last}] must be guide columns 1–${guides.length}, first ≤ last.`;
  }
  const span = last - first + 1;
  if (span < ids.length) return `${ids.length} items do not fit in ${span} guide column${span === 1 ? "" : "s"}; widen cols or use fewer items.`;
  const counts = splitColumns(span, op.widths ?? ids.map(() => 1));

  // The row's page and y: resolved once, like an `add` of the first item.
  const anchor = resolveAt(doc, { page: op.page, y: op.y, below: op.below, end: op.end, gap: op.gap, cols: [first, first] }, null, ctx, ids[0] as string);
  if (typeof anchor === "string") return anchor;

  let col = first;
  ids.forEach((id, i) => {
    const a = guides.find((g) => g.col === col) as { x: number };
    const endCol = col + (counts[i] as number) - 1;
    const b = guides.find((g) => g.col === endCol) as { x: number; w: number };
    col = endCol + 1;
    const item = op.items[i] as (typeof op.items)[number];
    const existing = doc.components.find((c) => c.id === id);
    const h = op.h ?? (existing?.at?.h as number | undefined);
    const at = { page: anchor.page, x: a.x, y: anchor.y, w: b.x + b.w - a.x, ...(h !== undefined ? { h } : {}) };
    if (existing) existing.at = at;
    else doc.components.push({ ...structuredClone(item as Component), at } as Component);
  });

  if (op.align === "stretch") {
    const laid = ctx.layout(doc);
    const tallest = Math.max(...ids.map((id) => laid.components[id]?.box.h ?? 0));
    if (tallest > 0) for (const c of doc.components) if (ids.includes(c.id) && c.at) c.at = { ...c.at, h: tallest };
  }
  return ids;
}

type PageOp = Extract<Op, { op: "page" }>;

/** Insert, duplicate, remove or move a page (see the `page` op). Returns the ids it moved or created, or a message. */
function pageOp(doc: LayoutDocument, op: PageOp, ctx: OpsContext): string[] | string {
  const declaredPages = doc.components.map((c) => c.at?.page ?? 1);
  const count = Math.max(ctx.layout(doc).pages.length, 1, ...declaredPages);
  const { action, page } = op;
  if (action === "insert" ? page > count : page < 1 || page > count) {
    return action === "insert" ? `page must be 0–${count} (0 inserts before the first).` : `page must be 1–${count}.`;
  }
  const moved: string[] = [];
  /** Re-number every declared page with `map` (regions bound to a page too). */
  const renumber = (map: (p: number) => number) => {
    for (const c of doc.components) {
      if (!c.at) continue;
      const next = map(c.at.page);
      if (next !== c.at.page) {
        c.at = { ...c.at, page: next };
        moved.push(c.id);
      }
    }
    for (const r of doc.styles?.regions ?? []) if (r.page !== undefined) r.page = map(r.page);
  };
  switch (action) {
    case "insert":
      renumber((p) => (p > page ? p + 1 : p));
      return moved;
    case "remove": {
      const gone = new Set(doc.components.filter((c) => (c.at?.page ?? 1) === page).map((c) => c.id));
      doc.components = doc.components.filter((c) => !gone.has(c.id));
      if (doc.styles?.regions) doc.styles.regions = doc.styles.regions.filter((r) => r.page !== page);
      renumber((p) => (p > page ? p - 1 : p));
      return moved;
    }
    case "move": {
      const to = op.to;
      if (to === undefined || to > count) return `give to: 1–${count}.`;
      if (to === page) return [];
      renumber((p) => {
        if (p === page) return to;
        if (page < to && p > page && p <= to) return p - 1;
        if (to < page && p >= to && p < page) return p + 1;
        return p;
      });
      return moved;
    }
    case "duplicate": {
      const source = doc.components.filter((c) => (c.at?.page ?? 1) === page);
      renumber((p) => (p > page ? p + 1 : p));
      const taken = new Set(doc.components.map((c) => c.id));
      const fresh = (id: string) => {
        const base = id.replace(/-\d+$/, "");
        let n = 2;
        while (taken.has(`${base}-${n}`)) n++;
        taken.add(`${base}-${n}`);
        return `${base}-${n}`;
      };
      const copies = source.map((c) => ({ ...structuredClone(c), id: fresh(c.id), at: { ...(c.at as Placement), page: page + 1 } }) as Component);
      doc.components.push(...copies);
      for (const r of [...(doc.styles?.regions ?? [])]) {
        if (r.page === page) doc.styles!.regions!.push({ ...structuredClone(r), id: fresh(r.id), page: page + 1 });
      }
      return [...moved, ...copies.map((c) => c.id)];
    }
  }
}

/** Convert every position to a new unit size, keeping sizes in px. */
function rescale(doc: LayoutDocument, from: number, to: number): void {
  const f = from / to;
  const scale = (n: number) => Math.round(n * f);
  const size = (n: number) => Math.max(1, Math.round(n * f));
  for (const c of doc.components) {
    if (!c.at) continue;
    c.at = { page: c.at.page, x: scale(c.at.x), y: scale(c.at.y), w: size(c.at.w), ...(c.at.h !== undefined ? { h: size(c.at.h) } : {}) };
  }
  for (const r of doc.styles?.regions ?? []) {
    r.x = scale(r.x);
    r.y = scale(r.y);
    r.w = size(r.w);
    r.h = size(r.h);
  }
}

/** Stretch or squeeze every x and w (and regions) by `f`, keeping edges that met still meeting. Returns the ids changed. */
function rescaleWidth(doc: LayoutDocument, f: number): string[] {
  const changed: string[] = [];
  const span = (x: number, w: number) => {
    const start = Math.round(x * f);
    return { x: start, w: Math.max(1, Math.round((x + w) * f) - start) };
  };
  for (const c of doc.components) {
    if (!c.at) continue;
    const next = span(c.at.x, c.at.w);
    if (next.x !== c.at.x || next.w !== c.at.w) {
      c.at = { ...c.at, ...next };
      changed.push(c.id);
    }
  }
  for (const r of doc.styles?.regions ?? []) Object.assign(r, span(r.x, r.w));
  return changed;
}

/**
 * Apply operations to a copy of the document. Pure: the input is never mutated.
 * Each op's shape is checked first (callers send JSON), so a malformed op is an
 * `invalid-op` error, not an exception.
 */
export function applyOps(input: LayoutDocument, ops: readonly unknown[], ctx: OpsContext): OpsResult {
  const doc = structuredClone(input);
  const errors: Diagnostic[] = [];
  const touched: string[] = [];
  const notes: Diagnostic[] = [];
  const component = (id: string) => doc.components.find((c) => c.id === id);

  ops.forEach((raw, index) => {
    const parsed = parseOp(raw);
    if (!parsed.ok) {
      const name = (raw as { op?: unknown } | null)?.op;
      errors.push(opError(`op ${index + 1}${typeof name === "string" ? ` (${name})` : ""}: ${parsed.message}`));
      return;
    }
    const op = parsed.op;
    const before = errors.length;
    switch (op.op) {
      case "add": {
        if (component(op.component.id)) {
          errors.push(opError(`Component "${op.component.id}" already exists; use "update" or "place".`, { component: op.component.id }));
          break;
        }
        const at = resolveAt(doc, op.at, null, ctx, op.component.id);
        if (typeof at === "string") {
          errors.push(opError(at, { component: op.component.id }));
          break;
        }
        doc.components.push({ ...structuredClone(op.component), at } as Component);
        touched.push(op.component.id);
        break;
      }
      case "place": {
        const c = component(op.component);
        if (!c) {
          errors.push(opError(`Component "${op.component}" does not exist.`, { component: op.component }));
          break;
        }
        const at = resolveAt(doc, op.at, c.at ?? null, ctx, c.id);
        if (typeof at === "string") {
          errors.push(opError(at, { component: c.id }));
          break;
        }
        c.at = at;
        touched.push(c.id);
        break;
      }
      case "update": {
        const c = component(op.component) as (Component & { props?: Record<string, unknown>; style?: StyleProps }) | undefined;
        if (!c) {
          errors.push(opError(`Component "${op.component}" does not exist.`, { component: op.component }));
          break;
        }
        if (op.content !== undefined) (c as { content: unknown }).content = structuredClone(op.content);
        if (op.props === null) delete c.props;
        else if (op.props !== undefined) c.props = { ...(c.props ?? {}), ...op.props };
        if (op.labels !== undefined) c.labels = [...op.labels];
        if (op.style === null) delete c.style;
        else if (op.style !== undefined) c.style = { ...(c.style ?? {}), ...op.style };
        touched.push(c.id);
        break;
      }
      case "row": {
        const placed = placeRow(doc, op, ctx);
        if (typeof placed === "string") {
          errors.push(opError(placed));
          break;
        }
        touched.push(...placed);
        break;
      }
      case "edit": {
        const c = component(op.component) as (Component & { content?: unknown }) | undefined;
        if (!c) {
          errors.push(opError(`Component "${op.component}" does not exist.`, { component: op.component }));
          break;
        }
        const next = editContent(c.content, op.set, op.remove);
        if ("error" in next) {
          errors.push(opError(next.error, { component: c.id }));
          break;
        }
        (c as { content: unknown }).content = next.content;
        touched.push(c.id);
        break;
      }
      case "replaceText": {
        const unknown = (op.components ?? []).filter((id) => !component(id));
        if (unknown.length) {
          errors.push(opError(`Component(s) ${unknown.map((id) => `"${id}"`).join(", ")} do not exist.`));
          break;
        }
        const scope = op.components ? new Set(op.components) : null;
        const hits: string[] = [];
        let total = 0;
        for (const c of doc.components as (Component & { content?: unknown })[]) {
          if (scope && !scope.has(c.id)) continue;
          if (c.content === undefined) continue;
          const { content, count } = replaceInContent(c.content, op.find, op.replace, op.matchCase ?? true);
          if (!count) continue;
          (c as { content: unknown }).content = content;
          total += count;
          hits.push(c.id);
          touched.push(c.id);
        }
        if (!total) {
          errors.push(opError(`"${op.find}" was not found${scope ? ` in ${[...scope].join(", ")}` : ""}; nothing was replaced.`));
          break;
        }
        notes.push(diag("info", "text-replaced", `Replaced ${total}× in ${hits.join(", ")}.`, { data: { count: total, components: hits } }));
        break;
      }
      case "move": {
        const moved = moveBlock(doc, op, ctx.layout(doc));
        if (typeof moved === "string") {
          errors.push(opError(moved, { component: op.component }));
          break;
        }
        // The followers moved because they were asked to make room: part of the op, not a side effect.
        touched.push(...moved.block, ...moved.followed);
        const where = op.before !== undefined ? `before ${op.before}` : `after ${op.after}`;
        const rest = moved.followed.length ? `; ${moved.followed.length} other component(s) followed (${moved.followed.join(", ")})` : "";
        notes.push(
          diag("info", "move-result", `Moved ${moved.block.join(", ")} ${where} (${moved.rows} rows)${rest}.`, {
            data: { block: moved.block, followed: moved.followed, rows: moved.rows },
          }),
        );
        break;
      }
      case "remove": {
        if (!component(op.component)) {
          errors.push(opError(`Component "${op.component}" does not exist.`, { component: op.component }));
          break;
        }
        doc.components = doc.components.filter((c) => c.id !== op.component);
        break;
      }
      case "setStyle": {
        doc.styles ??= {};
        if (op.layer === "document") {
          doc.styles.document ??= {};
          if (op.style === null) delete doc.styles.document[op.selector];
          else doc.styles.document[op.selector] = { ...(doc.styles.document[op.selector] ?? {}), ...op.style };
        } else {
          doc.styles.labels ??= {};
          if (op.style === null) delete doc.styles.labels[op.label];
          else doc.styles.labels[op.label] = { ...(doc.styles.labels[op.label] ?? {}), ...op.style };
        }
        break;
      }
      case "setRegion": {
        doc.styles ??= {};
        const regions = (doc.styles.regions ??= []);
        const existing = regions.findIndex((r) => r.id === op.region.id);
        if (existing === -1) regions.push(structuredClone(op.region));
        else regions[existing] = structuredClone(op.region);
        break;
      }
      case "removeRegion": {
        if (doc.styles?.regions) doc.styles.regions = doc.styles.regions.filter((r) => r.id !== op.region);
        break;
      }
      case "setTokens": {
        doc.tokens ??= {};
        for (const [group, values] of Object.entries(op.tokens)) {
          const key = group as keyof TokenOverrides;
          doc.tokens[key] = { ...(doc.tokens[key] ?? {}), ...(values as object) } as never;
        }
        break;
      }
      case "setGrid": {
        const current = doc.grid?.unit ?? defaultGrid.unit;
        if (op.grid.unit !== undefined && op.grid.unit !== current) rescale(doc, current, op.grid.unit);
        doc.grid = { ...(doc.grid ?? {}), ...op.grid };
        break;
      }
      case "setSurface": {
        const colsBefore = op.fitWidth ? ctx.layout(doc).units.cols : 0;
        const existing = doc.surfaces.findIndex((s) => s.id === op.surface.id);
        const surface = structuredClone(op.surface);
        if (existing === -1) doc.surfaces.push(surface);
        else doc.surfaces[existing] = surface;
        if (op.primary) doc.surfaces = [surface, ...doc.surfaces.filter((s) => s !== surface)];
        // The primary surface sets the width positions are written for: keep them in proportion.
        if (op.fitWidth && doc.surfaces[0] === surface) {
          const colsAfter = ctx.layout(doc).units.cols;
          if (colsBefore > 0 && colsAfter > 0 && colsAfter !== colsBefore) {
            touched.push(...rescaleWidth(doc, colsAfter / colsBefore));
          }
        }
        break;
      }
      case "compact": {
        const unknown = (op.components ?? []).filter((id) => !component(id));
        if (unknown.length) {
          errors.push(opError(`Component(s) ${unknown.map((id) => `"${id}"`).join(", ")} do not exist.`));
          break;
        }
        const only = op.components ? new Set(op.components) : undefined;
        touched.push(...compactDocument(doc, ctx.layout(doc), { only, page: op.page, gap: op.gap, acrossPages: op.acrossPages }));
        break;
      }
      case "fit": {
        const target = fitTarget(doc, op.pages);
        if (target === null) {
          errors.push(opError("Give `pages`, or set maxPages on the page surface."));
          break;
        }
        const pagesBefore = ctx.layout(doc).pages.length;
        const strategies = op.strategies ?? DEFAULT_FIT_STRATEGIES;
        const outcome = fitDocument(doc, target, strategies, op.minScale ?? DEFAULT_MIN_SCALE, ctx.layout);
        notes.push(fitNote(outcome, target, pagesBefore, strategies));
        if (outcome.fits && outcome.steps.length) {
          // Every component may have moved or changed size: that was the point, so none of it is a side effect.
          touched.push(...outcome.doc.components.map((c) => c.id));
          Object.assign(doc, outcome.doc);
          if (!outcome.doc.tokens) delete doc.tokens;
          if (!outcome.doc.grid) delete doc.grid;
        }
        break;
      }
      case "setMeta": {
        const meta: Record<string, unknown> = { ...(doc.meta ?? {}) };
        for (const [key, value] of Object.entries(op.meta)) {
          if (value === null) delete meta[key];
          else if (value !== undefined) meta[key] = value;
        }
        if (Object.keys(meta).length) doc.meta = meta as LayoutDocument["meta"];
        else delete doc.meta;
        break;
      }
      case "page": {
        const result = pageOp(doc, op, ctx);
        if (typeof result === "string") errors.push(opError(result));
        else touched.push(...result);
        break;
      }
      case "removeSurface": {
        if (!doc.surfaces.some((s) => s.id === op.surface)) errors.push(opError(`Surface "${op.surface}" does not exist.`));
        else if (doc.surfaces.length === 1) errors.push(opError("A document needs at least one surface."));
        else doc.surfaces = doc.surfaces.filter((s) => s.id !== op.surface);
        break;
      }
    }
    for (let i = before; i < errors.length; i++) {
      const e = errors[i] as Diagnostic;
      e.message = `op ${index + 1} (${op.op}): ${e.message}`;
    }
  });

  return { doc, errors, touched: { components: [...new Set(touched)] }, notes };
}
