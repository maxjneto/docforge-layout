import type { ComponentContext, Laid } from "../components";
import type { Component, ComponentType } from "../schema/components";
import type { Grid, LayoutDocument, Surface } from "../schema/document";
import type { Placement } from "../schema/placement";
import type { ResolvedStyle, ResolvedStyleWithOrigin } from "../schema/style";
import type { Tokens } from "../schema/tokens";
import type { FontRegistry } from "../fonts/registry";
import type { Diagnostic } from "../validate/diagnostics";

export interface Box {
  component: string;
  /** px, from the top-left corner of the page. */
  x: number;
  y: number;
  width: number;
  height: number;
  html: string;
  /** Present when the component was split across pages: 0-based piece index. */
  piece?: number;
}

/** One alignment guide column, in units from the left edge of the content area. */
export interface Guide {
  /** 1-based column number. */
  col: number;
  x: number;
  w: number;
}

export interface PageLayout {
  index: number;
  width: number;
  height: number;
  boxes: Box[];
  /** Content area of the page (inside the margins), in px. */
  content: { x: number; y: number; width: number; height: number };
  /** Rows (units) of content on this page. */
  rows: number;
}

/** A box in grid units on one page (page is 1-based). */
export interface UnitBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComponentGeometry {
  id: string;
  type: ComponentType;
  sizing: "content" | "area";
  /** The position written in the document. */
  declared: Placement;
  /** Where it ended up (the first piece when split), in units. */
  box: UnitBox;
  /** Every piece when the component was split across pages. */
  pieces: UnitBox[];
  /** The box in px (first piece). */
  area: { width: number; height: number };
  /** Height the content needs (box, including padding), in px. */
  needed: number;
  /** Height the component would take with no `h`, in px. */
  natural: number;
  /** Rows the component moved down from its declared position (0 when it did not move). */
  shifted: number;
  /** Who pushed it last, when it was pushed by another component. */
  pushedBy?: string;
  /** Rows the box grew beyond the declared `h` to fit its content. */
  grew: number;
  /** True when the declared box did not fit the page width and was moved or narrowed. */
  clamped: boolean;
  /** 0-based page indexes it appears on. */
  pages: number[];
  facts: Record<string, unknown>;
  labels: string[];
  style: ResolvedStyleWithOrigin;
}

export interface LayoutResult {
  ok: boolean;
  doc: LayoutDocument | null;
  surface: Surface | null;
  grid: Grid;
  tokens: Tokens;
  /** Content area in whole units. */
  units: { cols: number; rows: number | null };
  guides: Guide[];
  contentWidth: number;
  pages: PageLayout[];
  components: Record<string, ComponentGeometry>;
  diagnostics: Diagnostic[];
}

export interface LayoutOptions {
  registry: FontRegistry;
  surfaceId?: string;
}

/** Page geometry of one surface: everything that turns units into px. */
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
  /** Whole units across the content area. */
  cols: number;
  /** Whole units down one page; `Infinity` for continuous surfaces. */
  rows: number;
  /** Rows per declared page, used to stack pages on a continuous surface (`rows` on a paged one). */
  pageStride: number;
  guides: Guide[];
}

/** A placed component after measurement: everything later stages need. */
export interface Prepared {
  component: Component;
  declared: Placement;
  /** Declared box after fitting it into the page width. */
  x: number;
  w: number;
  clamped: boolean;
  /** Box width in px. */
  areaWidth: number;
  /** Padding + border, when the component is decorated. */
  inset: number;
  decoration: ResolvedStyle;
  laid: Laid;
  ctx: ComponentContext;
  styleWithOrigin: ResolvedStyleWithOrigin;
  /** Document order, the last tie-breaker when two components are declared at the same spot. */
  order: number;
}

export interface Link {
  component: string;
  href: string;
}
