import { defOf } from "../components";
import type { Component } from "../schema/components";
import { STYLE_PROPS } from "../schema/style";
import type { LayoutResult } from "../layout/engine";
import type { Diagnostic } from "../validate/diagnostics";

export type MapLevel = 0 | 1 | 2;

export interface MapOptions {
  level: MapLevel;
  /** Level 2: which components to detail (default: all placed). */
  components?: string[];
}

export interface DocumentMap {
  level: MapLevel;
  text: string;
}

function surfaceLabel(result: LayoutResult): string {
  const s = result.surface;
  if (!s) return "no surface";
  if (s.kind === "continuous") return `${s.id} (continuous, ${Math.round(s.width)}px wide)`;
  const size = typeof s.size === "string" ? s.size : `${Math.round(s.size.width)}×${Math.round(s.size.height)}px`;
  return `${s.id} (page ${size}, ${result.pages.length} page${result.pages.length === 1 ? "" : "s"})`;
}

function alertsFor(id: string, diagnostics: Diagnostic[]): string {
  const own = diagnostics.filter((d) => d.component === id && d.severity !== "info");
  if (!own.length) return "";
  return " " + own.map((d) => `${d.severity === "error" ? "!" : "~"}${d.code}${d.code === "overflow" && d.data?.short ? ` ${d.data.short}px` : ""}`).join(" ");
}

function counts(diagnostics: Diagnostic[]): string {
  const e = diagnostics.filter((d) => d.severity === "error").length;
  const w = diagnostics.filter((d) => d.severity === "warning").length;
  return `${e} error${e === 1 ? "" : "s"}, ${w} warning${w === 1 ? "" : "s"}`;
}

function level0(result: LayoutResult): string {
  const doc = result.doc;
  if (!doc) return `invalid document · ${counts(result.diagnostics)}`;
  const byType = new Map<string, number>();
  for (const c of doc.components) byType.set(c.type, (byType.get(c.type) ?? 0) + 1);
  const lines = [
    `document${doc.meta?.title ? ` "${doc.meta.title}"` : ""} · surface ${surfaceLabel(result)}`,
    ...gridDimensions(result).slice(0, 2),
    `components: ${doc.components.length} (${[...byType].map(([t, n]) => `${t} ${n}`).join(", ")})`,
    "sections:",
  ];
  for (const s of doc.sections) {
    const ids = s.bands.flatMap((b) => b.items.map((i) => i.component));
    lines.push(`  ${s.id}${s.name ? ` "${s.name}"` : ""}: ${s.bands.length} bands — ${ids.join(", ") || "(empty)"}`);
  }
  lines.push(`issues: ${counts(result.diagnostics)}`);
  return lines.join("\n");
}

const r1 = (n: number) => String(Math.round(n * 10) / 10);

/** Grid and page measurements, in px: what one column, one row and the content area are worth. */
export function gridDimensions(result: LayoutResult): string[] {
  const g = result.grid;
  const page = result.pages[0];
  const lines = [
    `grid: ${g.columns} cols × ${r1(result.columnWidth)}px, column gap ${g.columnGap}px · row unit ${g.rowUnit}px · band gap ${g.bandGap}px · section gap ${g.sectionGap}px`,
  ];
  if (page) {
    const c = page.content;
    const m = { top: c.y, left: c.x, right: page.width - c.x - c.width, bottom: page.height - c.y - c.height };
    const margins = new Set(Object.values(m).map(r1)).size === 1 ? r1(m.top) : `${r1(m.top)} ${r1(m.right)} ${r1(m.bottom)} ${r1(m.left)}`;
    const kind = result.surface?.kind === "continuous" ? "continuous page" : "page";
    lines.push(
      `${kind}: ${r1(page.width)}×${r1(page.height)}px · margins ${margins}px · content area ${r1(c.width)}×${r1(c.height)}px (${Math.floor(c.height / g.rowUnit)} rows)`,
    );
  }
  lines.push("span N cols = N × col + (N−1) × gap  ·  N rows = N × row unit");
  return lines;
}

