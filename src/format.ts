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
 */

import { defaultTokens } from "./schema/tokens";
import { DocumentSchema, SAME_SHAPE_VERSIONS, VERSION, type LayoutDocument } from "./schema/document";
import type { LayoutResult } from "./layout/types";
import { consoleLogger, type Logger } from "./log";
import { upgradeDocument } from "./upgrade";

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

/** Each step takes a document of version `n` and returns it in version `n - 1`. */
const DOWN_STEPS: Record<number, (doc: Json) => { doc: Json; notes: string[] }> = {
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
