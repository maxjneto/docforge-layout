import { z } from "zod";
import { isSafeHref, isSafeSrc } from "../render/h";

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(rgb|rgba|hsl|hsla)\(\s*[-\d.%\s,/]+\)$/i;
const NAMED = /^[a-z]{3,30}$/i;
const TOKEN_REF = /^\$[a-zA-Z]+\.[A-Za-z0-9_-]+$/;
const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

/** A literal CSS color: hex, rgb()/hsl() with numbers, or a named color. Nothing else reaches CSS. */
export function isColorLiteral(value: string): boolean {
  return HEX.test(value) || FUNC.test(value) || NAMED.test(value);
}

export const ColorLiteralSchema = z.string().refine(isColorLiteral, {
  message: "expected a color: #rgb/#rrggbb, rgb()/hsl() or a color name",
});

/** A color, or a reference to a color token (`$color.primary`). */
export const ColorSchema = z.string().refine((v) => TOKEN_REF.test(v) || isColorLiteral(v), {
  message: "expected a color (#rrggbb, rgb(), a color name) or a token reference ($color.key)",
});

export const FontFamilyLiteralSchema = z.string().regex(FAMILY, "font family names use letters, digits, spaces, - and _");

export const FontFamilySchema = z.string().refine((v) => TOKEN_REF.test(v) || FAMILY.test(v), {
  message: "expected a font family name or a token reference ($font.key)",
});

export const HrefSchema = z.string().refine(isSafeHref, {
  message: "links must be https://, http://, mailto: or #id",
});

export const SrcSchema = z.string().min(1).refine(isSafeSrc, {
  message: "image sources must be https://, http://, a relative path or a data:image/… URL",
});
