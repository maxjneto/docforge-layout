import type { LayoutResult } from "./layout/types";
import { defOf } from "./components";
import type { Component } from "./schema/components";
import { DocumentSchema, FORMAT, SAME_SHAPE_VERSIONS, VERSION, type LayoutDocument, type Surface } from "./schema/document";
import type { StyleProps } from "./schema/style";
import type { TokenOverrides } from "./schema/tokens";

/** The version 1 shape, as much of it as the conversion reads. */
interface V1Document {
  format: string;
  version: 1;
  meta?: LayoutDocument["meta"];
  grid?: Partial<{ columns: number; columnGap: number; rowUnit: number; bandGap: number; sectionGap: number }>;
  tokens?: TokenOverrides;
  styles?: {
    document?: Record<string, StyleProps>;
    labels?: Record<string, StyleProps>;
    regions?: { id: string; section: string; bands?: string[]; cols?: [number, number]; style: StyleProps }[];
  };
  surfaces: Surface[];
  sections: { id: string; name?: string; bands: { id: string; span: number | "auto"; items: { component: string; colStart: number; colSpan: number }[] }[] }[];
  components: (Component & { at?: unknown })[];
}

export interface UpgradeResult {
  ok: boolean;
  doc: LayoutDocument | null;
  /** What the conversion changed beyond moving positions (regions, links…). */
  notes: string[];
}

function rewriteLinks(value: unknown, targets: Map<string, string>, count: { n: number }): unknown {
  if (typeof value === "string") {
    const swap = (match: string, id: string, make: (to: string) => string) => {
      const to = targets.get(id);
      if (to === undefined) return match;
      count.n += 1;
      return make(to);
    };
    return value
      .replace(/\]\(#([a-zA-Z0-9][a-zA-Z0-9_-]*)\)/g, (m, id: string) => swap(m, id, (to) => `](#${to})`))
      .replace(/^#([a-zA-Z0-9][a-zA-Z0-9_-]*)$/, (m, id: string) => swap(m, id, (to) => `#${to}`));
  }
  if (Array.isArray(value)) return value.map((v) => rewriteLinks(v, targets, count));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteLinks(v, targets, count)]));
  return value;
}

/**
 * Convert a version 1 document (sections → bands → items) to the current version
 * (free positions in units). Bands are laid down top to bottom as version 1 did, measuring
 * each one with the engine, so the converted document looks the same:
 * - the grid unit is the old row unit, the guides are the old columns;
 * - a band with several components, a fixed span, or an area component gives them
 *   all its height as `h`, so rows of cards and KPIs stay even;
 * - regions become classes (`region-<id>`) on the components they covered;
 * - links to a section (`#section-id`) now point at its first component.
 * Version 2 documents only get the current number (see SAME_SHAPE_VERSIONS); current
 * ones come back unchanged.
 */
