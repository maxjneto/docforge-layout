import type { ComponentGeometry, LayoutResult, UnitBox } from "../layout/types";
import { componentRows, ROW_HEADER, table } from "../map/map";
import type { Component, ComponentType } from "../schema/components";

export type FindState = "error" | "warning" | "moved" | "grew" | "split" | "clamped" | "tight";

/** Every filter is optional; a component must match all the ones given. */
export interface FindQuery {
  /** Words in the content (case and accents ignored). */
  text?: string;
  type?: ComponentType | ComponentType[];
  /** A class (label). */
  label?: string;
  /** 1-based page the component (or a piece of it) is drawn on. */
  page?: number;
  /** Components whose drawn box intersects this area (units). */
  rect?: { page?: number; x: number; y: number; w: number; h: number };
  state?: FindState;
}

export interface FindMatch {
  id: string;
  type: ComponentType;
  box: UnitBox;
  pieces: UnitBox[];
  /** For `text`: the words around the first hit. */
  excerpt?: string;
}

export interface FindResult {
  matches: FindMatch[];
  text: string;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/** Every string inside a component's content, in reading order. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

function excerptAround(haystack: string, needle: string): string | undefined {
  const index = fold(haystack).indexOf(needle);
  if (index === -1) return undefined;
  const start = Math.max(0, index - 30);
  const end = Math.min(haystack.length, index + needle.length + 30);
  return `${start > 0 ? "…" : ""}${haystack.slice(start, end)}${end < haystack.length ? "…" : ""}`;
}

function inState(g: ComponentGeometry, state: FindState, result: LayoutResult): boolean {
  switch (state) {
    case "error":
    case "warning":
      return result.diagnostics.some((d) => d.component === g.id && d.severity === state);
    case "moved":
      return g.shifted > 0;
    case "grew":
      return g.grew > 0;
    case "split":
      return g.pieces.length > 1;
    case "clamped":
      return g.clamped;
    case "tight":
      return g.declared.h !== undefined && g.needed >= 0.95 * g.declared.h * result.grid.unit;
  }
}

const intersects = (b: UnitBox, r: NonNullable<FindQuery["rect"]>) =>
  (r.page === undefined || r.page === b.page) && b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h;

/** Components matching every filter, with the same table rows the map prints. */
export function findComponents(result: LayoutResult, query: FindQuery): FindResult {
  const doc = result.doc;
  if (!doc) return { matches: [], text: "invalid document" };
  const types = query.type === undefined ? null : new Set(Array.isArray(query.type) ? query.type : [query.type]);
  const needle = query.text ? fold(query.text.trim()) : "";

  const matches: FindMatch[] = [];
  const rows: string[][] = [];
  const excerpts: string[] = [];
  for (const c of doc.components as Component[]) {
    const g = result.components[c.id];
    if (!g) continue;
    if (types && !types.has(c.type)) continue;
    if (query.label && !(c.labels ?? []).includes(query.label)) continue;
    if (query.page !== undefined && !g.pieces.some((b) => b.page === query.page)) continue;
    if (query.rect && !g.pieces.some((b) => intersects(b, query.rect as NonNullable<FindQuery["rect"]>))) continue;
    if (query.state && !inState(g, query.state, result)) continue;
    let excerpt: string | undefined;
    if (needle) {
      const hit = strings(c.content).find((s) => fold(s).includes(needle));
      if (hit === undefined) continue;
      excerpt = excerptAround(hit, needle);
    }
    matches.push({ id: c.id, type: c.type, box: g.box, pieces: g.pieces, ...(excerpt ? { excerpt } : {}) });
    const first = componentRows(result, c, g)[0];
    if (first) rows.push([`p${g.box.page}`, ...first.cells]);
    if (excerpt) excerpts.push(`  ${c.id}: "${excerpt}"`);
  }

  const lines = [`${matches.length} match${matches.length === 1 ? "" : "es"}`];
  if (rows.length) lines.push(...table(["page", ...ROW_HEADER], rows));
  if (excerpts.length) lines.push("found:", ...excerpts);
  return { matches, text: lines.join("\n") };
}
