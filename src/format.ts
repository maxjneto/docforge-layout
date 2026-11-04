/**
 * Format versions: reading any version this library knows, and writing a document
 * down for an older library.
 *
 * Rule: every change that makes the schema accept something an older library would
 * refuse raises `VERSION`, and the release that raises it adds the step that goes
 * one version down (`DOWN_STEPS`). Only the newer library can write the older
 * format, so the conversion down runs where the newest library is (the DocForge
 * server, before it answers); the older library only reads.
 *
 * History:
 * - 1: sections → bands → items (0.1–0.2). Read with `upgradeDocument`.
 * - 2: free positions in units (0.3).
 * - 3: the `Slide` page size (0.4; 0.4.0 still wrote 2).
 * - 4: `styles` per part on a component, and the `table.zebra` / `steps.number` parts; tables
 *   sized by content (`columnWidths`), with a footer, spanning cells and bars (0.8).
 */

import { defaultTokens } from "./schema/tokens";
import { DocumentSchema, SAME_SHAPE_VERSIONS, VERSION, type LayoutDocument } from "./schema/document";
import type { LayoutResult } from "./layout/types";
import { consoleLogger, type Logger } from "./log";
import { upgradeDocument } from "./upgrade";
import { paragraphOf } from "./components/flow";
import type { OutlineEntry } from "./components";
import { outlineOf } from "./layout/measure";
import type { Component } from "./schema/components";

/** Versions this library reads (1 through `upgradeDocument`). */
export const READABLE_FORMATS = [1, ...SAME_SHAPE_VERSIONS] as const;
/** The oldest version `downgradeDocument` can produce. */
export const OLDEST_DOWNGRADE = 2;

/** The `version` of a document, or null when it is not a layout document at all. */
export function formatOf(input: unknown): number | null {
  if (!input || typeof input !== "object") return null;
  const v = (input as { version?: unknown }).version;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}

export interface DowngradeResult {
  ok: boolean;
  /** The document in the target version; its type is the older schema, so `unknown`. */
  doc: Record<string, unknown> | null;
  from: number | null;
  to: number;
  /** What the older format cannot say, one line each. Empty when nothing was lost. */
  notes: string[];
}

type Json = Record<string, unknown>;

const SLIDE = { width: 1280, height: 720 };
const NEW_IN_3_FAMILIES = ["Source Serif 4", "Space Grotesk"];

function walkStrings(value: unknown, visit: (s: string) => void): void {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) value.forEach((v) => walkStrings(v, visit));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => walkStrings(v, visit));
}

const bolded = (inline: unknown): unknown =>
  typeof inline === "string" ? (inline.trim() ? `**${inline}**` : inline) : Array.isArray(inline) ? inline.map((r) => ({ ...(r as Json), bold: true })) : inline;

/** A row of version 4 cells as version 3 cells: a spanning cell becomes its text and empty cells. */
function downCells(cells: unknown[]): { cells: unknown[]; spanned: boolean } {
  let spanned = false;
  const out: unknown[] = [];
  for (const cell of cells) {
    if (cell && typeof cell === "object" && !Array.isArray(cell)) {
      const { text, span } = cell as { text: unknown; span?: number };
      out.push(text);
      for (let i = 1; i < (span ?? 1); i++) out.push("");
      if ((span ?? 1) > 1 || (cell as Json).align !== undefined) spanned = true;
    } else out.push(cell);
  }
  return { cells: out, spanned };
}

const NEW_IN_4_TYPES = new Set(["flow", "callout", "tags", "progress", "cover", "toc"]);
const NEW_IN_4_SELECTORS = new Set(["table.zebra", "table.footer", "steps.number", "text.display", "image.caption"]);
const NEW_CHART_KIND: Record<string, string> = { donut: "pie", area: "line", scatter: "bar" };

/**
 * A flow becomes its blocks as components, all declared at the flow's position: version 3
 * pushes each one below the one before it, so they stack in order without measuring.
 */
