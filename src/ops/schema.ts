import { z } from "zod";
import { ComponentSchema } from "../schema/components";
import { GridSchema, RegionSchema, SurfaceSchema } from "../schema/document";
import { StylePropsSchema } from "../schema/style";
import { TokenOverridesSchema } from "../schema/tokens";

/**
 * Operations arrive from agents and HTTP callers, so their shape is checked like a
 * document is: a malformed op becomes an `invalid-op` diagnostic that names the
 * field, never an exception. Ids that point at nothing are checked when the op runs.
 */

const Ref = z.string().min(1);
const Int0 = z.number().int().min(0);
const Int1 = z.number().int().min(1);

/**
 * Where to put a component. Relative forms are resolved when the op runs and stored
 * as an absolute position:
 * - `{page, x, y, w, h?}` absolute, in units;
 * - `cols: [first, last]` instead of x/w: span those guide columns;
 * - `below: "id"` instead of page/y: under where that component is drawn now, `gap` units apart;
 * - `end: true` instead of y: under the lowest box of `page` (default: the last page).
 * In `place`, anything left out keeps the component's current value. `h: null` removes the minimum height.
 */
export const AtSchema = z
  .object({
    page: Int1.optional(),
    x: Int0.optional(),
    y: Int0.optional(),
    w: Int1.optional(),
    h: Int1.nullable().optional(),
    cols: z.tuple([Int1, Int1]).optional(),
    below: Ref.optional(),
    end: z.literal(true).optional(),
    gap: Int0.optional(),
  })
  .strict();
export type AtInput = z.infer<typeof AtSchema>;

const SetStyleSchema = z.discriminatedUnion("layer", [
  z.object({ op: z.literal("setStyle"), layer: z.literal("document"), selector: Ref, style: StylePropsSchema.nullable() }).strict(),
  z.object({ op: z.literal("setStyle"), layer: z.literal("label"), label: Ref, style: StylePropsSchema.nullable() }).strict(),
]);

