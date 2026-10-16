import { z } from "zod";
import { ColorLiteralSchema, FontFamilyLiteralSchema } from "./values";

/**
 * Design tokens. Style values reference them as `$group.key` (e.g. `$color.primary`,
 * `$size.m`), so changing a token restyles every component that points at it.
 */
export const TOKEN_GROUPS = ["color", "font", "size", "space", "radius", "lineHeight"] as const;
export type TokenGroup = (typeof TOKEN_GROUPS)[number];

export const TokensSchema = z
  .object({
    color: z.record(z.string(), ColorLiteralSchema),
    font: z.record(z.string(), FontFamilyLiteralSchema),
    size: z.record(z.string(), z.number().positive()),
    space: z.record(z.string(), z.number().nonnegative()),
    radius: z.record(z.string(), z.number().nonnegative()),
    lineHeight: z.record(z.string(), z.number().positive()),
  })
  .strict();

export type Tokens = z.infer<typeof TokensSchema>;

/** Partial tokens a document may declare; merged over the defaults group by group. */
export const TokenOverridesSchema = TokensSchema.partial();
export type TokenOverrides = z.infer<typeof TokenOverridesSchema>;

export const defaultTokens: Tokens = {
  color: {
    text: "#1a1c1e",
    muted: "#5b6168",
    primary: "#1f4fd8",
    surface: "#ffffff",
    subtle: "#f3f4f6",
    border: "#d9dce1",
    success: "#1e8e3e",
    danger: "#c5221f",
    warning: "#b06000",
    highlight: "#fff3b0",
    chart1: "#1f4fd8",
    chart2: "#e8710a",
    chart3: "#1e8e3e",
    chart4: "#9334e6",
    chart5: "#d01884",
    chart6: "#12a4af",
  },
  font: {
    sans: "Inter",
    /** Titles, KPI values and card titles: a theme can give them their own family. */
    heading: "Inter",
    mono: "JetBrains Mono",
  },
  size: {
    xs: 11,
    s: 13,
    m: 15,
    l: 18,
    xl: 22,
    xxl: 28,
    display: 36,
  },
  space: {
    "0": 0,
    "1": 4,
    "2": 8,
    "3": 12,
    "4": 16,
    "5": 24,
    "6": 32,
  },
  radius: {
    none: 0,
    s: 4,
    m: 8,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
  },
};

export function mergeTokens(overrides: TokenOverrides | undefined): Tokens {
  const merged = structuredClone(defaultTokens);
  if (!overrides) return merged;
  for (const group of TOKEN_GROUPS) {
    const values = overrides[group];
    if (values) Object.assign(merged[group], values);
  }
  return merged;
}
