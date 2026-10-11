import { inlineHtml } from "../render/semantic";
import { h, renderTextBlock, safeHref, text } from "../render/html";
import { inlineText } from "../text/inline";
import type { TextBlock } from "../text/layout";
import type { Diagnostic } from "../validate/diagnostics";
import { excerpt, layoutInline } from "./shared";
import type { ComponentDef } from "./types";

/**
 * A boxed block: eyebrow, title, an optional large value, text and a footer line,
 * stacked with the card's gap. It never splits across pages. `props.href` turns the
 * whole card into a link (the engine draws the clickable layer over the box).
 */
export const cardComponent: ComponentDef<"card"> = {
  type: "card",
  sizing: "content",
  decorated: true,
  variants: ["eyebrow", "title", "value", "footer"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const style = ctx.style();
    const { eyebrow, title, value, text: body, footer } = component.content;

    const parts: { block: TextBlock; align: "left" | "center" | "right" }[] = [];
    const add = (inline: Parameters<typeof layoutInline>[0] | undefined, variant?: string) => {
      if (inline === undefined || inline === "") return;
      const s = ctx.style(variant);
      parts.push({ block: layoutInline(inline, s, ctx, ctx.width, diagnostics), align: s.align });
    };
    add(eyebrow, "eyebrow");
    add(title, "title");
    add(value, "value");
    add(body);
    add(footer, "footer");

    const needed = parts.reduce((sum, p, i) => sum + p.block.height + (i > 0 ? style.gap : 0), 0);
    return {
      needed,
      natural: needed,
      splittable: false,
      diagnostics,
      facts: { parts: parts.length, href: component.props?.href ?? null },
      chunks: [
        {
          height: needed,
          html: (x, y) => {
            let top = y;
            let html = "";
            parts.forEach((p, i) => {
              if (i > 0) top += style.gap;
              html += renderTextBlock(p.block, { x, y: top, width: ctx.width, align: p.align });
              top += p.block.height;
            });
            return html;
          },
        },
      ],
    };
  },

  semantic(component) {
    const { eyebrow, title, value, text: body, footer } = component.content;
    const href = component.props?.href ? safeHref(component.props.href) : null;
    const parts = [
      eyebrow ? h("p", {}, text(eyebrow)) : "",
      h("h3", {}, inlineHtml(title)),
      value ? h("p", {}, h("strong", {}, text(value))) : "",
      body !== undefined ? h("p", {}, inlineHtml(body)) : "",
      // A link inside a linked card would nest anchors: keep the footer as plain text then.
      footer !== undefined ? h("p", {}, href ? text(inlineText(footer)) : inlineHtml(footer)) : "",
    ].join("");
    return h("section", { "aria-label": inlineText(title) }, href ? h("a", { href }, parts) : parts);
  },

  describe(component) {
    const { eyebrow, title, value } = component.content;
    const link = component.props?.href ? ` → ${component.props.href}` : "";
    return `card${eyebrow ? ` [${excerpt(eyebrow, 20)}]` : ""} "${excerpt(title, 36)}"${value ? ` ${value}` : ""}${link}`;
  },
};