function level1(result: LayoutResult): string {
  const doc = result.doc;
  if (!doc) return level0(result);
  const components = new Map(doc.components.map((c) => [c.id, c] as const));
  const lines: string[] = [`surface ${surfaceLabel(result)}`, ...gridDimensions(result)];
  const pageCount = Math.max(1, result.pages.length);
  for (let p = 0; p < pageCount; p++) {
    if (result.pages.length > 1 || result.surface?.kind === "page") lines.push(`page ${p + 1}`);
    for (const section of doc.sections) {
      for (const band of section.bands) {
        const geo = result.bands[band.id];
        if (!geo || !(geo.pages.includes(p) || (geo.pages.length === 0 && p === 0))) continue;
        const spanLabel = band.span === "auto" ? `auto→${geo.rows}` : String(band.span);
        const continued = geo.pages.length > 1 && geo.pages[0] !== p ? " (cont.)" : "";
        const head = `  ${section.id} ${band.id} [${spanLabel} rows · ${r1(geo.height)}px]${continued}`;
        const items = band.items
          .map((item) => {
            const c = components.get(item.component);
            const end = item.colStart + item.colSpan - 1;
            const area = result.components[item.component]?.area;
            const size = area ? ` · ${r1(area.width)}×${r1(area.height)}` : "";
            return `[${item.component}${c ? ` ${c.type}` : " ?"} ${item.colStart}-${end}${size}${alertsFor(item.component, result.diagnostics)}]`;
          })
          .join(" ");
        lines.push(`${head.padEnd(44)} ${items || "(empty band)"}`);
      }
    }
  }
  const unplaced = result.diagnostics.filter((d) => d.code === "unplaced-component").map((d) => d.component);
  if (unplaced.length) lines.push(`unplaced: ${unplaced.join(", ")}`);
  const global = result.diagnostics.filter((d) => !d.component && d.severity !== "info");
  for (const d of global) lines.push(`${d.severity === "error" ? "!" : "~"} ${d.code}: ${d.message}`);
  lines.push(`issues: ${counts(result.diagnostics)}`);
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
      blocks.push(`${id}: not placed or not found`);
      continue;
    }
    const lines = [
      `${id} · ${c.type} (${g.sizing}) · ${g.section}/${g.band} cols ${g.colStart}–${g.colStart + g.colSpan - 1} · page ${g.pages.map((p) => p + 1).join(", ") || "-"}`,
      `  area ${Math.round(g.area.width)}×${Math.round(g.area.height)}px · needs ${g.needed}px${g.sizing === "area" ? ` · natural ${g.natural}px` : ""}${g.overflow ? ` · OVERFLOW ${g.overflow}px` : " · fits"}`,
      `  summary: ${defOf(c.type).describe(c as never)}`,
    ];
    if (Object.keys(g.facts).length) lines.push(`  facts: ${JSON.stringify(g.facts)}`);
    if (c.labels?.length) lines.push(`  labels: ${c.labels.join(", ")}`);
    lines.push(`  content: ${JSON.stringify(c.content ?? {})}`);
    if ("props" in c && c.props && Object.keys(c.props).length) lines.push(`  props: ${JSON.stringify(c.props)}`);
    lines.push("  style:");
    for (const prop of STYLE_PROPS) {
      const e = g.style[prop];
      const written = e.written !== undefined && e.written !== e.value ? ` (${String(e.written)})` : "";
      lines.push(`    ${prop}: ${e.value === null ? "none" : String(e.value)}${written} ← ${e.origin}`);
    }
    const own = result.diagnostics.filter((d) => d.component === id);
    if (own.length) {
      lines.push("  diagnostics:");
      for (const d of own) {
        lines.push(`    [${d.severity} ${d.code}] ${d.message}`);
        for (const s of d.suggestions ?? []) lines.push(`      → ${s}`);
      }
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/** A text map of the document for agents: level 0 outline, level 1 grid, level 2 component detail. */
export function documentMap(result: LayoutResult, options: MapOptions): DocumentMap {
  const text = options.level === 0 ? level0(result) : options.level === 1 ? level1(result) : level2(result, options.components);
  return { level: options.level, text };
}
