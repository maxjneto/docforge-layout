import type { ComponentContext, Laid } from "../components";
import type { Component, ComponentType } from "../schema/components";
import type { Band, Grid, LayoutDocument, Section, Surface } from "../schema/document";
import type { ResolvedStyle, ResolvedStyleWithOrigin } from "../schema/style";
import type { Tokens } from "../schema/tokens";
import type { FontRegistry } from "../fonts/registry";
import type { Diagnostic } from "../validate/diagnostics";

export interface Box {
  component: string;
  x: number;
  y: number;
  width: number;
  height: number;
  html: string;
  /** Present when the component was split across pages: 0-based piece index. */
  piece?: number;
}

/** Where a band (or one piece of a split band) sits on a page. */
export interface BandPlacement {
  id: string;
  section: string;
  y: number;
  height: number;
  rows: number;
  /** Present when the band was split across pages. */
  piece?: number;
}

export interface PageLayout {
  index: number;
  width: number;
  height: number;
  boxes: Box[];
  bands: BandPlacement[];
  /** Content area of the page (inside the margins). */
  content: { x: number; y: number; width: number; height: number };
}

export interface ComponentGeometry {
  id: string;
  type: ComponentType;
  sizing: "content" | "area";
  section: string;
  band: string;
  colStart: number;
  colSpan: number;
  /** The grid area, in px. */
  area: { width: number; height: number };
  /** Height the component needs (box, including padding), in px. */
  needed: number;
  /** Height an auto band would give it, in px. */
  natural: number;
  /** Positive when the component does not fit its area: missing px. */
  overflow: number;
  pages: number[];
  facts: Record<string, unknown>;
  style: ResolvedStyleWithOrigin;
}

export interface BandGeometry {
  id: string;
  section: string;
  span: number | "auto";
  height: number;
  rows: number;
  pages: number[];
}

export interface LayoutResult {
  ok: boolean;
  doc: LayoutDocument | null;
  surface: Surface | null;
  grid: Grid;
  tokens: Tokens;
  columnWidth: number;
  contentWidth: number;
  pages: PageLayout[];
  components: Record<string, ComponentGeometry>;
  bands: Record<string, BandGeometry>;
  diagnostics: Diagnostic[];
}

export interface LayoutOptions {
  registry: FontRegistry;
  surfaceId?: string;
}

/** Page geometry of one surface: everything that turns grid coordinates into px. */
export interface Frame {
  surface: Surface;
  grid: Grid;
  width: number;
  /** `null` for continuous surfaces (the height follows the content). */
  height: number | null;
  margin: { top: number; right: number; bottom: number; left: number };
  contentWidth: number;
  /** `Infinity` for continuous surfaces. */
  contentHeight: number;
  columnWidth: number;
  areaWidthOf: (colSpan: number) => number;
  xOf: (colStart: number) => number;
}

/** A placed component after measurement: everything later stages need. */
export interface Prepared {
  component: Component;
  section: Section;
  band: Band;
  colStart: number;
  colSpan: number;
  areaWidth: number;
  /** Padding + border, when the component is decorated. */
  inset: number;
  decoration: ResolvedStyle;
  laid: Laid;
  ctx: ComponentContext;
  styleWithOrigin: ResolvedStyleWithOrigin;
}

export interface Link {
  component: string;
  href: string;
}
