import { z } from "zod";
import { InlineSchema, TextRoleSchema } from "./content";
import { StylePropsSchema } from "./style";
import { HrefSchema, SrcSchema } from "./values";

const base = {
  id: z.string().min(1),
  labels: z.array(z.string()).optional(),
  style: StylePropsSchema.optional(),
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

export const TableComponentSchema = z
  .object({
    ...base,
    type: z.literal("table"),
    content: z
      .object({
        columns: z.array(TableColumnSchema).min(1),
        rows: z.array(z.array(InlineSchema)),
      })
      .strict(),
    props: z
      .object({
        header: z.boolean().optional(),
        zebra: z.boolean().optional(),
        repeatHeader: z.boolean().optional(),
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

export const ChartComponentSchema = z
  .object({
    ...base,
    type: z.literal("chart"),
    content: z
      .object({
        kind: z.enum(["bar", "line", "pie"]),
        categories: z.array(z.string()).min(1),
        series: z.array(z.object({ name: z.string(), values: z.array(z.number()) }).strict()).min(1),
      })
      .strict(),
    props: z
      .object({
        legend: z.boolean().optional(),
        values: z.boolean().optional(),
        unit: z.string().optional(),
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
      })
      .strict(),
    props: z.object({ fit: z.enum(["contain", "cover"]).optional() }).strict().optional(),
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

export const ComponentSchema = z.discriminatedUnion("type", [
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
]);

export type Component = z.infer<typeof ComponentSchema>;
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
];
