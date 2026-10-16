export { createEngine, type Engine, type ApplyResult } from "./engine";

export { FontRegistry, cssFamily, type FontSource, type Face } from "./fonts/registry";
export { BUNDLED_FONTS, fetchBundledFonts, createBrowserRegistry, type BundledFontFile, type FontLocation } from "./fonts/bundled";

export {
  layoutDocument,
  surfaceSize,
  guidesFor,
  type LayoutResult,
  type PageLayout,
  type Box,
  type ComponentGeometry,
  type Guide,
  type UnitBox,
} from "./layout/engine";
export { diffLayouts, type Change, type ChangeCode } from "./layout/changes";
export { rowsOf, type RowGroup } from "./layout/rows";
export { renderLayout, toHtmlPage, type RenderedDocument } from "./render/document";
export { renderPageSvg } from "./render/svg";
export { documentMap, type DocumentMap, type MapLevel, type MapOptions } from "./map/map";
export { findComponents, type FindQuery, type FindMatch, type FindResult, type FindState } from "./query/find";
export { calibrateStyle, type CalibrateTarget, type CalibrateResult, type VariantMeasure } from "./query/calibrate";
export { compactDocument, fitDocument, FIT_STRATEGIES, type FitStrategy, type FitOutcome } from "./ops/fit";
export { locateAnchors, type Anchor, type Located } from "./query/locate";
export { reviewLayout, type ReviewCode, type ReviewFinding, type ReviewResult } from "./query/review";
export { compareDocuments, restoreOps, type Comparison, type ComponentEdit, type EditKind } from "./query/compare";
export { measureComponent, type MeasureOptions, type Measurement, type MeasureResult } from "./query/measure";
export { applyOps, splitColumns, type Op, type AtInput, type OpsResult, type OpsContext } from "./ops/ops";
export { OpSchema, OP_SCHEMAS, OP_NAMES, AtSchema, parseOp, type OpName } from "./ops/schema";
export { upgradeDocument, type UpgradeResult } from "./upgrade";
export { readDocument, downgradeDocument, formatOf, READABLE_FORMATS, OLDEST_DOWNGRADE, type ReadResult, type DowngradeResult } from "./format";
export { consoleLogger, silentLogger, type Logger, type LogEntry, type LogCode } from "./log";
export {
  fetchPublished,
  createClient,
  memoryCache,
  parsePublicSource,
  DocForgeError,
  DEFAULT_BASE_URL,
  type DocForgeClient,
  type DocumentCache,
  type CachedDocument,
  type DocumentPayload,
  type LoadedDocument,
  type DocForgeErrorCode,
} from "./client";

export {
  DocumentSchema,
  GridSchema,
  SurfaceSchema,
  RegionSchema,
  StylesSchema,
  defaultGrid,
  emptyDocument,
  PAGE_SIZES,
  FORMAT,
  VERSION,
} from "./schema/document";
export type { LayoutDocument, Grid, Surface, Region, Styles } from "./schema/document";
export { PlacementSchema, RectSchema, type Placement, type Rect } from "./schema/placement";
export { ComponentSchema, COMPONENT_TYPES } from "./schema/components";
export type { Component, ComponentType, ComponentOf, Paragraph, ListItemInput } from "./schema/components";
export { StylePropsSchema, STYLE_PROPS, PROP_TOKEN_GROUP } from "./schema/style";
export type { StyleProps, StyleProp, ResolvedStyle, ResolvedStyleWithOrigin, ResolvedEntry, StyleOrigin } from "./schema/style";
export { TokensSchema, TOKEN_GROUPS, defaultTokens, mergeTokens } from "./schema/tokens";
export type { Tokens, TokenOverrides, TokenGroup } from "./schema/tokens";
export type { Inline, Run, TextRole } from "./schema/content";
export { TEXT_ROLES } from "./schema/content";
export { defaultPresets } from "./style/presets";
export { resolveStyle, type CascadeInput, type ResolvedResult } from "./style/resolve";

export { layoutText, styleRuns, type TextBlock, type TextLine, type StyledRun } from "./text/layout";
export { parseInline, inlineToRuns, inlineText } from "./text/inline";
export { renderTextBlock } from "./render/html";

export type { Diagnostic, DiagnosticCode, Severity } from "./validate/diagnostics";
export { BLOCKING_CODES } from "./validate/diagnostics";
export { componentDefs } from "./components";