function expandFlows(components: Json[], notes: string[]): Json[] {
  return components.flatMap((c) => {
    if (c.type !== "flow") return [c];
    const blocks = (c.content as { blocks: unknown[] }).blocks;
    const at = c.at as Json | undefined;
    const out: Json[] = [];
    let paragraphs: Json[] = [];
    let breaks = 0;
    // The flow's minimum height is not any one block's: each block keeps only its own h.
    const { h: _flowH, ...position } = at ?? {};
    const place = (extra: Json = {}) => (at ? { at: { ...position, ...extra } } : {});
    const flush = () => {
      if (!paragraphs.length) return;
      out.push({ id: `${String(c.id)}-${out.length + 1}`, type: "text", content: { paragraphs }, ...place(), ...(c.labels ? { labels: c.labels } : {}) });
      paragraphs = [];
    };
    for (const block of blocks) {
      if (typeof block === "string") {
        const { role, text } = paragraphOf(block);
        paragraphs.push(role === "body" ? { text } : { role, text });
        continue;
      }
      flush();
      const b = block as Json;
      if (b.type === "break") {
        breaks++;
        continue;
      }
      const { h, id, ...rest } = b;
      out.push({ ...rest, id: (id as string | undefined) ?? `${String(c.id)}-${out.length + 1}`, ...place(h !== undefined ? { h } : {}), ...(c.labels ? { labels: c.labels } : {}) });
    }
    flush();
    notes.push(`"${String(c.id)}": the flow became ${out.length} components stacked at its position${breaks ? `; ${breaks} page break(s) were dropped` : ""} (version 3 has no flow)`);
    return out;
  });
}

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One component of version 4 written for version 3 (only what version 3 cannot say changes). */
function downComponent4(c: Json, notes: string[], outline: OutlineEntry[]): Json {
  const id = `"${String(c.id)}"`;
  const props = (c.props ?? {}) as Json;
  if (c.type === "cover") {
    const { eyebrow, title, subtitle, meta } = c.content as { eyebrow?: string; title: string; subtitle?: string; meta?: { label: string; value: string }[] };
    const lines = [subtitle, ...(meta ?? []).map((m) => `**${m.label}:** ${m.value}`)].filter(Boolean);
    const bg = props.background;
    notes.push(`${id}: the cover became a card${props.fullBleed ? " (its background no longer reaches the page's edges)" : ""}`);
    return {
      ...c,
      type: "card",
      content: { ...(eyebrow ? { eyebrow } : {}), title, ...(lines.length ? { text: lines.join("\n") } : {}) },
      props: {},
      ...(typeof bg === "string" ? { style: { ...((c.style as Json | undefined) ?? {}), background: bg } } : {}),
    };
  }
  if (c.type === "toc") {
    const levels = (props.levels as string[] | undefined) ?? ["title-1", "title-2"];
    const from = (props.from as number | undefined) ?? ((c.at as { page?: number } | undefined)?.page ?? 0) + 1;
    const titles = outline.filter((e) => levels.includes(e.role) && e.page >= from).map((e) => e.text);
    notes.push(`${id}: the table of contents became a numbered list of its ${titles.length} titles, without page numbers`);
    return { ...c, type: "list", content: { items: titles.length ? titles : ["—"] }, props: { marker: "number" } };
  }
  if (c.type === "chart") {
    const content = c.content as { kind: string; categories?: string[]; series: Json[] };
    const { orientation, stacked, legendPosition, grid, axis, colors, center, ...kept } = props;
    const dropped = Object.entries({ orientation, stacked, legendPosition, grid, axis, colors, center }).filter(([, v]) => v !== undefined).map(([k]) => k);
    let next: Json = { ...c, props: kept };
    const kind = NEW_CHART_KIND[content.kind];
    if (kind) {
      notes.push(`${id}: the ${content.kind} chart became a ${kind} chart`);
      if (content.kind === "scatter") {
        const xs = [...new Set(content.series.flatMap((s) => (s.points as [number, number][]).map((p) => p[0])))].sort((a, b) => a - b);
        const series = content.series.map((s) => ({ name: s.name, values: xs.map((x) => (s.points as [number, number][]).find((p) => p[0] === x)?.[1] ?? 0) }));
        next = { ...next, content: { kind, categories: xs.map(String), series } };
      } else next = { ...next, content: { ...content, kind } };
    }
    if (dropped.length) notes.push(`${id}: chart options ${dropped.join(", ")} were dropped`);
    return next;
  }
  if (c.type === "callout") {
    const { title, text } = c.content as { title?: string; text: unknown };
    const kind = (props.kind as string | undefined) ?? "note";
    notes.push(`${id}: the callout became a card`);
    return { ...c, type: "card", content: { eyebrow: capitalized(kind), title: title ?? capitalized(kind), text }, props: {} };
  }
  if (c.type === "tags") {
    const items = (c.content as { items: (string | { text: string })[] }).items.map((i) => (typeof i === "string" ? i : i.text));
    notes.push(`${id}: the tags became a line of text`);
    return { ...c, type: "text", content: { paragraphs: [items.join(" · ")] }, props: {} };
  }
  if (c.type === "progress") {
    const kind = (props.kind as string | undefined) ?? "bar";
    const items = (c.content as { items: { label: string; value: number; max?: number; text?: string }[] }).items;
    notes.push(`${id}: the progress bars became a table`);
    return {
      ...c,
      type: "table",
      content: { columns: ["", ""], rows: items.map((i) => [i.label, i.text ?? `${i.value}/${i.max ?? (kind === "bar" ? 100 : 5)}`]) },
      props: { header: false },
    };
  }
  if (c.type === "text") {
    const content = c.content as { paragraphs: unknown[] };
    let display = false;
    const paragraphs = content.paragraphs.map((p) => {
      if (p && typeof p === "object" && (p as Json).role === "display") {
        display = true;
        return { ...(p as Json), role: "title-1" };
      }
      return p;
    });
    const role = props.role === "display" ? "title-1" : props.role;
    if (display || props.role === "display") notes.push(`${id}: the display role became title-1`);
    return { ...c, content: { ...content, paragraphs }, ...(c.props ? { props: { ...props, ...(role !== undefined ? { role } : {}) } } : {}) };
  }
  if (c.type === "image") {
    const { caption, ...content } = c.content as Json;
    const { figure, href, ...kept } = props;
    if (caption !== undefined || figure !== undefined || href !== undefined) notes.push(`${id}: the image's caption, figure number and link were dropped`);
    return { ...c, content, ...(c.props ? { props: kept } : {}) };
  }
  if (c.type === "kpi") {
    const { sparkline, ...content } = c.content as Json;
    if (sparkline !== undefined) notes.push(`${id}: the KPI's sparkline was dropped`);
    return { ...c, content };
  }
  if (c.type === "table") {
    const content = c.content as { columns: unknown[]; rows: unknown[][]; footer?: unknown[] };
    const { columnWidths, bars, ...tableProps } = props;
    const weighted = content.columns.some((col) => typeof col === "object" && col !== null && (col as Json).width !== undefined);
    if (columnWidths === "auto" || (columnWidths === undefined && !weighted)) notes.push(`${id}: columns sized by their content become even columns (version 3 splits a table evenly)`);
    if (bars !== undefined) notes.push(`${id}: the bars in column ${JSON.stringify(bars)} were dropped`);
    let spanned = false;
    const rows = content.rows.map((row) => {
      const r = downCells(row);
      spanned ||= r.spanned;
      return r.cells;
    });
    if (content.footer) {
      const f = downCells(content.footer);
      rows.push(f.cells.map(bolded));
      notes.push(`${id}: the footer became a last row in bold`);
    }
    if (spanned) notes.push(`${id}: cells spanning columns (or aligned on their own) became plain cells`);
    const { footer: _footer, ...rest } = content;
    return { ...c, content: { ...rest, rows }, ...(c.props ? { props: tableProps } : {}) };
  }
  return c;
}

