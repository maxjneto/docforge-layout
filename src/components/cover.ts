import { absStyle, h, rect, renderTextBlock, safeSrc, text } from "../render/html";
import type { ResolvedStyle } from "../schema/style";
import { contrast, parseColor } from "../style/color";
import { colorValue } from "../style/tokens";
import type { TextBlock } from "../text/layout";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { excerpt, layoutInline } from "./shared";
import type { ComponentContext, ComponentDef } from "./types";
import type { ComponentOf } from "../schema/components";

type Cover = ComponentOf<"cover">;

/** The background as html for a box of `w` × `hgt` at (x, y). */
function background(cover: Cover, ctx: ComponentContext, x: number, y: number, w: number, hgt: number): string {
  const bg = cover.props?.background;
  if (bg === undefined) return "";
  if (typeof bg === "string") return rect(x, y, w, hgt, { background: colorValue(bg, ctx.tokens, "#1a1c1e") }, "background");
  return h("img", { src: safeSrc(bg.src) ?? "", alt: "", "data-part": "background", style: absStyle(x, y, w, hgt, { objectFit: bg.fit ?? "cover", display: "block" }) });
}

/** Light or dark text, whichever reads better on the background (light on an image). */
function textColor(cover: Cover, ctx: ComponentContext): string | null {
  const bg = cover.props?.background;
  if (bg === undefined) return null;
  const light = colorValue("$color.surface", ctx.tokens, "#ffffff");
  if (typeof bg !== "string") return light;
  const dark = colorValue("$color.text", ctx.tokens, "#1a1c1e");
  const [c, l, d] = [parseColor(colorValue(bg, ctx.tokens, dark)), parseColor(light), parseColor(dark)];
  if (!c || !l || !d) return null;
  return contrast(c, l) >= contrast(c, d) ? light : dark;
}

/**
 * The opening page of a document: eyebrow, a large title, a subtitle and a few label/value
 * lines, laid out in the area it is given. `fullBleed` paints the background to the page's
 * edges (the one thing in the library that ignores the margin; the text still keeps to it).
 */
export const coverComponent: ComponentDef<"cover"> = {
  type: "cover",
  sizing: "area",
  decorated: true,
  fillsPage: true,
  variants: ["eyebrow", "title", "subtitle", "meta-label", "meta"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const style = ctx.style();
    const align = component.props?.align ?? "left";
    const vertical = component.props?.vertical ?? "middle";
    const color = textColor(component, ctx);
    const styled = (variant: string): ResolvedStyle => {
      const s = ctx.style(variant);
      return color ? { ...s, color } : s;
    };
    const { eyebrow, title, subtitle, meta } = component.content;
    const gap = style.gap;

    const parts: { block: TextBlock; part: string; space: number }[] = [];
    if (eyebrow) parts.push({ block: layoutInline(eyebrow, styled("eyebrow"), ctx, ctx.width, diagnostics), part: "eyebrow", space: 0 });
    parts.push({ block: layoutInline(title, styled("title"), ctx, ctx.width, diagnostics), part: "title", space: parts.length ? gap : 0 });
    if (subtitle) parts.push({ block: layoutInline(subtitle, styled("subtitle"), ctx, ctx.width, diagnostics), part: "subtitle", space: gap });

    const labelStyle = styled("meta-label");
    const valueStyle = styled("meta");
    const rows = (meta ?? []).map((m) => ({
      label: layoutInline(m.label, labelStyle, ctx, ctx.width, diagnostics),
      value: layoutInline(m.value, valueStyle, ctx, ctx.width, diagnostics),
    }));
    const metaHeight = rows.reduce((s, r, i) => s + r.label.height + r.value.height + (i > 0 ? gap : 0), 0);
    const textHeight = parts.reduce((s, p) => s + p.space + p.block.height, 0);
    // The titles are the minimum; meta lines that do not fit are left out (and reported).
    const full = textHeight + (rows.length ? gap * 4 + metaHeight : 0);
    const needed = textHeight;
    const natural = full + gap * 8;
    const height = ctx.height ?? natural;
    if (height + 0.5 < full) {
      diagnostics.push(
        diag("warning", "cover-overflow", `The cover needs ${Math.ceil(full)}px; it has ${Math.floor(height)}px, so meta lines are left out.`, {
          suggestions: [`Raise h to at least ${Math.ceil((full + ctx.inset * 2) / ctx.unit)}.`, "Shorten the title or drop some meta lines."],
        }),
      );
    }
    const free = Math.max(0, height - full);
    const offset = vertical === "top" ? 0 : vertical === "bottom" ? free : free / 2;
    const pad = ctx.inset;
    const bleeds = component.props?.fullBleed === true;

    return {
      needed,
      natural,
      splittable: false,
      diagnostics,
      facts: { meta: rows.length, ...(bleeds ? { fullBleed: true } : {}) },
      chunks: [
        {
          height,
          html: (x, y) => {
            let html = bleeds ? "" : background(component, ctx, x - pad, y - pad, ctx.width + pad * 2, height + pad * 2);
            let top = y + offset;
            for (const p of parts) {
              top += p.space;
              html += renderTextBlock(p.block, { x, y: top, width: ctx.width, align, part: p.part });
              top += p.block.height;
            }
            if (rows.length) top += gap * 4;
            rows.forEach((r, i) => {
              if (i > 0) top += gap;
              if (top + r.label.height + r.value.height > y + height + 0.5) return;
              html += renderTextBlock(r.label, { x, y: top, width: ctx.width, align, part: "meta-label" });
              top += r.label.height;
              html += renderTextBlock(r.value, { x, y: top, width: ctx.width, align, part: "meta" });
              top += r.value.height;
            });
            return html;
          },
        },
      ],
    };
  },

  bleed(component, ctx) {
    if (component.props?.fullBleed !== true || component.props.background === undefined) return null;
    return (width, height) => background(component, ctx, 0, 0, width, height);
  },

  semantic(component) {
    const { eyebrow, title, subtitle, meta } = component.content;
    return h(
      "header",
      {},
      eyebrow ? h("p", {}, text(eyebrow)) : "",
      h("h1", {}, text(title)),
      subtitle ? h("p", {}, text(subtitle)) : "",
      meta?.length ? h("dl", {}, ...meta.flatMap((m) => [h("dt", {}, text(m.label)), h("dd", {}, text(m.value))])) : "",
    );
  },

  describe(component) {
    const bleed = component.props?.fullBleed ? " full-bleed" : "";
    return `cover${bleed} "${excerpt(component.content.title, 40)}"${component.content.meta?.length ? ` + ${component.content.meta.length} meta` : ""}`;
  },
};