/** One schema per op name, so an error talks about the op the caller meant. */
export const OP_SCHEMAS = {
  add: z.object({ op: z.literal("add"), component: ComponentSchema, at: AtSchema }).strict(),
  place: z.object({ op: z.literal("place"), component: Ref, at: AtSchema }).strict(),
  update: z
    .object({
      op: z.literal("update"),
      component: Ref,
      /** Replaces the content; checked against the component type when the document is laid out. */
      content: z.unknown().optional(),
      /** Merged into the component's props; `null` clears them (send null, then the new props, to replace). */
      props: z.record(z.string(), z.unknown()).nullable().optional(),
      labels: z.array(z.string()).optional(),
      /** Merged into the component's own style; `null` clears it. */
      style: StylePropsSchema.nullable().optional(),
    })
    .strict(),
  /**
   * Change parts of a component's content without rewriting the rest. Paths are dotted,
   * relative to `content`, with numbers for list positions: `paragraphs.1`, `rows.2.0`,
   * `items.0.text`. `set` replaces (an index one past the end appends); `remove` deletes
   * (array items are taken out, so later indexes shift). Removals run after the sets.
   */
  edit: z
    .object({
      op: z.literal("edit"),
      component: Ref,
      set: z.record(z.string().min(1), z.unknown()).optional(),
      remove: z.array(z.string().min(1)).optional(),
    })
    .strict()
    .refine((o) => o.set !== undefined || o.remove !== undefined, { message: "give set and/or remove" }),
  /**
   * Replace text in every piece of text content (paragraphs, titles, cells, items, runs…).
   * Limit it with `components`. Case-sensitive unless `matchCase: false`. Finding nothing
   * is an error, so a typo in `find` never passes silently.
   */
  replaceText: z
    .object({
      op: z.literal("replaceText"),
      find: z.string().min(1),
      replace: z.string(),
      components: z.array(Ref).optional(),
      matchCase: z.boolean().optional(),
    })
    .strict(),
  /**
   * Put components side by side across guide columns, in one op: new components
   * (objects) are added, existing ones (ids) are moved. The row spans `cols`
   * (default: every guide column), split by `widths` (proportions, default equal) into
   * whole columns. Its y comes from `below`, `end` or `page` + `y`, like `add`.
   * `h` gives every item the same minimum height; `align: "stretch"` makes them all
   * as tall as the tallest. Resolved when the op runs and stored as absolute positions.
   */
  row: z
    .object({
      op: z.literal("row"),
      items: z.array(z.union([Ref, ComponentSchema])).min(1).max(12),
      page: Int1.optional(),
      y: Int0.optional(),
      below: Ref.optional(),
      end: z.literal(true).optional(),
      gap: Int0.optional(),
      cols: z.tuple([Int1, Int1]).optional(),
      widths: z.array(z.number().positive()).optional(),
      h: Int1.optional(),
      align: z.enum(["top", "stretch"]).optional(),
    })
    .strict(),
  remove: z.object({ op: z.literal("remove"), component: Ref }).strict(),
  setStyle: SetStyleSchema,
  setRegion: z.object({ op: z.literal("setRegion"), region: RegionSchema }).strict(),
  removeRegion: z.object({ op: z.literal("removeRegion"), region: Ref }).strict(),
  setTokens: z.object({ op: z.literal("setTokens"), tokens: TokenOverridesSchema }).strict(),
  /** Changing `unit` converts every position so sizes stay the same in px; guides never move anything. */
  setGrid: z.object({ op: z.literal("setGrid"), grid: GridSchema.partial() }).strict(),
  /**
   * Add or replace a surface (by id). `primary` makes it the default surface. `fitWidth`
   * stretches or squeezes every x and w in proportion when the primary surface's width
   * changes, so a layout made for one width keeps its shape on another.
   */
  setSurface: z
    .object({ op: z.literal("setSurface"), surface: SurfaceSchema, primary: z.boolean().optional(), fitWidth: z.boolean().optional() })
    .strict(),
  removeSurface: z.object({ op: z.literal("removeSurface"), surface: Ref }).strict(),
  /**
   * Work on whole pages (slides), by declared position:
   * - `insert`: an empty page after `page` (0 = before the first); later pages move down one;
   * - `duplicate`: a copy of `page` right after it (copied components get new ids, `<id>-2`…);
   * - `remove`: delete `page` and everything declared on it; later pages move up one;
   * - `move`: put `page` at position `to`; the pages in between shift by one.
   * Components keep x, y, w and h; regions bound to a page follow it.
   */
  page: z
    .object({
      op: z.literal("page"),
      action: z.enum(["insert", "duplicate", "remove", "move"]),
      page: Int0,
      to: Int1.optional(),
    })
    .strict(),
  /**
   * Move components up into the empty space above them. Limit it to some components or
   * one page; `gap` overrides the units kept between boxes; `acrossPages` lets a component
   * at the top of a page move to the end of the previous one when it fits.
   */
  compact: z
    .object({
      op: z.literal("compact"),
      components: z.array(Ref).optional(),
      page: Int1.optional(),
      gap: Int0.optional(),
      acrossPages: z.boolean().optional(),
    })
    .strict(),
  /**
   * Make the document fit `pages` (default: the surface's maxPages) with the strategies
   * named, mildest first: compact, heights (minimum heights down to what content needs),
   * spacing, type (text sizes down to `minScale`).
   * Applies nothing when it cannot fit, and says so.
   */
  fit: z
    .object({
      op: z.literal("fit"),
      pages: Int1.optional(),
      strategies: z.array(z.enum(["compact", "heights", "spacing", "type"])).min(1).optional(),
      minScale: z.number().min(0.5).max(1).optional(),
    })
    .strict(),
  /** Title, locale (BCP 47, for numbers the library formats) and the theme's name; `null` removes a field. */
  setMeta: z
    .object({
      op: z.literal("setMeta"),
      meta: z
        .object({
          title: z.string().max(300).nullable().optional(),
          locale: z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).nullable().optional(),
          theme: z.string().max(120).nullable().optional(),
        })
        .strict(),
    })
    .strict(),
} as const;

export type OpName = keyof typeof OP_SCHEMAS;
export const OP_NAMES = Object.keys(OP_SCHEMAS) as OpName[];

export const OpSchema = z.union(Object.values(OP_SCHEMAS) as unknown as [z.ZodTypeAny, ...z.ZodTypeAny[]]);

export type Op = { [K in OpName]: z.infer<(typeof OP_SCHEMAS)[K]> }[OpName];

/** Check one op. Returns the parsed op, or a message naming each bad field. */
export function parseOp(input: unknown): { ok: true; op: Op } | { ok: false; message: string } {
  const name = (input as { op?: unknown } | null)?.op;
  if (typeof name !== "string" || !(name in OP_SCHEMAS)) {
    return { ok: false, message: `"op" must be one of ${OP_NAMES.join(", ")}; got ${JSON.stringify(name ?? null)}.` };
  }
  const result = OP_SCHEMAS[name as OpName].safeParse(input);
  if (result.success) return { ok: true, op: result.data as Op };
  const fields = result.error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(op)";
    return `${path}: ${issue.message}`;
  });
  return { ok: false, message: `invalid fields — ${fields.slice(0, 6).join("; ")}${fields.length > 6 ? `; +${fields.length - 6} more` : ""}.` };
}
