export { createEngine, type Engine, type ApplyResult } from "./engine";

export { FontRegistry, cssFamily, type FontSource, type Face } from "./fonts/registry";
export { BUNDLED_FONTS, fetchBundledFonts } from "./fonts/bundled";

export { layoutDocument, surfaceSize, type LayoutResult, type PageLayout, type Box, type ComponentGeometry, type BandGeometry, type BandPlacement } from "./layout/engine";
export { renderLayout, toHtmlPage, type RenderedDocument } from "./render/document";
export { documentMap, type DocumentMap, type MapLevel, type MapOptions } from "./map/map";
export { applyOps, type Op, type Position, type OpsResult } from "./ops/ops";

export { DocumentSchema, GridSchema, SurfaceSchema, SectionSchema, BandSchema, RegionSchema, StylesSchema, defaultGrid, PAGE_SIZES } from "./schema/document";
export type { LayoutDocument, Grid, Surface, Section, Band, BandItem, Region, Styles } from "./schema/document";
export { ComponentSchema, COMPONENT_TYPES } from "./schema/components";
export type { Component, ComponentType, ComponentOf, Paragraph, ListItemInput } from "./schema/components";
export { StylePropsSchema, STYLE_PROPS } from "./schema/style";
export type { StyleProps, StyleProp, ResolvedStyle, ResolvedStyleWithOrigin } from "./schema/style";
export { TokensSchema, defaultTokens, mergeTokens } from "./schema/tokens";
export type { Tokens, TokenOverrides } from "./schema/tokens";
export type { Inline, Run, TextRole } from "./schema/content";
export { TEXT_ROLES } from "./schema/content";
export { defaultPresets } from "./style/presets";

export { layoutText, styleRuns, type TextBlock, type TextLine, type StyledRun } from "./text/layout";
export { parseInline, inlineToRuns, inlineText } from "./text/inline";
export { renderTextBlock } from "./render/html";

export type { Diagnostic, DiagnosticCode, Severity } from "./validate/diagnostics";
export { componentDefs } from "./components";
