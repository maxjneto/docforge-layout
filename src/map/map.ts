import { defOf } from "../components";
import type { ComponentGeometry, LayoutResult, UnitBox } from "../layout/types";
import type { Component } from "../schema/components";
import { STYLE_PROPS } from "../schema/style";
import type { Diagnostic } from "../validate/diagnostics";
import { drawPage, gutterFor, rulers, type DrawBox } from "./draw";

export type MapLevel = 0 | 1 | 2;

export interface MapOptions {
  level: MapLevel;
  /** Level 2: which components to detail (default: all placed). */
  components?: string[];
  /** Level 1: which pages to show (1-based; default: all). */
  pages?: number[];
  /** Level 1: draw each page (default true). The table and the settings are always there. */
  draw?: boolean;
}

export interface DocumentMap {
  level: MapLevel;
  text: string;
}

const r1 = (n: number) => String(Math.round(n * 10) / 10);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function counts(diagnostics: Diagnostic[]): string {
  const e = diagnostics.filter((d) => d.severity === "error").length;
  const w = diagnostics.filter((d) => d.severity === "warning").length;
  return `${plural(e, "error")}, ${plural(w, "warning")}`;
}

function surfaceLabel(result: LayoutResult): string {
  const s = result.surface;
  if (!s) return "no surface";
  if (s.kind === "continuous") return `${s.id} (continuous, ${Math.round(s.width)}px wide)`;
  const size = typeof s.size === "string" ? s.size : `${Math.round(s.size.width)}×${Math.round(s.size.height)}px`;
  const limit = s.maxPages !== undefined ? ` of ${s.maxPages} max` : "";
  return `${s.id} (${size}, ${plural(result.pages.length, "page")}${limit})`;
}

/** Alerts of one component, compact: `!code` for errors, `~code` for warnings. */
export function alertsFor(id: string, diagnostics: Diagnostic[]): string[] {
  return diagnostics
    .filter((d) => d.component === id && d.severity !== "info")
    .map((d) => `${d.severity === "error" ? "!" : "~"}${d.code}`);
}

/** What the layout did to a component, in a few words. */
export function notesOf(g: ComponentGeometry, piece = 0): string[] {
  const notes: string[] = [];
  if (g.pieces.length > 1) notes.push(`piece ${piece + 1}/${g.pieces.length}`);
  if (piece > 0) return notes;
  if (g.shifted > 0) {
    const from = g.declared.page !== g.box.page ? `p${g.declared.page} y${g.declared.y}` : `y${g.declared.y}`;
    notes.push(`moved ↓${g.shifted} from ${from}${g.pushedBy ? ` (pushed by ${g.pushedBy})` : " (page break)"}`);
  }
  if (g.grew > 0) notes.push(`grew +${g.grew} over h ${g.declared.h}`);
  if (g.clamped) notes.push(`clamped from x${g.declared.x} w${g.declared.w}`);
  return notes;
}

/** Labels shown on a drawn box: the id plus alert marks. */
function boxLabel(id: string, g: ComponentGeometry, piece: number, diagnostics: Diagnostic[]): string {
  const marks = alertsFor(id, diagnostics).map((a) => a[0]);
  const moved = piece === 0 && g.shifted > 0 ? "v" : "";
  const part = g.pieces.length > 1 ? ` ${piece + 1}/${g.pieces.length}` : "";
  const flags = [...new Set(marks)].join("") + moved;
  return `${id}${part}${flags ? ` ${flags}` : ""}`;
}

/** Fixed-width table: columns padded to their widest cell, the last one left free. */
export function table(header: string[], rows: string[][], indent = "  "): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    indent +
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i] as number)))
      .join("  ")
      .trimEnd();
  return [line(header), ...rows.map(line)];
}

export interface ComponentRow {
  id: string;
  page: number;
  piece: number;
  cells: string[];
}

export const ROW_HEADER = ["id", "type", "x", "y", "w", "h", "class", "content", "notes"];

/** One table row per piece of a component, as the map and `find` print them. */
export function componentRows(result: LayoutResult, c: Component, g: ComponentGeometry): ComponentRow[] {
  const summary = defOf(c.type).describe(c as never);
  return g.pieces.map((box: UnitBox, piece) => ({
    id: c.id,
    page: box.page,
    piece,
    cells: [
      c.id,
      c.type,
      String(box.x),
      String(box.y),
      String(box.w),
      String(box.h),
      g.labels.join(",") || "—",
      piece === 0 ? summary : "(continued)",
      [...notesOf(g, piece), ...(piece === 0 ? alertsFor(c.id, result.diagnostics) : [])].join(" · "),
    ],
  }));
}

