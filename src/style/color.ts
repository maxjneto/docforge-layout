/**
 * Just enough color math for contrast checks and derived theme colors. Only #rgb,
 * #rrggbb and rgb()/rgba() are understood; for anything else (names, hsl()) the answer
 * is `null` and the caller skips the check rather than guess.
 */

export type Rgb = [number, number, number];

export function parseColor(value: string | null | undefined): Rgb | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return [1, 2, 3].map((i) => Number.parseInt((short[i] as string).repeat(2), 16)) as Rgb;
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(v);
  if (long) return [1, 2, 3].map((i) => Number.parseInt(long[i] as string, 16)) as Rgb;
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (fn) return [1, 2, 3].map((i) => Math.min(255, Number(fn[i]))) as Rgb;
  if (v === "white") return [255, 255, 255];
  if (v === "black") return [0, 0, 0];
  return null;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** `a` moved `amount` (0–1) of the way to `b`, as #rrggbb. */
export function mix(a: Rgb, b: Rgb, amount: number): string {
  return toHex(a.map((c, i) => c + ((b[i] as number) - c) * amount) as Rgb);
}

/** Below this luminance a page color counts as dark (light text goes on it). */
export const DARK_SURFACE = 0.2;
