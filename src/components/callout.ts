import type { CALLOUT_KINDS } from "../schema/components";
import { inlineHtml } from "../render/semantic";
import { h, rect, renderTextBlock, text } from "../render/html";
import type { TextBlock } from "../text/layout";
import type { Diagnostic } from "../validate/diagnostics";
import { icon, type IconName } from "./icons";
import { excerpt, layoutInline } from "./shared";
import type { ComponentDef } from "./types";

type Kind = (typeof CALLOUT_KINDS)[number];

const ICON_OF: Record<Kind, IconName> = { note: "info", tip: "bulb", warning: "warning", important: "alert", success: "check" };
const BAR = 3;
const ICON = 16;
const ICON_GAP = 8;

/**
 * A note set apart from the text: a colored bar on the left, an icon, an optional title.
 * The kind picks the color (`callout.<kind>` presets give each its accent). Never splits.
 */
export const calloutComponent: ComponentDef<"callout"> = {
  type: "callout",
  sizing: "content",
  decorated: true,
  variants: ["title", "note", "tip", "warning", "important", "success"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const kind: Kind = component.props?.kind ?? "note";
    const style = ctx.style();
    const accent = ctx.style(kind).accent;
    const titleStyle = ctx.style("title");
    const withIcon = component.props?.icon !== false;
    const indent = withIcon ? ICON + ICON_GAP : 0;
    const width = ctx.width - indent;
    const title: TextBlock | null = component.content.title ? layoutInline(component.content.title, titleStyle, ctx, width, diagnostics) : null;
    const body = layoutInline(component.content.text, style, ctx, width, diagnostics);
    const gap = title ? Math.round(style.gap / 2) : 0;
    const needed = Math.max(withIcon ? ICON : 0, (title?.height ?? 0) + gap + body.height);
    const pad = style.padding + style.borderWidth;

    return {
      needed,
      natural: needed,
      splittable: false,
      diagnostics,
      facts: { kind, ...(title ? { title: true } : {}) },
      chunks: [
        {
          height: needed,
          html: (x, y) => {
            // The bar runs along the box's left edge, over its padding.
            let html = rect(x - pad, y - pad, BAR, needed + pad * 2, { background: accent, borderRadius: style.radius ? `${style.radius}px 0 0 ${style.radius}px` : null }, kind);
            const firstLine = (title ?? body).lines[0]?.height ?? ICON;
            if (withIcon) html += icon(ICON_OF[kind], x, y + Math.max(0, (firstLine - ICON) / 2), ICON, accent, kind);
            let top = y;
            if (title) {
              html += renderTextBlock(title, { x: x + indent, y: top, width, align: titleStyle.align, part: "title" });
              top += title.height + gap;
            }
            html += renderTextBlock(body, { x: x + indent, y: top, width, align: style.align });
            return html;
          },
        },
      ],
    };
  },

  semantic(component) {
    const { title, text: body } = component.content;
    return h("aside", { role: "note", "aria-label": component.props?.kind ?? "note" }, title ? h("p", {}, h("strong", {}, text(title))) : "", h("p", {}, inlineHtml(body)));
  },

  describe(component) {
    const kind = component.props?.kind ?? "note";
    const { title, text: body } = component.content;
    return `callout ${kind}${title ? ` "${excerpt(title, 30)}"` : ""}: "${excerpt(body, 40)}"`;
  },
};