/** Each step takes a document of version `n` and returns it in version `n - 1`. */
const DOWN_STEPS: Record<number, (doc: Json) => { doc: Json; notes: string[] }> = {
  4: (doc) => {
    const notes: string[] = [];
    // The outline is read before flows are taken apart, for tables of contents.
    const outline = outlineOf((doc.components as Component[]).filter((c) => c.at));
    const surfaces = (doc.surfaces as Json[]).map((s) => {
      if (!s.master) return s;
      const { master, ...rest } = s;
      const ids = ((master as { components: { id: string }[] }).components ?? []).map((c) => c.id);
      notes.push(`page "${String(s.id)}": the master (${ids.join(", ") || "empty"}) was dropped (version 3 has no master; headers, footers and page numbers are lost)`);
      return rest;
    });
    const components = expandFlows(doc.components as Json[], notes).map((c) => {
      let out = c;
      if (out.styles) {
        const { styles, ...rest } = out;
        notes.push(`"${String(c.id)}": the style of its parts (${Object.keys(styles as Json).join(", ")}) was dropped (version 3 has no styles per part)`);
        out = rest;
      }
      return downComponent4(out, notes, outline);
    });
    const styles = doc.styles as Json | undefined;
    const document = (styles?.document ?? {}) as Json;
    const dropped: string[] = Object.keys(document).filter((selector) => NEW_IN_4_SELECTORS.has(selector) || NEW_IN_4_TYPES.has(selector.split(".")[0] as string));
    let nextStyles = doc.styles;
    if (dropped.length) {
      notes.push(`document styles for ${dropped.join(", ")} were dropped (version 3 has no such parts)`);
      nextStyles = { ...styles, document: Object.fromEntries(Object.entries(document).filter(([k]) => !dropped.includes(k))) };
    }
    return { doc: { ...doc, version: 3, surfaces, components, ...(nextStyles !== undefined ? { styles: nextStyles } : {}) }, notes };
  },
  3: (doc) => {
    const notes: string[] = [];
    const surfaces = (doc.surfaces as Json[]).map((s) => {
      if (s.kind === "page" && s.size === "Slide") {
        notes.push(`page "${String(s.id)}": the Slide size became ${SLIDE.width}×${SLIDE.height} (version 2 has no Slide name)`);
        return { ...s, size: { ...SLIDE } };
      }
      return s;
    });

    let usesHeading = false;
    const families = new Set<string>();
    walkStrings({ styles: doc.styles, components: doc.components, tokens: doc.tokens }, (s) => {
      if (s === "$font.heading") usesHeading = true;
      for (const f of NEW_IN_3_FAMILIES) if (s === f) families.add(f);
    });

    const tokens = (doc.tokens ?? {}) as Json;
    const font = (tokens.font ?? {}) as Record<string, string>;
    let nextTokens = doc.tokens as Json | undefined;
    if (usesHeading && font.heading === undefined) {
      // Older libraries have no default for it: write the default down so the reference resolves.
      nextTokens = { ...tokens, font: { ...font, heading: defaultTokens.font.heading } };
      notes.push(`font.heading written into the tokens ("${defaultTokens.font.heading}"): older libraries have no default for it`);
    }
    if (font.heading !== undefined && font.heading !== (font.sans ?? defaultTokens.font.sans)) {
      notes.push(`titles follow font.heading ("${font.heading}") only from 0.4; older libraries draw them in font.sans`);
    }
    for (const f of families) notes.push(`font "${f}" is bundled from 0.4; older libraries draw it with a fallback`);

    return { doc: { ...doc, version: 2, surfaces, ...(nextTokens ? { tokens: nextTokens } : {}) }, notes };
  },
};

