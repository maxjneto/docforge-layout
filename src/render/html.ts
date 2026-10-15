import { cssFamilyValue } from "../fonts/registry";
import type { TextBlock, TextStyle } from "../text/layout";
import { absStyle, h, px, safeHref, text, type Style } from "./h";

export { anchorId, cssSafe, esc, h, px, safeHref, safeSrc, text, absStyle, styleString, type Style } from "./h";

export function fontStyle(style: TextStyle, face: { family: string; weight: number; style: string }): Style {
  return {
    fontFamily: cssFamilyValue(face.family),
    fontSize: style.size,
    fontWeight: String(face.weight),
    fontStyle: face.style,
    color: style.color,
    background: style.background,
    textDecoration: style.underline ? "underline" : null,
  };
}

/** A plain absolutely positioned rectangle (rules, bars, swatches, badges). */
export function rect(x: number, y: number, w: number, hgt: number, extra: Style): string {
  return h("div", { style: absStyle(x, y, w, hgt, extra) });
}

/**
 * Draw the lines of a text block exactly as measured: one absolutely positioned,
 * non-wrapping line per measured line. `data-w` carries the measured width so the
 * conformance check can compare it with what the browser draws. Visual links are
 * kept out of the tab order; the accessible copy lives in the semantic layer.
 */
export function renderTextBlock(
  block: TextBlock,
  options: { x: number; y: number; width: number; align: "left" | "center" | "right"; firstLine?: number; lastLine?: number },
): string {
  const { x, width, align } = options;
  const first = options.firstLine ?? 0;
  const last = options.lastLine ?? block.lines.length;
  let y = options.y;
  let html = "";
  for (let i = first; i < last; i++) {
    const line = block.lines[i];
    if (!line) continue;
    const spans = line.fragments
      .map((f) => {
        const href = f.style.href ? safeHref(f.style.href) : null;
        const inner = href
          ? h("a", { href, tabindex: -1, style: { color: "inherit", textDecoration: "inherit" } }, text(f.text))
          : text(f.text);
        return h("span", { style: fontStyle(f.style, f.face) }, inner);
      })
      .join("");
    html += h(
      "div",
      {
        class: "dfl-line",
        "data-w": Math.round(line.width * 100) / 100,
        style: absStyle(x, y, width, line.height, { lineHeight: px(line.height), whiteSpace: "pre", textAlign: align }),
      },
      spans,
    );
    y += line.height;
  }
  return html;
}