/** Everything that applies to the whole document, in a few lines. */
export function settingsLines(result: LayoutResult): string[] {
  const doc = result.doc;
  if (!doc) return [];
  const { grid } = result;
  const lines = [`document${doc.meta?.title ? ` "${doc.meta.title}"` : ""} · surface ${surfaceLabel(result)}`];
  const page = result.pages[0];
  if (page) {
    const c = page.content;
    const m = { top: c.y, left: c.x, right: page.width - c.x - c.width, bottom: page.height - c.y - c.height };
    const margins = new Set(Object.values(m).map(r1)).size === 1 ? r1(m.top) : `${r1(m.top)} ${r1(m.right)} ${r1(m.bottom)} ${r1(m.left)}`;
    const rows = result.units.rows === null ? "rows follow the content" : `${result.units.rows} rows`;
    lines.push(
      `page ${r1(page.width)}×${result.units.rows === null ? "auto" : r1(page.height)}px · margins ${margins}px · content ${r1(c.width)}px wide = ${result.units.cols} units × ${rows} · 1 unit = ${grid.unit}px`,
    );
  }
  const guides = result.guides.map((g) => `${g.col}:${g.x}–${g.x + g.w}`).join(" ");
  lines.push(`guides: ${grid.columns} columns, gutter ${grid.gutter}px → ${guides}`);
  const tokenGroups = Object.entries(doc.tokens ?? {})
    .filter(([, v]) => v && Object.keys(v).length)
    .map(([k, v]) => `${k} (${Object.keys(v as object).join(", ")})`);
  lines.push(
    `push gap ${grid.gap} units · locale ${doc.meta?.locale ?? "en-US"} · tokens changed: ${tokenGroups.join("; ") || "none"}`,
  );
  const users = new Map<string, string[]>();
  for (const c of doc.components) for (const l of c.labels ?? []) users.set(l, [...(users.get(l) ?? []), c.id]);
  const classNames = new Set([...Object.keys(doc.styles?.labels ?? {}), ...users.keys()]);
  const classes = [...classNames].map((name) => {
    const who = users.get(name) ?? [];
    const styled = doc.styles?.labels?.[name] ? Object.keys(doc.styles.labels[name] as object).join(",") : "no style";
    return `${name} [${styled}] (${who.length}${who.length ? `: ${who.slice(0, 4).join(", ")}${who.length > 4 ? "…" : ""}` : ""})`;
  });
  lines.push(`classes: ${classes.join(" · ") || "none"}`);
  const docStyles = Object.keys(doc.styles?.document ?? {});
  const regions = (doc.styles?.regions ?? []).map((r) => `${r.id} (${r.page ? `p${r.page} ` : ""}x${r.x} y${r.y} w${r.w} h${r.h})`);
  lines.push(`document styles: ${docStyles.join(", ") || "none"} · regions: ${regions.join(", ") || "none"}`);
  const others = doc.surfaces.filter((s) => s.id !== result.surface?.id).map((s) => s.id);
  if (others.length) lines.push(`other surfaces: ${others.join(", ")}`);
  return lines;
}

function level0(result: LayoutResult): string {
  const doc = result.doc;
  if (!doc) return `invalid document · ${counts(result.diagnostics)}`;
  const byType = new Map<string, number>();
  for (const c of doc.components) byType.set(c.type, (byType.get(c.type) ?? 0) + 1);
  const lines = [
    `document${doc.meta?.title ? ` "${doc.meta.title}"` : ""} · surface ${surfaceLabel(result)} · ${result.units.cols} units wide of ${result.grid.unit}px`,
    `components: ${doc.components.length} (${[...byType].map(([t, n]) => `${t} ${n}`).join(", ") || "none"})`,
  ];
  for (const page of result.pages) {
    const ids = page.boxes.map((b) => (b.piece ? `${b.component} (cont.)` : b.component));
    lines.push(`page ${page.index + 1}: ${ids.join(", ") || "(empty)"}`);
  }
  const unplaced = doc.components.filter((c) => !c.at).map((c) => c.id);
  if (unplaced.length) lines.push(`unplaced: ${unplaced.join(", ")}`);
  lines.push(`issues: ${counts(result.diagnostics)}`);
  return lines.join("\n");
}