/**
 * The document written in format `target` (an older one), for a library that reads
 * only up to it. Accepts any version this library reads except 1. `notes` lists what
 * the older format cannot say; the result is still a valid document of that version.
 */
export function downgradeDocument(input: unknown, target: number): DowngradeResult {
  const from = formatOf(input);
  if (!Number.isInteger(target) || target < OLDEST_DOWNGRADE) {
    return { ok: false, doc: null, from, to: target, notes: [`cannot write format ${String(target)}: the oldest is ${OLDEST_DOWNGRADE}`] };
  }
  const parsed = DocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, doc: null, from, to: target, notes: [parsed.error.issues[0]?.message ?? "not a valid layout document"] };
  }
  let doc = parsed.data as unknown as Json;
  const notes: string[] = [];
  for (let v = VERSION; v > target; v--) {
    const step = DOWN_STEPS[v];
    if (!step) return { ok: false, doc: null, from, to: target, notes: [`no conversion from format ${v} to ${v - 1}`] };
    const out = step(doc);
    doc = out.doc;
    notes.push(...out.notes);
  }
  return { ok: true, doc, from, to: Math.min(target, VERSION), notes };
}

export interface ReadResult {
  ok: boolean;
  doc: LayoutDocument | null;
  /** The version the input was in (null when it was not a layout document). */
  from: number | null;
  /** Why it failed, or what the conversion did. */
  notes: string[];
}

/**
 * A document from JSON, in the current version, with a warning in the log when it
 * had to be converted or cannot be read. Older versions are converted up; a newer
 * one is refused (update the library, or ask the server for this version).
 * Version 1 needs `engine`, because converting it measures the content.
 */
export function readDocument(
  input: unknown,
  options: { logger?: Logger; engine?: { layout(doc: unknown): LayoutResult }; source?: string } = {},
): ReadResult {
  const log = options.logger ?? consoleLogger;
  const where = options.source ? ` (${options.source})` : "";
  const from = formatOf(input);

  if (from !== null && from > VERSION) {
    const message = `the document${where} is format ${from}; this library reads up to ${VERSION}. Update @docforge-lib/layout, or ask the server for format ${VERSION}.`;
    log({ code: "format_unsupported", message, data: { from, readsUpTo: VERSION } });
    return { ok: false, doc: null, from, notes: [message] };
  }
  if (from === 1) {
    if (!options.engine) return { ok: false, doc: null, from, notes: ["version 1 documents need an engine to convert (readDocument(doc, { engine }))"] };
    const up = upgradeDocument(input, options.engine);
    if (up.ok) log({ code: "format_upgraded", message: `the document${where} was format 1 and was converted to ${VERSION}`, data: { from, to: VERSION, notes: up.notes } });
    return { ok: up.ok, doc: up.doc, from, notes: up.notes };
  }

  const parsed = DocumentSchema.safeParse(input);
  if (!parsed.success) {
    const notes = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(document)"}: ${i.message}`);
    return { ok: false, doc: null, from, notes };
  }
  if (from !== VERSION) {
    log({ code: "format_upgraded", message: `the document${where} was format ${String(from)} and is read as ${VERSION} (same shape)`, data: { from, to: VERSION } });
    return { ok: true, doc: parsed.data, from, notes: [`version ${String(from)} → ${VERSION}: only the number changed`] };
  }
  return { ok: true, doc: parsed.data, from, notes: [] };
}
