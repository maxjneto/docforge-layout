import type { FontRegistry } from "./fonts/registry";
import { diffLayouts, type Change } from "./layout/changes";
import { layoutDocument, type LayoutResult } from "./layout/engine";
import { documentMap, type DocumentMap, type MapOptions } from "./map/map";
import { summarizeApply } from "./map/summary";
import { applyOps } from "./ops/ops";
import { calibrateStyle, type CalibrateResult, type CalibrateTarget } from "./query/calibrate";
import { findComponents, type FindQuery, type FindResult } from "./query/find";
import { locateAnchors, type Anchor, type Located } from "./query/locate";
import { measureComponent, type MeasureOptions, type MeasureResult } from "./query/measure";
import { reviewLayout, type ReviewResult } from "./query/review";
import { compareDocuments, restoreOps, type Comparison } from "./query/compare";
import { renderLayout, toHtmlPage, type RenderedDocument } from "./render/document";
import { renderPageSvg } from "./render/svg";
import { DocumentSchema, type LayoutDocument } from "./schema/document";
import { BLOCKING_CODES, diag, sortDiagnostics, type Diagnostic } from "./validate/diagnostics";

export interface ApplyResult {
  /** The document after the operations (`null` when the input document was invalid). */
  doc: LayoutDocument | null;
  /**
   * False only when an operation could not run or the result is not a valid document.
   * Layout consequences (something pushed, a new page, a page limit) never make it false:
   * they come back in `changes` and `diagnostics`.
   */
  ok: boolean;
  /** Operation errors, every error in the document, and warnings about what the ops touched or the pages. */
  diagnostics: Diagnostic[];
  /** What the layout did on its own to components the operations did not touch. */
  changes: Change[];
  /** Level-1 map of the result, so the caller sees where everything ended up. */
  map: string;
  /**
   * A few lines on what this write did: what the ops changed (before → after), what moved
   * on its own, problems and free rows per page. Enough to continue without the map.
   */
  summary: string;
}

export interface Engine {
  registry: FontRegistry;
  layout(doc: unknown, surfaceId?: string): LayoutResult;
  render(
    doc: unknown,
    options?: { surfaceId?: string; screen?: boolean; grid?: boolean; backdrop?: string | null },
  ): { layout: LayoutResult; rendered: RenderedDocument; page: string };
  validate(doc: unknown, surfaceId?: string): Diagnostic[];
  map(doc: unknown, options: MapOptions & { surfaceId?: string }): DocumentMap;
  /**
   * Apply operations without saving anything: the result is what the document would
   * become. `ops` may come straight from JSON: each one is shape-checked (see `OpSchema`).
   */
  apply(doc: unknown, ops: readonly unknown[], options?: { surfaceId?: string; map?: Omit<MapOptions, "level"> }): ApplyResult;
  /** What changed in the layout between two versions of a document (side effects only). */
  diff(before: unknown, after: unknown, options?: { surfaceId?: string; touched?: string[] }): Change[];
  /** How big a component would be at one or more widths, without placing it anywhere. */
  measure(component: unknown, options?: MeasureOptions & { surfaceId?: string }): MeasureResult;
  /** Components matching a query (text, type, class, page, area, state). */
  find(doc: unknown, query: FindQuery, options?: { surfaceId?: string }): FindResult;
  /** Style variants measured side by side, none applied: for choosing a style before writing it. */
  calibrate(doc: unknown, target: CalibrateTarget, variants: unknown[], options?: { surfaceId?: string }): CalibrateResult;
  /** Where notes' anchors (a component and/or an area) are now, and what is drawn there. */
  locate(doc: unknown, anchors: Anchor[], options?: { surfaceId?: string }): Located[];
  /** Composition findings (empty boxes, ragged rows, edges off the guides, a near-empty last page), each with fixing ops. */
  review(doc: unknown, options?: { surfaceId?: string }): ReviewResult;
  /** One page as a standalone SVG (no browser needed; rasterize it with resvg for an image). */
  renderSvg(doc: unknown, options: { page: number; surfaceId?: string; highlight?: string[] }): string;
  /** What changed between two versions, per component (on purpose) plus what moved as a consequence. */
  compare(before: unknown, after: unknown, options?: { surfaceId?: string }): Comparison;
  /** Ops that bring one component back to how it was in `before`. */
  restore(before: unknown, after: unknown, component: string): unknown[];
}

