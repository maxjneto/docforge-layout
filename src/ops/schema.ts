import { z } from "zod";
import { ComponentSchema } from "../schema/components";
import { RegionSchema } from "../schema/document";
import { StylePropsSchema } from "../schema/style";
import { TokenOverridesSchema } from "../schema/tokens";

/**
 * Operations arrive from agents and HTTP callers, so their shape is checked like a
 * document is: a malformed op becomes an `invalid-op` diagnostic that names the
 * field, never an exception. Ids that point at nothing are checked when the op runs.
 */

const Ref = z.string().min(1);
const Span = z.union([z.number().int().min(1), z.literal("auto")], { error: 'expected a whole number of rows (1 or more) or "auto"' });
const After = z.string().min(1).nullable();

export const PositionSchema = z
  .object({
    section: Ref,
    band: Ref,
    colStart: z.number().int().min(1),
    colSpan: z.number().int().min(1),
    /** Create the band if it does not exist yet. */
    newBand: z.object({ span: Span.optional(), after: Ref.optional() }).strict().optional(),
  })
  .strict();

const SetStyleSchema = z.discriminatedUnion("layer", [
  z.object({ op: z.literal("setStyle"), layer: z.literal("document"), selector: Ref, style: StylePropsSchema.nullable() }).strict(),
  z.object({ op: z.literal("setStyle"), layer: z.literal("label"), label: Ref, style: StylePropsSchema.nullable() }).strict(),
]);

/** One schema per op name, so an error talks about the op the caller meant. */
export const OP_SCHEMAS = {
  add: z.object({ op: z.literal("add"), component: ComponentSchema, at: PositionSchema }).strict(),
  place: z.object({ op: z.literal("place"), component: Ref, at: PositionSchema }).strict(),
  update: z
    .object({
      op: z.literal("update"),
      component: Ref,
      /** Replaces the content; checked against the component type when the document is laid out. */
      content: z.unknown().optional(),
      props: z.record(z.string(), z.unknown()).optional(),
      labels: z.array(z.string()).optional(),
      /** Merged into the component's own style; `null` clears it. */
      style: StylePropsSchema.nullable().optional(),
    })
    .strict(),
  remove: z.object({ op: z.literal("remove"), component: Ref }).strict(),
  addSection: z
    .object({ op: z.literal("addSection"), section: z.object({ id: Ref, name: z.string().optional() }).strict(), after: Ref.optional() })
    .strict(),
  addBand: z
    .object({ op: z.literal("addBand"), section: Ref, band: z.object({ id: Ref, span: Span.optional() }).strict(), after: Ref.optional() })
    .strict(),
  setBand: z.object({ op: z.literal("setBand"), band: Ref, span: Span }).strict(),
  moveBand: z.object({ op: z.literal("moveBand"), band: Ref, section: Ref.optional(), after: After.optional() }).strict(),
  removeBand: z.object({ op: z.literal("removeBand"), band: Ref }).strict(),
  setStyle: SetStyleSchema,
  setRegion: z.object({ op: z.literal("setRegion"), region: RegionSchema }).strict(),
  removeRegion: z.object({ op: z.literal("removeRegion"), region: Ref }).strict(),
  setTokens: z.object({ op: z.literal("setTokens"), tokens: TokenOverridesSchema }).strict(),
} as const;

export type OpName = keyof typeof OP_SCHEMAS;
export const OP_NAMES = Object.keys(OP_SCHEMAS) as OpName[];

export const OpSchema = z.union(Object.values(OP_SCHEMAS) as unknown as [z.ZodTypeAny, ...z.ZodTypeAny[]]);

export type Op = { [K in OpName]: z.infer<(typeof OP_SCHEMAS)[K]> }[OpName];
export type Position = z.infer<typeof PositionSchema>;

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