export function upgradeDocument(input: unknown, engine: { layout(doc: unknown): LayoutResult }): UpgradeResult {
  const notes: string[] = [];
  const v = (input as { version?: unknown } | null)?.version;
  if ((SAME_SHAPE_VERSIONS as readonly unknown[]).includes(v)) {
    const parsed = DocumentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, doc: null, notes: [`not a valid version ${String(v)} document`] };
    return { ok: true, doc: parsed.data, notes: v === VERSION ? [] : [`version ${String(v)} → ${VERSION}: only the number changed`] };
  }
  if (v !== 1 || !input || typeof input !== "object") return { ok: false, doc: null, notes: ["not a version 1 layout document"] };
  const v1 = input as V1Document;

  const g1 = { columns: 12, columnGap: 16, rowUnit: 8, bandGap: 16, sectionGap: 32, ...v1.grid };
  const unit = Math.min(64, Math.max(2, g1.rowUnit));
  const bandGap = Math.round(g1.bandGap / unit);
  const sectionGap = Math.round(g1.sectionGap / unit);

  // Regions become classes.
  const labels: Record<string, StyleProps> = { ...(v1.styles?.labels ?? {}) };
  const extraLabels = new Map<string, string[]>();
  for (const region of v1.styles?.regions ?? []) {
    const name = `region-${region.id}`;
    labels[name] = region.style;
    const section = v1.sections.find((s) => s.id === region.section);
    for (const band of section?.bands ?? []) {
      if (region.bands && !region.bands.includes(band.id)) continue;
      for (const item of band.items) {
        const end = item.colStart + item.colSpan - 1;
        if (region.cols && !(item.colStart <= region.cols[1] && end >= region.cols[0])) continue;
        extraLabels.set(item.component, [...(extraLabels.get(item.component) ?? []), name]);
      }
    }
    notes.push(`region "${region.id}" became class "${name}"`);
  }

  // Section links point at the section's first component.
  const sectionTargets = new Map<string, string>();
  for (const s of v1.sections) {
    const first = s.bands.flatMap((b) => b.items)[0];
    if (first) sectionTargets.set(s.id, first.component);
  }

  const rewritten = { n: 0 };
  const components = v1.components.map((c) => {
    const { at: _ignored, ...rest } = c;
    const extra = extraLabels.get(c.id);
    const converted = rewriteLinks(rest, sectionTargets, rewritten) as Component;
    return extra ? ({ ...converted, labels: [...(converted.labels ?? []), ...extra] } as Component) : converted;
  });
  if (rewritten.n) notes.push(`${rewritten.n} link(s) to sections now point at the section's first component`);

  const doc: LayoutDocument = {
    format: FORMAT,
    version: VERSION,
    ...(v1.meta ? { meta: v1.meta } : {}),
    grid: { unit, columns: g1.columns, gutter: g1.columnGap, gap: bandGap },
    ...(v1.tokens ? { tokens: v1.tokens } : {}),
    ...(v1.styles?.document || Object.keys(labels).length
      ? { styles: { ...(v1.styles?.document ? { document: v1.styles.document } : {}), ...(Object.keys(labels).length ? { labels } : {}) } }
      : {}),
    surfaces: v1.surfaces,
    components,
  };
  const byId = new Map(doc.components.map((c) => [c.id, c] as const));

  const empty = engine.layout({ ...doc, components: [] });
  if (!empty.ok) return { ok: false, doc: null, notes: ["the converted settings are not valid"] };
  const guides = empty.guides;
  const R = empty.units.rows ?? Number.POSITIVE_INFINITY;
  const paged = Number.isFinite(R);
  const pageStart = (row: number) => (paged ? Math.floor(row / R) * R : 0);
  const toAt = (row: number) => ({ page: paged ? Math.floor(row / R) + 1 : 1, y: row - pageStart(row) });
  const span = (colStart: number, colSpan: number) => {
    const a = guides.find((g) => g.col === colStart) ?? guides[0];
    const b = guides.find((g) => g.col === colStart + colSpan - 1) ?? guides[guides.length - 1];
    const x = a?.x ?? 0;
    return { x, w: Math.max(1, (b ? b.x + b.w : empty.units.cols) - x) };
  };

  let cursor = 0;
  let first = true;
  v1.sections.forEach((section, si) => {
    section.bands.forEach((band, bi) => {
      const items = band.items.filter((i) => byId.has(i.component));
      if (!items.length) return;
      // Measure the band: its items side by side at the top of a scratch page.
      const scratch = engine.layout({
        ...doc,
        components: items.map((i) => ({ ...(byId.get(i.component) as Component), at: { page: 1, y: 0, ...span(i.colStart, i.colSpan) } })),
      });
      const rows =
        band.span === "auto"
          ? Math.max(1, ...items.map((i) => Math.ceil((scratch.components[i.component]?.natural ?? unit) / unit - 1e-6)))
          : band.span;
      const single = items.length === 1 ? byId.get((items[0] as { component: string }).component) : undefined;
      const flows = !!single && defOf(single.type).sizing === "content" && band.span === "auto";

      let y = first ? 0 : cursor + (bi === 0 && si > 0 ? sectionGap : bandGap);
      if (paged && !flows && y !== pageStart(y) && y + rows > pageStart(y) + R) y = pageStart(y) + R;
      for (const item of items) {
        const c = byId.get(item.component) as Component;
        const evenHeight = band.span !== "auto" || items.length > 1 || defOf(c.type).sizing === "area";
        c.at = { ...toAt(y), ...span(item.colStart, item.colSpan), ...(evenHeight ? { h: rows } : {}) };
      }
      first = false;

      // Continue below whatever is lowest now (a long text may have split across pages).
      const laid = engine.layout(doc);
      const bottoms = Object.values(laid.components).flatMap((g) => g.pieces.map((p) => (paged ? (p.page - 1) * R : 0) + p.y + p.h));
      cursor = Math.max(cursor, ...bottoms);
    });
  });

  const unplaced = doc.components.filter((c) => !c.at).map((c) => c.id);
  if (unplaced.length) notes.push(`not placed in version 1 (still unplaced): ${unplaced.join(", ")}`);
  const parsed = DocumentSchema.safeParse(doc);
  return { ok: parsed.success, doc: parsed.success ? parsed.data : null, notes };
}
