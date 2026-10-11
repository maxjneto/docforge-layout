import { z } from "zod";
import { ComponentSchema } from "./components";
import { StylePropsSchema } from "./style";
import { TokenOverridesSchema } from "./tokens";

const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "ids use letters, digits, - and _");

export const GridSchema = z
  .object({
    /** Number of columns. */
    columns: z.number().int().min(1).max(48),
    /** Horizontal gap between columns, in px. */
    columnGap: z.number().nonnegative(),
    /** Height of one grid row unit, in px. A band of span N is N × rowUnit tall. */
    rowUnit: z.number().positive(),
    /** Vertical gap between bands, in px. */
    bandGap: z.number().nonnegative(),
    /** Vertical gap between sections, in px. */
    sectionGap: z.number().nonnegative(),
  })
  .strict();
export type Grid = z.infer<typeof GridSchema>;

export const defaultGrid: Grid = { columns: 12, columnGap: 16, rowUnit: 8, bandGap: 16, sectionGap: 32 };

const Margin = z.union([
  z.number().nonnegative(),
  z
    .object({
      top: z.number().nonnegative(),
      right: z.number().nonnegative(),
      bottom: z.number().nonnegative(),
      left: z.number().nonnegative(),
    })
    .strict(),
]);

export const PAGE_SIZES = {
  A4: { width: (210 * 96) / 25.4, height: (297 * 96) / 25.4 },
  Letter: { width: 8.5 * 96, height: 11 * 96 },
} as const;

export const SurfaceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: Id,
      kind: z.literal("page"),
      size: z.union([
        z.enum(["A4", "Letter"]),
        z.object({ width: z.number().positive(), height: z.number().positive() }).strict(),
      ]),
      margin: Margin,
    })
    .strict(),
  z
    .object({
      id: Id,
      kind: z.literal("continuous"),
      /** Page width in px; the height follows the content. */
      width: z.number().positive(),
      margin: Margin,
    })
    .strict(),
]);
export type Surface = z.infer<typeof SurfaceSchema>;

export const BandItemSchema = z
  .object({
    component: Id,
    /** First column, 1-based. */
    colStart: z.number().int().min(1),
    colSpan: z.number().int().min(1),
  })
  .strict();
export type BandItem = z.infer<typeof BandItemSchema>;

export const BandSchema = z
  .object({
    id: Id,
    /** Height in grid row units, or `auto` to fit the tallest component. */
    span: z.union([z.number().int().min(1), z.literal("auto")]),
    items: z.array(BandItemSchema),
  })
  .strict();
export type Band = z.infer<typeof BandSchema>;

export const SectionSchema = z
  .object({
    id: Id,
    name: z.string().optional(),
    bands: z.array(BandSchema),
  })
  .strict();
export type Section = z.infer<typeof SectionSchema>;

/** A style layer bound to grid positions: a section, optionally some of its bands and a column range. */
export const RegionSchema = z
  .object({
    id: Id,
    section: Id,
    bands: z.array(Id).optional(),
    cols: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
    style: StylePropsSchema,
  })
  .strict();
export type Region = z.infer<typeof RegionSchema>;

export const StylesSchema = z
  .object({
    /** Document layer, keyed by selector: a component type (`text`) or type.variant (`text.title-1`). */
    document: z.record(z.string(), StylePropsSchema).optional(),
    regions: z.array(RegionSchema).optional(),
    labels: z.record(z.string(), StylePropsSchema).optional(),
  })
  .strict();
export type Styles = z.infer<typeof StylesSchema>;

export const DocumentSchema = z
  .object({
    format: z.literal("docforge/layout"),
    version: z.literal(1),
    meta: z
      .object({
        title: z.string().optional(),
        /** BCP 47 locale for numbers and dates the library formats (chart axes…). Default en-US. */
        locale: z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    grid: GridSchema.optional(),
    tokens: TokenOverridesSchema.optional(),
    styles: StylesSchema.optional(),
    surfaces: z.array(SurfaceSchema).min(1),
    sections: z.array(SectionSchema),
    components: z.array(ComponentSchema),
  })
  .strict();

export type LayoutDocument = z.infer<typeof DocumentSchema>;
