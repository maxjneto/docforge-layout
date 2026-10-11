import type { FontRegistry } from "./fonts/registry";
import { layoutDocument, type LayoutResult } from "./layout/engine";
import { documentMap, type DocumentMap, type MapOptions } from "./map/map";
import { applyOps, type Op } from "./ops/ops";
import { renderLayout, toHtmlPage, type RenderedDocument } from "./render/document";
import { DocumentSchema, type LayoutDocument } from "./schema/document";
import { diag, sortDiagnostics, type Diagnostic } from "./validate/diagnostics";

export interface ApplyResult {
  /** The document after the operations (unchanged input when they could not be applied). */
  doc: LayoutDocument | null;
  /** True when the operations applied and nothing they touched has an error. */
  ok: boolean;
  /** Operation errors, problems on what the operations touched, and every error in the document. */
  diagnostics: Diagnostic[];
  /** Level-1 map of the result, so the caller sees where everything ended up. */
  map: string;
}

export interface Engine {
  registry: FontRegistry;
  layout(doc: unknown, surfaceId?: string): LayoutResult;
  render(
    doc: unknown,
    options?: { surfaceId?: string; screen?: boolean; grid?: boolean },
  ): { layout: LayoutResult; rendered: RenderedDocument; page: string };
  validate(doc: unknown, surfaceId?: string): Diagnostic[];
  map(doc: unknown, options: MapOptions & { surfaceId?: string }): DocumentMap;
  apply(doc: unknown, ops: Op[], options?: { surfaceId?: string }): ApplyResult;
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
      return { layout: result, rendered, page: toHtmlPage(rendered, title) };
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
          map: documentMap(result, { level: 0 }).text,
        };
      }
      const applied = applyOps(parsed.data, ops);
      const result = layout(applied.doc, opts.surfaceId);
      const touchedComponents = new Set(applied.touched.components);
      const touchedBands = new Set(applied.touched.bands);
      const relevant = result.diagnostics.filter(
        (d) =>
          d.severity === "error" ||
          (d.component !== undefined && touchedComponents.has(d.component)) ||
          (d.band !== undefined && touchedBands.has(d.band)),
      );
      const diagnostics = sortDiagnostics([...applied.errors, ...relevant]);
      const touchedErrors = diagnostics.filter(
        (d) =>
          d.severity === "error" &&
          (d.code === "invalid-op" ||
            (d.component !== undefined && touchedComponents.has(d.component)) ||
            (d.band !== undefined && touchedBands.has(d.band))),
      );
      return {
        doc: result.doc ?? applied.doc,
        ok: applied.errors.length === 0 && result.ok && touchedErrors.length === 0,
        diagnostics,
        map: documentMap(result, { level: 1 }).text,
      };
    },
  };
}
