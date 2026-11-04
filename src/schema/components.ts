import { z } from "zod";
import { InlineSchema, TextRoleSchema } from "./content";
import { PlacementSchema } from "./placement";
import { StylePropsSchema } from "./style";
import { ColorSchema, HrefSchema, SrcSchema } from "./values";

const base = {
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "ids use letters, digits, - and _"),
  /** Where the component sits. A component without `at` is kept but not drawn. */
  at: PlacementSchema.optional(),
  labels: z.array(z.string()).optional(),
  style: StylePropsSchema.optional(),
  /** Style for one part of this component (`header` of a table, `label` of a KPI, `title-2` of a text), over `style`. */
  styles: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/, "part names use lowercase letters, digits and -"), StylePropsSchema).optional(),
};

export const ParagraphSchema = z.union([
  z.string(),
  z.object({ role: TextRoleSchema.optional(), text: InlineSchema }).strict(),
]);
export type Paragraph = z.infer<typeof ParagraphSchema>;

export const TextComponentSchema = z
  .object({
    ...base,
    type: z.literal("text"),
    content: z.object({ paragraphs: z.array(ParagraphSchema).min(1) }).strict(),
    props: z.object({ role: TextRoleSchema.optional() }).strict().optional(),
  })
  .strict();

export interface ListItem {
  text: z.infer<typeof InlineSchema>;
  checked?: boolean;
  items?: ListItemInput[];
}
export type ListItemInput = string | ListItem;

export const ListItemSchema: z.ZodType<ListItemInput> = z.lazy(() =>
  z.union([
    z.string(),
    z
      .object({
        text: InlineSchema,
        checked: z.boolean().optional(),
        items: z.array(ListItemSchema).optional(),
      })
      .strict(),
  ]),
);

export const ListComponentSchema = z
  .object({
    ...base,
    type: z.literal("list"),
    content: z.object({ items: z.array(ListItemSchema).min(1) }).strict(),
    props: z.object({ marker: z.enum(["bullet", "number", "check"]).optional() }).strict().optional(),
  })
  .strict();

export const TableColumnSchema = z.union([
  z.string(),
  z
    .object({
      header: z.string(),
      width: z.number().positive().optional(),
      align: z.enum(["left", "center", "right"]).optional(),
    })
    .strict(),
]);

/** A table cell: inline text, or an object to span columns or align one cell. */
export const TableCellSchema = z.union([
  InlineSchema,
  z
    .object({
      text: InlineSchema,
      /** Columns this cell covers (horizontal only). */
      span: z.number().int().min(1).max(48).optional(),
      align: z.enum(["left", "center", "right"]).optional(),
    })
    .strict(),
]);
export type TableCell = z.infer<typeof TableCellSchema>;