function level1(result: LayoutResult, options: MapOptions): string {
  const doc = result.doc;
  if (!doc) return level0(result);
  const byId = new Map(doc.components.map((c) => [c.id, c] as const));
  const lines = [...settingsLines(result)];
  const wanted = options.pages?.length ? new Set(options.pages) : null;

  for (const page of result.pages) {
    const number = page.index + 1;
    if (wanted && !wanted.has(number)) continue;
    const boxes = page.boxes;
    const lowest = Math.max(0, ...boxes.map((b) => Math.round((b.y - page.content.y + b.height) / result.grid.unit)));
    lines.push("", `page ${number}/${result.pages.length} · ${`${boxes.length} box${boxes.length === 1 ? "" : "es"}`} · ${page.rows - lowest} free rows at the bottom`);
    if (options.draw !== false) {
      const gutter = Math.max(4, gutterFor(page.rows));
      const draw: DrawBox[] = [];
      for (const b of boxes) {
        const g = result.components[b.component];
        if (!g) continue;
        const piece = b.piece ?? 0;
        draw.push({ box: g.pieces[piece] ?? g.box, label: boxLabel(b.component, g, piece, result.diagnostics) });
      }
      lines.push(...rulers(result.units.cols, result.guides, gutter), ...drawPage(result.units.cols, page.rows, draw, gutter));
    }
    const rows: string[][] = [];
    for (const b of boxes) {
      const c = byId.get(b.component);
      const g = result.components[b.component];
      if (!c || !g) continue;
      const row = componentRows(result, c, g)[b.piece ?? 0];
      if (row) rows.push(row.cells);
    }
    if (rows.length) lines.push(...table(ROW_HEADER, rows));
  }

  const unplaced = doc.components.filter((c) => !c.at).map((c) => c.id);
  if (unplaced.length) lines.push("", `unplaced (no at): ${unplaced.join(", ")}`);
  const global = result.diagnostics.filter((d) => !d.component && d.severity !== "info");
  if (global.length) lines.push("");
  for (const d of global) lines.push(`${d.severity === "error" ? "!" : "~"} ${d.code}: ${d.message}`);
  lines.push("", `issues: ${counts(result.diagnostics)}`);
  return lines.join("\n");
}

function level2(result: LayoutResult, ids?: string[]): string {
  const doc = result.doc;
  if (!doc) return level0(result);
  const targets = ids?.length ? ids : Object.keys(result.components);
  const blocks: string[] = [];
  for (const id of targets) {
    const g = result.components[id];
    const c = doc.components.find((x) => x.id === id) as Component | undefined;
    if (!g || !c) {
      blocks.push(`${id}: ${c ? "has no position (at)" : "not found"}`);
      continue;
    }
    const d = g.declared;
    const at = (b: UnitBox) => `p${b.page} x${b.x} y${b.y} w${b.w} h${b.h}`;
    const lines = [
      `${id} · ${c.type} (${g.sizing === "content" ? "height from content" : "fills its area"})`,
      `  declared: p${d.page} x${d.x} y${d.y} w${d.w}${d.h !== undefined ? ` h${d.h}` : " (no h)"}`,
      `  drawn: ${g.pieces.map(at).join(" + ")} · ${Math.round(g.area.width)}×${Math.round(g.area.height)}px · needs ${g.needed}px${g.sizing === "area" ? ` · natural ${g.natural}px` : ""}`,
    ];
    const notes = notesOf(g);
    if (notes.length) lines.push(`  layout: ${notes.join(" · ")}`);
    lines.push(`  summary: ${defOf(c.type).describe(c as never)}`);
    if (Object.keys(g.facts).length) lines.push(`  facts: ${JSON.stringify(g.facts)}`);
    if (c.labels?.length) lines.push(`  classes: ${c.labels.join(", ")}`);
    lines.push(`  content: ${JSON.stringify(c.content ?? {})}`);
    if ("props" in c && c.props && Object.keys(c.props).length) lines.push(`  props: ${JSON.stringify(c.props)}`);
    lines.push("  style:");
    for (const prop of STYLE_PROPS) {
      const e = g.style[prop];
      const written = e.written !== undefined && e.written !== e.value ? ` (${String(e.written)})` : "";
      lines.push(`    ${prop}: ${e.value === null ? "none" : String(e.value)}${written} ← ${e.origin}`);
    }
    const own = result.diagnostics.filter((x) => x.component === id);
    if (own.length) {
      lines.push("  diagnostics:");
      for (const x of own) {
        lines.push(`    [${x.severity} ${x.code}] ${x.message}`);
        for (const s of x.suggestions ?? []) lines.push(`      → ${s}`);
      }
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/**
 * A text map of the document for agents. Level 0: outline. Level 1: settings, every
 * page drawn in ASCII and a table of its components. Level 2: components in full.
 */
export function documentMap(result: LayoutResult, options: MapOptions): DocumentMap {
  const text = options.level === 0 ? level0(result) : options.level === 1 ? level1(result, options) : level2(result, options.components);
  return { level: options.level, text };
}
