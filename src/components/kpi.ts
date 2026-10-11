import { renderTextBlock } from "../render/html";
import { h, safeHref, text } from "../render/html";
import { colorValue } from "../style/tokens";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { layoutInline } from "./shared";
import type { ComponentDef } from "./types";

const MIN_VALUE_SIZE = 18;
const VALUE_LABEL_GAP = 4;
const LABEL_DELTA_GAP = 2;

/**
 * The value shrinks to fit the width (down to a legible minimum); the block is
 * centered vertically in whatever height the band gives it.
 */
export const kpiComponent: ComponentDef<"kpi"> = {
  type: "kpi",
  sizing: "area",
  decorated: true,
  variants: ["label", "delta"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const style = ctx.style();
    const labelStyle = ctx.style("label");
    const deltaStyle = ctx.style("delta");
    const { value, label, delta, trend } = component.content;

    const face = ctx.registry.match(style.fontFamily, style.fontWeight, style.italic);
    let size = style.fontSize;
    while (ctx.registry.measure(face, size, value) > ctx.width && size > MIN_VALUE_SIZE) size -= 2;
    const finalWidth = ctx.registry.measure(face, size, value);
    if (size < style.fontSize) {
      diagnostics.push(
        diag("info", "kpi-shrunk", `Value "${value}" shrunk from ${style.fontSize}px to ${size}px to fit ${Math.round(ctx.width)}px.`, {
          data: { from: style.fontSize, to: size },
          suggestions: ["Widen the component (colSpan) to keep the full size."],
        }),
      );
    }
    if (finalWidth > ctx.width + 0.5) {
      diagnostics.push(
        diag("error", "kpi-value-too-wide", `Value "${value}" needs ${Math.ceil(finalWidth)}px even at ${size}px; the area is ${Math.round(ctx.width)}px wide.`, {
          suggestions: ["Widen the component (colSpan).", "Shorten the value (e.g. 1.2M instead of 1,200,000)."],
        }),
      );
    }

    const valueBlock = layoutInline(value, { ...style, fontSize: size }, ctx, Number.POSITIVE_INFINITY, diagnostics);
    const labelBlock = layoutInline(label, labelStyle, ctx, ctx.width, diagnostics);
    const trendColor =
      trend === "up"
        ? colorValue("$color.success", ctx.tokens, "#1e8e3e")
        : trend === "down"
          ? colorValue("$color.danger", ctx.tokens, "#c5221f")
          : deltaStyle.muted;
    const deltaBlock = delta !== undefined ? layoutInline(delta, { ...deltaStyle, color: trendColor }, ctx, ctx.width, diagnostics) : null;

    const needed =
      valueBlock.height + VALUE_LABEL_GAP + labelBlock.height + (deltaBlock ? LABEL_DELTA_GAP + deltaBlock.height : 0);
    const height = ctx.height ?? needed;
    const offset = Math.max(0, (height - needed) / 2);

    return {
      needed,
      natural: needed,
      splittable: false,
      diagnostics,
      facts: { valueSize: size },
      chunks: [
        {
          height,
          html: (x, y) => {
            let top = y + offset;
            let html = renderTextBlock(valueBlock, { x, y: top, width: ctx.width, align: style.align });
            top += valueBlock.height + VALUE_LABEL_GAP;
            html += renderTextBlock(labelBlock, { x, y: top, width: ctx.width, align: labelStyle.align });
            top += labelBlock.height + LABEL_DELTA_GAP;
            if (deltaBlock) html += renderTextBlock(deltaBlock, { x, y: top, width: ctx.width, align: deltaStyle.align });
            return html;
          },
        },
      ],
    };
  },

  semantic(component) {
    const { value, label, delta } = component.content;
    const body = `${h("strong", {}, text(value))} ${text(label)}${delta ? ` (${text(delta)})` : ""}`;
    const href = component.props?.href ? safeHref(component.props.href) : null;
    return h("p", {}, href ? h("a", { href }, body) : body);
  },

  describe(component) {
    const { value, label, delta } = component.content;
    const link = component.props?.href ? ` → ${component.props.href}` : "";
    return `kpi ${value} "${label}"${delta ? ` ${delta}` : ""}${link}`;
  },
};