/** The library's entry point: everything runs against one font registry. */
export function createEngine(options: { registry: FontRegistry }): Engine {
  const { registry } = options;
  const layout = (doc: unknown, surfaceId?: string) => layoutDocument(doc, { registry, surfaceId });

  return {
    registry,
    layout,
    render(doc, opts = {}) {
      const result = layout(doc, opts.surfaceId);
      const rendered = renderLayout(result, registry, { screen: opts.screen, grid: opts.grid });
      const title = result.doc?.meta?.title ?? "Document";
      return { layout: result, rendered, page: toHtmlPage(rendered, title, { backdrop: opts.backdrop }) };
    },
    validate(doc, surfaceId) {
      return layout(doc, surfaceId).diagnostics;
    },
    map(doc, opts) {
      return documentMap(layout(doc, opts.surfaceId), opts);
    },
    apply(doc, ops, opts = {}) {
      const parsed = DocumentSchema.safeParse(doc);
      if (!parsed.success) {
        const result = layout(doc, opts.surfaceId);
        return {
          doc: null,
          ok: false,
          diagnostics: [diag("error", "schema", "The document is invalid; fix it before applying operations."), ...result.diagnostics],
          changes: [],
          map: documentMap(result, { level: 0 }).text,
          summary: "The document is invalid; fix it before applying operations.",
        };
      }
      const before = layout(parsed.data, opts.surfaceId);
      const applied = applyOps(parsed.data, ops, { layout: (d) => layout(d, opts.surfaceId) });
      const result = layout(applied.doc, opts.surfaceId);
      const touched = new Set(applied.touched.components);
      const diagnostics = sortDiagnostics([
        ...applied.errors,
        ...applied.notes,
        ...result.diagnostics.filter(
          (d) =>
            d.severity === "error" ||
            (d.component === undefined && d.severity === "warning") ||
            (d.component !== undefined && touched.has(d.component) && d.severity !== "info"),
        ),
      ]);
      const blocked = applied.errors.length > 0 || !result.ok || result.diagnostics.some((d) => BLOCKING_CODES.has(d.code));
      const changes = blocked ? [] : diffLayouts(before, result, touched);
      return {
        doc: result.doc ?? applied.doc,
        ok: !blocked,
        diagnostics,
        changes,
        map: documentMap(result, { level: 1, ...opts.map }).text,
        summary: summarizeApply({ before, after: result, touched, changes, diagnostics }),
      };
    },
    diff(beforeDoc, afterDoc, opts = {}) {
      return diffLayouts(layout(beforeDoc, opts.surfaceId), layout(afterDoc, opts.surfaceId), new Set(opts.touched ?? []));
    },
    measure(component, opts = {}) {
      return measureComponent(component, opts, (d) => layout(d, opts.surfaceId));
    },
    find(doc, query, opts = {}) {
      return findComponents(layout(doc, opts.surfaceId), query);
    },
    calibrate(doc, target, variants, opts = {}) {
      const parsed = DocumentSchema.safeParse(doc);
      if (!parsed.success) return { ok: false, variants: [], text: "The document is invalid." };
      return calibrateStyle(parsed.data, target, variants, (d) => layout(d, opts.surfaceId));
    },
    locate(doc, anchors, opts = {}) {
      return locateAnchors(layout(doc, opts.surfaceId), anchors);
    },
    review(doc, opts = {}) {
      return reviewLayout(layout(doc, opts.surfaceId));
    },
    renderSvg(doc, opts) {
      return renderPageSvg(layout(doc, opts.surfaceId), registry, opts.page, opts.highlight);
    },
    compare(before, after, opts = {}) {
      const a = DocumentSchema.safeParse(before);
      const b = DocumentSchema.safeParse(after);
      if (!a.success || !b.success) return { edits: [], document: [], effects: [] };
      return compareDocuments(a.data, b.data, (d) => layout(d, opts.surfaceId));
    },
    restore(before, after, component) {
      const a = DocumentSchema.safeParse(before);
      const b = DocumentSchema.safeParse(after);
      return a.success && b.success ? restoreOps(a.data, b.data, component) : [];
    },
  };
}
