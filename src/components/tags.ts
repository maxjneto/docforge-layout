import { h, rect, renderTextBlock, text } from "../render/html";
import { contrast, parseColor } from "../style/color";
import { colorValue } from "../style/tokens";
import type { TextBlock } from "../text/layout";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { excerpt, layoutInline } from "./shared";
import type { Chunk, ComponentDef } from "./types";

interface Tag {
  block: TextBlock;
  width: number;
  background: string;
}

/**
 * Labels in rounded boxes, side by side, wrapping into rows; each row is a chunk, so a
 * long list can split between rows. A tag's text turns light or dark to read on its color.
 */
export const tagsComponent: ComponentDef<"tags"> = {
  type: "tags",
  sizing: "content",
  decorated: true,
  variants: ["tag"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const base = ctx.style();
    const tagStyle = ctx.style("tag");
    const style = component.props?.size === "s" ? { ...tagStyle, fontSize: ctx.tokens.size.xs ?? tagStyle.fontSize } : tagStyle;
    const padY = ctx.tokens.space["1"] ?? 4;
    const padX = ctx.tokens.space["2"] ?? 8;
    const gap = base.gap;
    const subtle = tagStyle.background ?? colorValue("$color.subtle", ctx.tokens, "#f3f4f6");
    const light = colorValue("$color.surface", ctx.tokens, "#ffffff");
    const dark = colorValue("$color.text", ctx.tokens, "#1a1c1e");
    const readable = (bg: string) => {
      const c = parseColor(bg);
      const l = parseColor(light);
      const d = parseColor(dark);
      if (!c || !l || !d) return style.color;
      return contrast(c, l) >= contrast(c, d) ? light : dark;
    };

    const room = Math.max(1, ctx.width - padX * 2);
    let tooWide = 0;
    const tags: Tag[] = component.content.items.map((item) => {
      const label = typeof item === "string" ? item : item.text;
      const background = typeof item === "string" || !item.color ? subtle : colorValue(item.color, ctx.tokens, subtle);
      const color = typeof item === "string" || !item.color ? style.color : readable(background);
      let shown = label;
      const measureText = (t: string) => layoutInline(t, { ...style, color }, ctx, Number.MAX_SAFE_INTEGER, diagnostics);
      let block = measureText(shown);
      if (block.width > room) {
        tooWide++;
        while (shown.length > 1 && measureText(`${shown}…`).width > room) shown = shown.slice(0, -1);
        block = measureText(`${shown}…`);
      }
      return { block, width: block.width + padX * 2, background };
    });
    if (tooWide) {
      diagnostics.push(
        diag("warning", "tag-too-wide", `${tooWide} tag(s) are wider than the component and were cut.`, {
          suggestions: ["Widen the component, or shorten the tag."],
        }),
      );
    }

    // Wrap into rows.
    const rows: { tags: Tag[]; x: number[] }[] = [];
    let row: { tags: Tag[]; x: number[] } = { tags: [], x: [] };
    let x = 0;
    for (const tag of tags) {
      if (row.tags.length && x + tag.width > ctx.width + 0.01) {
        rows.push(row);
        row = { tags: [], x: [] };
        x = 0;
      }
      row.tags.push(tag);
      row.x.push(x);
      x += tag.width + gap;
    }
    if (row.tags.length) rows.push(row);

    const radius = ctx.tokens.radius.m ?? 8;
    const chunks: Chunk[] = rows.map((r, index) => {
      const lineH = Math.max(...r.tags.map((t) => t.block.height));
      const height = lineH + padY * 2 + (index > 0 ? gap : 0);
      const top = index > 0 ? gap : 0;
      return {
        height,
        html: (cx, cy) =>
          r.tags
            .map(
              (t, i) =>
                rect(cx + (r.x[i] as number), cy + top, t.width, lineH + padY * 2, { background: t.background, borderRadius: radius }, "tag") +
                renderTextBlock(t.block, { x: cx + (r.x[i] as number) + padX, y: cy + top + padY + (lineH - t.block.height) / 2, width: t.width - padX * 2, align: "left", part: "tag" }),
            )
            .join(""),
      };
    });

    const needed = chunks.reduce((s, c) => s + c.height, 0);
    return { needed, natural: needed, chunks, splittable: true, diagnostics, facts: { tags: tags.length, rows: rows.length } };
  },

  semantic(component) {
    return h("ul", {}, ...component.content.items.map((item) => h("li", {}, text(typeof item === "string" ? item : item.text))));
  },

  describe(component) {
    const names = component.content.items.map((i) => (typeof i === "string" ? i : i.text));
    return `tags ${names.length}: ${excerpt(names.join(", "), 44)}`;
  },
};
