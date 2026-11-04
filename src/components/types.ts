import type { ComponentOf, ComponentType } from "../schema/components";
import type { ResolvedStyle, StyleProps } from "../schema/style";
import type { Tokens } from "../schema/tokens";
import type { FontRegistry } from "../fonts/registry";
import type { RunStyleContext } from "../text/layout";
import type { Diagnostic } from "../validate/diagnostics";

/** A horizontal slice of a component, drawn at (x, y) inside the component's content box. */
export interface Chunk {
  height: number;
  html: (x: number, y: number) => string;
  /** Redrawn first when a page break falls right before this chunk (a table's header). */
  repeat?: Chunk;
  /** Starts a new page (a `break` block in a flow) when the surface is paged. */
  breakBefore?: boolean;
  /** Things in this chunk whose number or page is known only after placement. */
  marks?: Mark[];
  /** Never the last chunk on a page when more follows (a title stays with its first line). */
  keepWithNext?: boolean;
}

export interface SemanticOptions {
  locale: string;
  /** Present when drawing a laid-out document (page numbers, figure numbers). */
  late?: Late;
  outline?: OutlineEntry[];
}

/** A heading as written: which text paragraph, its role and the page it was declared on. */
export interface OutlineEntry {
  id: string;
  role: string;
  level: number;
  text: string;
  /** The page of the component that holds it, as declared. */
  page: number;
}

/** A figure to number or a heading to list, found wherever its chunk lands. */
export interface Mark {
  id: string;
  kind: "figure" | "heading";
  level?: number;
  text?: string;
}

/**
 * Values known only once every box is placed, filled in before anything is drawn (chunks
 * read them when their html is built). One object per layout, shared by every component.
 */
export interface Late {
  /** Image id → its figure number, in reading order. */
  figures: Map<string, number>;
  /** Mark id → the page (1-based) it landed on. */
  pages: Map<string, number>;
  /** Headings in reading order, with their page. */
  headings: { id: string; level: number; text: string; page: number }[];
  pageCount: number;
}

export interface Laid {
  /** Smallest content-box height that shows everything (px). */
  needed: number;
  /** Height a `span: "auto"` band should give it (px). Defaults to `needed`. */
  natural: number;
  /** Content stacked top to bottom. */
  chunks: Chunk[];
  /** Repeated at the top of every continuation piece when the component is split across pages. */
  header?: Chunk;
  /** Whether the component may be split between chunks across pages. */
  splittable: boolean;
  diagnostics: Diagnostic[];
  /** Facts for the detailed map (line counts, chosen sizes…). */
  facts?: Record<string, unknown>;
}

export interface ComponentContext {
  registry: FontRegistry;
  tokens: Tokens;
  /** Resolved style of the component (no variant) or of one of its parts. */
  style: (variant?: string) => ResolvedStyle;
  /**
   * The style of a component of another type placed inside this one (a block of a flow),
   * with its own `style` and `styles` on top of the document, regions and classes.
   */
  styleFor: (type: ComponentType, own: { style?: StyleProps; styles?: Record<string, StyleProps> }) => (variant?: string) => ResolvedStyle;
  runStyle: RunStyleContext;
  /** Content-box width (area minus padding and border). */
  width: number;
  /** Content-box height once the band height is known; `null` while measuring. */
  height: number | null;
  /** BCP 47 locale of the document, for numbers the component formats. */
  locale: string;
  /** Grid unit in px, to report sizes in units. */
  unit: number;
  /** Padding + border around the content box, per side (px). */
  inset: number;
  late: Late;
  /** Every heading of the document in declared order, known before anything is placed. */
  outline: OutlineEntry[];
}

export interface ComponentDef<T extends ComponentType = ComponentType> {
  type: T;
  /** `content`: the content decides the height. `area`: the component adapts to the area it gets. */
  sizing: "content" | "area";
  /** Whether the generic box decoration (background, border, radius, padding) applies. */
  decorated: boolean;
  /**
   * On a page the master skips, the box also takes the rows the master reserves when it
   * touches the top or the bottom of the body (a cover fills the whole page).
   */
  fillsPage?: boolean;
  /** Style variants this component reads (for `type.variant` selectors and the map). */
  variants: string[];
  layout: (component: ComponentOf<T>, ctx: ComponentContext) => Laid;
  /** One short line for the map. */
  describe: (component: ComponentOf<T>) => string;
  /**
   * The component as real HTML (headings, paragraphs, lists, tables…) for screen readers
   * and PDF structure. The visual layer is then hidden from assistive technology.
   * Omit it when the visual element is already accessible (an <img> with alt).
   */
  semantic?: (component: ComponentOf<T>, options: SemanticOptions) => string;
  /**
   * A layer under the whole page, drawn on the page of the component's first piece (a cover's
   * full-bleed background): html for a page of width × height, or null for none.
   */
  bleed?: (component: ComponentOf<T>, ctx: ComponentContext) => ((width: number, height: number) => string) | null;
}
