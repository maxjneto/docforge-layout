import { DocumentSchema, defaultGrid, type Grid } from "../schema/document";
import { mergeTokens } from "../schema/tokens";
import { dedupe, diag, sortDiagnostics, type Diagnostic } from "../validate/diagnostics";
import { checkLinks } from "./links";
import { measureComponents } from "./measure";
import { placeComponents } from "./place";
import { checkStructure } from "./structure";
import { frameFor, pickSurface } from "./surface";
import type { LayoutOptions, LayoutResult } from "./types";

export { surfaceSize, guidesFor } from "./surface";
export type { Box, ComponentGeometry, Guide, LayoutOptions, LayoutResult, PageLayout, UnitBox } from "./types";

const DEFAULT_LOCALE = "en-US";

function schemaDiagnostics(error: { issues: { path: PropertyKey[]; message: string }[] }): Diagnostic[] {
  return error.issues.map((issue) =>
    diag("error", "schema", `${issue.path.map(String).join(".") || "(document)"}: ${issue.message}`, {
      data: { path: issue.path.map(String) },
    }),
  );
}

/**
 * Lay a document out on one surface, in stages: schema → structure → measure →
 * place (collisions and pages) → links. Never throws on document problems:
 * everything wrong with the document comes back as diagnostics.
 */
export function layoutDocument(input: unknown, options: LayoutOptions): LayoutResult {
  const diagnostics: Diagnostic[] = [];
  const parsed = DocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      doc: null,
      surface: null,
      grid: defaultGrid,
      tokens: mergeTokens(undefined),
      units: { cols: 0, rows: null },
      guides: [],
      contentWidth: 0,
      pages: [],
      components: {},
      diagnostics: sortDiagnostics(schemaDiagnostics(parsed.error)),
    };
  }

  const doc = parsed.data;
  const grid: Grid = { ...defaultGrid, ...doc.grid };
  const tokens = mergeTokens(doc.tokens);
  const locale = doc.meta?.locale ?? DEFAULT_LOCALE;

  const structure = checkStructure(doc, diagnostics);
  const surface = pickSurface(doc, options.surfaceId, diagnostics);
  const frame = frameFor(surface, grid, doc);
  const { prepared, links } = measureComponents({ doc, structure, frame, tokens, registry: options.registry, locale }, diagnostics);
  const { pages, components } = placeComponents(prepared, frame, diagnostics);
  checkLinks(links, structure, diagnostics);

  return {
    ok: true,
    doc,
    surface,
    grid,
    tokens,
    units: { cols: frame.cols, rows: Number.isFinite(frame.rows) ? frame.rows : null },
    guides: frame.guides,
    contentWidth: frame.contentWidth,
    pages,
    components,
    diagnostics: sortDiagnostics(dedupe(diagnostics)),
  };
}
