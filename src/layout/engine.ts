import { DocumentSchema, defaultGrid, type Grid } from "../schema/document";
import { mergeTokens } from "../schema/tokens";
import { dedupe, diag, sortDiagnostics, type Diagnostic } from "../validate/diagnostics";
import { sizeBands } from "./bands";
import { checkLinks } from "./links";
import { measureComponents } from "./measure";
import { paginate } from "./paginate";
import { checkStructure } from "./structure";
import { frameFor, pickSurface } from "./surface";
import type { LayoutOptions, LayoutResult } from "./types";

export { surfaceSize } from "./surface";
export type { BandGeometry, BandPlacement, Box, ComponentGeometry, LayoutOptions, LayoutResult, PageLayout } from "./types";

const DEFAULT_LOCALE = "en-US";

function schemaDiagnostics(error: { issues: { path: PropertyKey[]; message: string }[] }): Diagnostic[] {
  return error.issues.map((issue) =>
    diag("error", "schema", `${issue.path.map(String).join(".") || "(document)"}: ${issue.message}`, {
      data: { path: issue.path.map(String) },
    }),
  );
}

/**
 * Lay a document out on one surface, in stages: schema → structure → measure → band
 * heights → pages → links. Never throws on document problems: everything wrong with
 * the document comes back as diagnostics.
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
      columnWidth: 0,
      contentWidth: 0,
      pages: [],
      components: {},
      bands: {},
      diagnostics: sortDiagnostics(schemaDiagnostics(parsed.error)),
    };
  }

  const doc = parsed.data;
  const grid: Grid = { ...defaultGrid, ...doc.grid };
  const tokens = mergeTokens(doc.tokens);
  const locale = doc.meta?.locale ?? DEFAULT_LOCALE;

  const structure = checkStructure(doc, diagnostics);
  const surface = pickSurface(doc, options.surfaceId, diagnostics);
  const frame = frameFor(surface, grid);
  const { prepared, links } = measureComponents({ doc, structure, frame, tokens, registry: options.registry, locale }, diagnostics);
  const { bands, components } = sizeBands(doc, prepared, frame, diagnostics);
  const pages = paginate(doc, prepared, bands, components, frame, diagnostics);
  checkLinks(links, doc, structure, diagnostics);

  return {
    ok: true,
    doc,
    surface,
    grid,
    tokens,
    columnWidth: frame.columnWidth,
    contentWidth: frame.contentWidth,
    pages,
    components,
    bands,
    diagnostics: sortDiagnostics(dedupe(diagnostics)),
  };
}
