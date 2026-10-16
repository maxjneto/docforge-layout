import { z } from "zod";
import { ComponentSchema } from "./components";
import { RectSchema } from "./placement";
import { StylePropsSchema } from "./style";
import { TokenOverridesSchema } from "./tokens";

const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "ids use letters, digits, - and _");

/**
 * The grid every position is measured in. `unit` is the size of one square cell in px;
 * `columns` and `gutter` only draw alignment guides (the editor snaps to them and ops
 * may place by `cols`), they never limit where a component goes.
 */
export const GridSchema = z
  .object({
    /** Size of one grid unit, in px. x, y, w and h are all in units. */
    unit: z.number().min(2).max(64),
    /** Number of guide columns across the content area. */
    columns: z.number().int().min(1).max(48),
    /** Space between guide columns, in px. */
    gutter: z.number().nonnegative(),
    /** Units left between two components when one pushes the other (if they had no gap of their own). */
    gap: z.number().int().min(0).max(16),
  })
  .strict();
export type Grid = z.infer<typeof GridSchema>;

export const defaultGrid: Grid = { unit: 8, columns: 12, gutter: 16, gap: 2 };

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
  /** A 16:9 slide, PowerPoint's default (13.333 × 7.5 in). */
  Slide: { width: 1280, height: 720 },
} as const;
export type PageSizeName = keyof typeof PAGE_SIZES;

export const SurfaceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: Id,
      kind: z.literal("page"),
      size: z.union([
        z.enum(["A4", "Letter", "Slide"]),
        z.object({ width: z.number().positive(), height: z.number().positive() }).strict(),
      ]),
      margin: Margin,
      /** Going over is reported, never refused. */
      maxPages: z.number().int().min(1).optional(),
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

/** A style layer bound to an area of the grid: components whose declared top-left corner is inside get it. */
export const RegionSchema = z
  .object({
    id: Id,
    ...RectSchema.shape,
    style: StylePropsSchema,
  })
  .strict();
export type Region = z.infer<typeof RegionSchema>;

export const StylesSchema = z
  .object({
    /** Document layer, keyed by selector: a component type (`text`) or type.variant (`text.title-1`). */
    document: z.record(z.string(), StylePropsSchema).optional(),
    regions: z.array(RegionSchema).optional(),
    /** Classes: components list them in `labels`. */
    labels: z.record(z.string(), StylePropsSchema).optional(),
  })
  .strict();
export type Styles = z.infer<typeof StylesSchema>;

export const FORMAT = "docforge/layout";
/**
 * The format version this library writes. It goes up whenever the schema accepts
 * something an older library would refuse (3: the `Slide` page size). See `format.ts`.
 */
export const VERSION = 3;
/**
 * Versions read as they are: every change from them to `VERSION` is only the number
 * (2 → 3 added options, removed nothing). Version 1 needs `upgradeDocument`.
 */
export const SAME_SHAPE_VERSIONS = [2, 3] as const;

function versionError(input: unknown): string {
  if (typeof input === "number" && Number.isInteger(input) && input > VERSION) {
    return `this document is format version ${input}; this library reads up to ${VERSION}: update @docforge-lib/layout (or ask the server for format ${VERSION})`;
  }
  if (input === 1) return "version 1 document: convert it with upgradeDocument";
  return `expected format version ${VERSION}`;
}

export const DocumentSchema = z
  .object({
    format: z.literal(FORMAT),
    // Older versions with the same shape are accepted and come out as the current one.
    version: z
      .union(SAME_SHAPE_VERSIONS.map((v) => z.literal(v)), { error: (issue) => versionError(issue.input) })
      .transform((): typeof VERSION => VERSION),
    meta: z
      .object({
        title: z.string().optional(),
        /** BCP 47 locale for numbers and dates the library formats (chart axes…). Default en-US. */
        locale: z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).optional(),
        /** Name of the theme the tokens came from (informative: the tokens are what renders). */
        theme: z.string().max(120).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    grid: GridSchema.partial().optional(),
    tokens: TokenOverridesSchema.optional(),
    styles: StylesSchema.optional(),
    surfaces: z.array(SurfaceSchema).min(1),
    components: z.array(ComponentSchema),
  })
  .strict();

export type LayoutDocument = z.infer<typeof DocumentSchema>;

/** A document with nothing in it: one A4 surface. */
export function emptyDocument(title?: string): LayoutDocument {
  return {
    format: FORMAT,
    version: VERSION,
    ...(title ? { meta: { title } } : {}),
    surfaces: [{ id: "a4", kind: "page", size: "A4", margin: 40 }],
    components: [],
  };
}
