import { z } from "zod";
import type { TokenGroup } from "./tokens";
import { ColorSchema, FontFamilySchema } from "./values";

/** A token reference (`$size.m`) or a raw number. */
const TokenOrNumber = z.union([z.string(), z.number()]);

/**
 * The closed set of style properties. Every layer of the cascade (presets, document,
 * region, label, component) speaks this same vocabulary; anything outside it is
 * rejected, so a style can never take a component out of the grid.
 */
export const StylePropsSchema = z
  .object({
    fontFamily: FontFamilySchema,
    fontSize: TokenOrNumber,
    fontWeight: z.number().int().min(100).max(900),
    italic: z.boolean(),
    color: ColorSchema,
    lineHeight: TokenOrNumber,
    align: z.enum(["left", "center", "right"]),
    background: ColorSchema,
    borderColor: ColorSchema,
    borderWidth: z.number().nonnegative(),
    radius: TokenOrNumber,
    padding: TokenOrNumber,
    gap: TokenOrNumber,
    accent: ColorSchema,
    muted: ColorSchema,
  })
  .partial()
  .strict();

export type StyleProps = z.infer<typeof StylePropsSchema>;
export type StyleProp = keyof StyleProps;

export const STYLE_PROPS: StyleProp[] = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "italic",
  "color",
  "lineHeight",
  "align",
  "background",
  "borderColor",
  "borderWidth",
  "radius",
  "padding",
  "gap",
  "accent",
  "muted",
];

/** Which token group a property's `$ref` must point into. `null` = raw values only. */
export const PROP_TOKEN_GROUP: Record<StyleProp, TokenGroup | null> = {
  fontFamily: "font",
  fontSize: "size",
  fontWeight: null,
  italic: null,
  color: "color",
  lineHeight: "lineHeight",
  align: null,
  background: "color",
  borderColor: "color",
  borderWidth: null,
  radius: "radius",
  padding: "space",
  gap: "space",
  accent: "color",
  muted: "color",
};

/** Concrete values after the cascade and token resolution. */
export interface ResolvedStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  lineHeight: number;
  align: "left" | "center" | "right";
  background: string | null;
  borderColor: string;
  borderWidth: number;
  radius: number;
  padding: number;
  gap: number;
  accent: string;
  muted: string;
}

/** Where a resolved value came from: `preset`, `document`, `region:<id>`, `label:<name>`, `component`. */
export type StyleOrigin = string;

export interface ResolvedEntry<T> {
  value: T;
  /** The value as written (`$size.m`, `#fff`, 600). */
  written: unknown;
  origin: StyleOrigin;
}

export type ResolvedStyleWithOrigin = {
  [K in keyof ResolvedStyle]: ResolvedEntry<ResolvedStyle[K]>;
};
