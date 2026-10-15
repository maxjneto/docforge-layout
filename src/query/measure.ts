import type { LayoutResult } from "../layout/types";
import { ComponentSchema } from "../schema/components";
import { DocumentSchema, emptyDocument, type LayoutDocument } from "../schema/document";
import { diag, type Diagnostic } from "../validate/diagnostics";

export interface MeasureOptions {
  /** Measure with this document's grid, tokens and styles (default: an empty A4 document). */
  doc?: unknown;
  /** Widths to try, in units. */
  widths?: number[];
  /** Widths to try as guide column ranges, e.g. [[1, 6], [1, 12]]. */
  cols?: [number, number][];
}

export interface Measurement {
  w: number;
  /** Where the width came from: `w` or `cols a–b`. */
  label: string;
  widthPx: number;
  /** Height the content needs, px and rows. */
  neededPx: number;
  rows: number;
  /** Height with no `h` (area components: their natural size), rows. */
  naturalRows: number;
  /** Pages it would take placed alone at the top of a page. */
  pages: number;
  facts: Record<string, unknown>;
  diagnostics: Diagnostic[];
}

export interface MeasureResult {
  ok: boolean;
  measurements: Measurement[];
  diagnostics: Diagnostic[];
  text: string;
}

/**
 * How big a component would be, without touching any document: it is laid out alone
 * at each requested width, with the styles of `doc` (classes, tokens, regions do not
 * apply — it has no position yet).
 */
export function measureComponent(input: unknown, options: MeasureOptions, layout: (doc: LayoutDocument) => LayoutResult): MeasureResult {
  const fail = (diagnostics: Diagnostic[]): MeasureResult => ({
    ok: false,
    measurements: [],
    diagnostics,
    text: diagnostics.map((d) => `! ${d.code}: ${d.message}`).join("\n"),
  });

  let base: LayoutDocument = emptyDocument();
  if (options.doc !== undefined) {
    const parsed = DocumentSchema.safeParse(options.doc);
    if (!parsed.success) return fail([diag("error", "schema", "`doc` is not a valid layout document.")]);
    base = parsed.data;
  }
  const parsed = ComponentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      parsed.error.issues.map((issue) =>
        diag("error", "schema", `component.${issue.path.map(String).join(".") || "(component)"}: ${issue.message}`),
      ),
    );
  }
  const component = parsed.data;

  const empty = layout({ ...base, components: [] });
  const cols = empty.units.cols;
  const unit = empty.grid.unit;
  const targets: { w: number; label: string }[] = [];
  for (const w of options.widths ?? []) targets.push({ w, label: `w ${w}` });
  for (const [first, last] of options.cols ?? []) {
    const a = empty.guides.find((g) => g.col === first);
    const b = empty.guides.find((g) => g.col === last);
    if (!a || !b || last < first) return fail([diag("error", "invalid-op", `cols [${first}, ${last}] must be guide columns 1–${empty.guides.length}, first ≤ last.`)]);
    targets.push({ w: b.x + b.w - a.x, label: `cols ${first}–${last}` });
  }
  if (!targets.length) targets.push({ w: cols, label: "full width" });

  const measurements: Measurement[] = [];
  for (const target of targets) {
    const w = Math.max(1, Math.min(target.w, cols));
    const h = component.at?.h;
    const doc = { ...base, components: [{ ...component, at: { page: 1, x: 0, y: 0, w, ...(h !== undefined ? { h } : {}) } }] };
    const result = layout(doc as LayoutDocument);
    const g = result.components[component.id];
    if (!g) continue;
    measurements.push({
      w,
      label: target.w > cols ? `${target.label} (page is ${cols} wide)` : target.label,
      widthPx: w * unit,
      neededPx: g.needed,
      rows: Math.ceil(g.needed / unit - 1e-6),
      naturalRows: Math.ceil(g.natural / unit - 1e-6),
      pages: g.pages.length,
      facts: g.facts,
      diagnostics: result.diagnostics.filter((d) => d.component === component.id && d.severity !== "info"),
    });
  }

  const lines = [`${component.id} · ${component.type} · 1 unit = ${unit}px · page ${cols} units wide${empty.units.rows ? `, ${empty.units.rows} rows tall` : ""}`];
  for (const m of measurements) {
    const natural = m.naturalRows !== m.rows ? ` · natural ${m.naturalRows} rows` : "";
    const pages = m.pages > 1 ? ` · splits across ${m.pages} pages` : "";
    const facts = Object.keys(m.facts).length ? ` · ${JSON.stringify(m.facts)}` : "";
    lines.push(`  ${m.label} (w ${m.w}, ${m.widthPx}px): needs ${m.neededPx}px = ${m.rows} rows${natural}${pages}${facts}`);
    for (const d of m.diagnostics) lines.push(`    ${d.severity === "error" ? "!" : "~"} ${d.code}: ${d.message}`);
  }
  return { ok: true, measurements, diagnostics: [], text: lines.join("\n") };
}
