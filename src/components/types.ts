import type { ComponentOf, ComponentType } from "../schema/components";
import type { ResolvedStyle } from "../schema/style";
import type { Tokens } from "../schema/tokens";
import type { FontRegistry } from "../fonts/registry";
import type { RunStyleContext } from "../text/layout";
import type { Diagnostic } from "../validate/diagnostics";

/** A horizontal slice of a component, drawn at (x, y) inside the component's content box. */
export interface Chunk {
  height: number;
  html: (x: number, y: number) => string;
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
  runStyle: RunStyleContext;
  /** Content-box width (area minus padding and border). */
  width: number;
  /** Content-box height once the band height is known; `null` while measuring. */
  height: number | null;
  /** BCP 47 locale of the document, for numbers the component formats. */
  locale: string;
}

export interface ComponentDef<T extends ComponentType = ComponentType> {
  type: T;
  /** `content`: the content decides the height. `area`: the component adapts to the area it gets. */
  sizing: "content" | "area";
  /** Whether the generic box decoration (background, border, radius, padding) applies. */
  decorated: boolean;
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
  semantic?: (component: ComponentOf<T>, options: { locale: string }) => string;
}