export const TableComponentSchema = z
  .object({
    ...base,
    type: z.literal("table"),
    content: z
      .object({
        columns: z.array(TableColumnSchema).min(1),
        rows: z.array(z.array(TableCellSchema)),
        /** Last row, drawn with the `footer` part (totals); it never sits alone on a page. */
        footer: z.array(TableCellSchema).optional(),
      })
      .strict(),
    props: z
      .object({
        header: z.boolean().optional(),
        zebra: z.boolean().optional(),
        repeatHeader: z.boolean().optional(),
        /**
         * `auto`: each column as wide as its content asks, like a browser (default when no column
         * declares `width`). `fixed`: split by the columns' `width` weights (default when one does).
         */
        columnWidths: z.enum(["auto", "fixed"]).optional(),
        /** A numeric column (header text or 0-based index) whose cells get a bar proportional to the largest value. */
        bars: z.union([z.string(), z.number().int().min(0)]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const CodeComponentSchema = z
  .object({
    ...base,
    type: z.literal("code"),
    content: z.object({ code: z.string(), language: z.string().optional() }).strict(),
    props: z.object({}).strict().optional(),
  })
  .strict();

export const StepsComponentSchema = z
  .object({
    ...base,
    type: z.literal("steps"),
    content: z
      .object({
        steps: z.array(z.object({ title: z.string(), text: InlineSchema.optional() }).strict()).min(1),
      })
      .strict(),
    props: z.object({}).strict().optional(),
  })
  .strict();

export const TimelineComponentSchema = z
  .object({
    ...base,
    type: z.literal("timeline"),
    content: z
      .object({
        events: z
          .array(z.object({ date: z.string(), title: z.string(), text: InlineSchema.optional() }).strict())
          .min(1),
      })
      .strict(),
    props: z.object({}).strict().optional(),
  })
  .strict();

export const KpiComponentSchema = z
  .object({
    ...base,
    type: z.literal("kpi"),
    content: z
      .object({
        value: z.string(),
        label: z.string(),
        delta: z.string().optional(),
        trend: z.enum(["up", "down", "flat"]).optional(),
        /** A small line under the delta, in the trend's color (3 to 60 values). */
        sparkline: z.array(z.number()).min(3).max(60).optional(),
      })
      .strict(),
    props: z.object({ href: HrefSchema.optional() }).strict().optional(),
  })
  .strict();

export const CardComponentSchema = z
  .object({
    ...base,
    type: z.literal("card"),
    content: z
      .object({
        /** Small line above the title. */
        eyebrow: z.string().optional(),
        title: InlineSchema,
        /** A large figure under the title (optional). */
        value: z.string().optional(),
        text: InlineSchema.optional(),
        /** Last line, e.g. "Ver detalhes →". */
        footer: InlineSchema.optional(),
      })
      .strict(),
    /** `href` makes the whole card a link. */
    props: z.object({ href: HrefSchema.optional() }).strict().optional(),
  })
  .strict();

export const CHART_KINDS = ["bar", "line", "area", "pie", "donut", "scatter"] as const;

const ValuesSeriesSchema = z.object({ name: z.string(), values: z.array(z.number()) }).strict();
/** Scatter: each point is [x, y]. */
const PointsSeriesSchema = z.object({ name: z.string(), points: z.array(z.tuple([z.number(), z.number()])).min(1) }).strict();

export const ChartComponentSchema = z
  .object({
    ...base,
    type: z.literal("chart"),
    content: z
      .object({
        kind: z.enum(CHART_KINDS),
        /** One label per value (every kind but scatter). */
        categories: z.array(z.string()).min(1).optional(),
        series: z.array(z.union([ValuesSeriesSchema, PointsSeriesSchema])).min(1),
      })
      .strict()
      .superRefine((c, issue) => {
        if (c.kind === "scatter") {
          if (c.categories) issue.addIssue({ code: "custom", path: ["categories"], message: "a scatter chart has no categories: its series give points [x, y]" });
          c.series.forEach((s, i) => {
            if (!("points" in s)) issue.addIssue({ code: "custom", path: ["series", i], message: "scatter series give points: [[x, y], …]" });
          });
        } else {
          if (!c.categories) issue.addIssue({ code: "custom", path: ["categories"], message: `a ${c.kind} chart needs categories` });
          c.series.forEach((s, i) => {
            if (!("values" in s)) issue.addIssue({ code: "custom", path: ["series", i], message: `${c.kind} series give values (points are for scatter)` });
          });
        }
      }),
    props: z
      .object({
        legend: z.boolean().optional(),
        values: z.boolean().optional(),
        unit: z.string().optional(),
        /** bar: categories along the left and bars to the right. */
        orientation: z.enum(["vertical", "horizontal"]).optional(),
        /** bar and area: series added on top of each other. */
        stacked: z.boolean().optional(),
        legendPosition: z.enum(["bottom", "right"]).optional(),
        /** Horizontal lines at each tick (default on for bar, line, area and scatter). */
        grid: z.boolean().optional(),
        axis: z
          .object({ x: z.string().optional(), y: z.string().optional(), min: z.number().optional(), max: z.number().optional() })
          .strict()
          .optional(),
        /** One color per series (per category in pie and donut); default chart1…chart6. */
        colors: z.array(ColorSchema).min(1).optional(),
        /** donut: short text in the hole (default: the total). */
        center: z.string().max(40).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ImageComponentSchema = z
  .object({
    ...base,
    type: z.literal("image"),
    content: z
      .object({
        src: SrcSchema,
        alt: z.string(),
        width: z.number().positive(),
        height: z.number().positive(),
        /** A line under the image. */
        caption: InlineSchema.optional(),
      })
      .strict(),
    props: z
      .object({
        fit: z.enum(["contain", "cover"]).optional(),
        /** Number the caption: "Figure 3" (in the document's language), counted in reading order. */
        figure: z.boolean().optional(),
        /** The image is a link. */
        href: HrefSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const CALLOUT_KINDS = ["note", "tip", "warning", "important", "success"] as const;

export const CalloutComponentSchema = z
  .object({
    ...base,
    type: z.literal("callout"),
    content: z.object({ title: z.string().optional(), text: InlineSchema }).strict(),
    props: z.object({ kind: z.enum(CALLOUT_KINDS).optional(), icon: z.boolean().optional() }).strict().optional(),
  })
  .strict();

export const TagsComponentSchema = z
  .object({
    ...base,
    type: z.literal("tags"),
    content: z
      .object({
        items: z.array(z.union([z.string().min(1), z.object({ text: z.string().min(1), color: ColorSchema.optional() }).strict()])).min(1),
      })
      .strict(),
    props: z.object({ size: z.enum(["s", "m"]).optional() }).strict().optional(),
  })
  .strict();

export const ProgressComponentSchema = z
  .object({
    ...base,
    type: z.literal("progress"),
    content: z
      .object({
        items: z
          .array(
            z
              .object({
                label: z.string(),
                value: z.number(),
                /** Default 100 for bars, 5 for stars and dots. */
                max: z.number().optional(),
                /** Shown on the right instead of the number. */
                text: z.string().optional(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    props: z.object({ kind: z.enum(["bar", "stars", "dots"]).optional(), showValue: z.boolean().optional() }).strict().optional(),
  })
  .strict();

export const DividerComponentSchema = z
  .object({
    ...base,
    type: z.literal("divider"),
    content: z.object({}).strict().optional(),
    props: z.object({ kind: z.enum(["line", "space"]).optional() }).strict().optional(),
  })
  .strict();

export const CoverComponentSchema = z
  .object({
    ...base,
    type: z.literal("cover"),
    content: z
      .object({
        eyebrow: z.string().optional(),
        title: z.string().min(1),
        subtitle: z.string().optional(),
        meta: z.array(z.object({ label: z.string(), value: z.string() }).strict()).max(8).optional(),
      })
      .strict(),
    props: z
      .object({
        align: z.enum(["left", "center"]).optional(),
        vertical: z.enum(["top", "middle", "bottom"]).optional(),
        /** A color (or token), or an image that fills the background. */
        background: z.union([ColorSchema, z.object({ src: SrcSchema, fit: z.enum(["cover", "contain"]).optional() }).strict()]).optional(),
        /** The background reaches the page's edges (the text keeps to the margins). */
        fullBleed: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const TocComponentSchema = z
  .object({
    ...base,
    type: z.literal("toc"),
    content: z.object({ title: z.string().optional() }).strict().optional(),
    props: z
      .object({
        /** Which titles to list (default title-1 and title-2). */
        levels: z.array(z.enum(["display", "title-1", "title-2", "title-3"])).min(1).optional(),
        /** Page numbers on the right (default on). */
        pages: z.boolean().optional(),
        /** A dotted line between a title and its page (default on). */
        leaders: z.boolean().optional(),
        /** List titles from this page on (default: the page after the table of contents). */
        from: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** A component written inside a flow: no position, an optional id (a link target), `h` in units for area types. */
const BLOCK_OMIT = { id: true, at: true, labels: true } as const;
const BLOCK_FIELDS = { id: base.id.optional(), h: z.number().int().min(1).optional() };

export const BreakBlockSchema = z.object({ type: z.literal("break") }).strict();

/** Every type that may sit inside a flow (all but flow itself). */
const FlowBlockObjectUnion = z.discriminatedUnion("type", [
  BreakBlockSchema,
  TextComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  ListComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  TableComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  CodeComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  StepsComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  TimelineComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  KpiComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  CardComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  ChartComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  ImageComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  DividerComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  CalloutComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  TagsComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  ProgressComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
  TocComponentSchema.omit(BLOCK_OMIT).extend(BLOCK_FIELDS).strict(),
]);
export type FlowBlockObject = z.infer<typeof FlowBlockObjectUnion>;
// Typed by name so declarations that include a flow refer to the type instead of spelling it out.
export const FlowBlockObjectSchema: z.ZodType<FlowBlockObject> = FlowBlockObjectUnion;

/**
 * One block of a flow. A string is a paragraph (inline markdown); `# `, `## `, `### ` and `> `
 * at its start make it a title-1/2/3 or a quote. `{ "type": "break" }` starts a new page.
 */
export type FlowBlock = string | FlowBlockObject;
export const FlowBlockSchema: z.ZodType<FlowBlock> = z.union([z.string(), FlowBlockObjectUnion]);

export const FlowComponentSchema = z
  .object({
    ...base,
    type: z.literal("flow"),
    content: z.object({ blocks: z.array(FlowBlockSchema).min(1) }).strict(),
    props: z.object({}).strict().optional(),
  })
  .strict();

const ComponentUnion = z.discriminatedUnion("type", [
  FlowComponentSchema,
  TextComponentSchema,
  ListComponentSchema,
  TableComponentSchema,
  CodeComponentSchema,
  StepsComponentSchema,
  TimelineComponentSchema,
  KpiComponentSchema,
  CardComponentSchema,
  ChartComponentSchema,
  ImageComponentSchema,
  DividerComponentSchema,
  CalloutComponentSchema,
  TagsComponentSchema,
  ProgressComponentSchema,
  CoverComponentSchema,
  TocComponentSchema,
]);

export type Component = z.infer<typeof ComponentUnion>;
/** Any component. Typed by name, so schemas that contain components refer to it instead of spelling it out. */
export const ComponentSchema: z.ZodType<Component> = ComponentUnion;
export type ComponentType = Component["type"];
export type ComponentOf<T extends ComponentType> = Extract<Component, { type: T }>;

export const COMPONENT_TYPES: ComponentType[] = [
  "text",
  "list",
  "table",
  "code",
  "steps",
  "timeline",
  "kpi",
  "card",
  "chart",
  "image",
  "divider",
  "callout",
  "tags",
  "progress",
  "cover",
  "toc",
  "flow",
];

const MasterAtSchema = z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1), h: z.number().int().min(1) }).strict();
export type MasterAt = z.infer<typeof MasterAtSchema>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A component of a page master: always a fixed box, no page. */
export type MasterComponent = DistributiveOmit<Exclude<Component, { type: "flow" }>, "at"> & { at: MasterAt };

/** Every type but flow, with a fixed box measured from the top of the margins. */
export const MasterComponentSchema = z.discriminatedUnion(
  "type",
  ComponentUnion.options.filter((s) => s.shape.type.value !== "flow").map((s) => s.extend({ at: MasterAtSchema }).strict()) as unknown as [
    typeof TextComponentSchema,
    ...(typeof TextComponentSchema)[],
  ],
) as unknown as z.ZodType<MasterComponent>;

/**
 * Drawn on every page it applies to, behind the body: a header, a footer, a page number,
 * a logo. `reserve` takes rows from the body at the top and bottom of every page.
 */
export interface Master {
  /** Pages it is drawn on (1-based list), default all. */
  pages?: "all" | "except-first" | number[];
  /** Rows taken from the body at the top and bottom of every page. */
  reserve?: { top?: number; bottom?: number };
  components: MasterComponent[];
}
export const MasterSchema: z.ZodType<Master> = z
  .object({
    pages: z.union([z.enum(["all", "except-first"]), z.array(z.number().int().min(1)).min(1)]).optional(),
    reserve: z.object({ top: z.number().int().min(0).optional(), bottom: z.number().int().min(0).optional() }).strict().optional(),
    components: z.array(MasterComponentSchema).max(24),
  })
  .strict();
