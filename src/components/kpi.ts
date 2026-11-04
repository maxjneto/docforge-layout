import { renderTextBlock } from "../render/html";
import { absStyle, h, safeHref, text } from "../render/html";
import { colorValue } from "../style/tokens";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { layoutInline } from "./shared";
import type { ComponentDef } from "./types";

const MIN_VALUE_SIZE = 18;
const VALUE_LABEL_GAP = 4;
const LABEL_DELTA_GAP = 2;
const SPARK_GAP = 6;
const SPARK_HEIGHT = 20;

/** A small line of `values`, at most 160px wide, aligned like the KPI's text. */
function sparkline(values: number[], x: number, y: number, width: number, height: number, color: string, align: "left" | "center" | "right"): string {
  const w = Math.min(width, 160);
  const left = align === "center" ? x + (width - w) / 2 : align === "right" ? x + width - w : x;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const points = values.map((v, i) => `${((i / (values.length - 1)) * (w - 2) + 1).toFixed(2)},${(height - 1 - ((v - lo) / span) * (height - 2)).toFixed(2)}`);
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", width: w, height, viewBox: `0 0 ${w} ${height}`, "data-part": "sparkline", "aria-hidden": "true", style: absStyle(left, y, w, height, { overflow: "visible" }) },
    h("polyline", { points: points.join(" "), fill: "none", stroke: color, "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" }),
  );
}

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
    // The sparkline never makes the KPI taller: it is drawn only when the box has room for it.
    const spark = component.content.sparkline;
    const sparkFits = !!spark && (ctx.height === null || height - needed >= SPARK_GAP + SPARK_HEIGHT);
    if (spark && !sparkFits) {
      diagnostics.push(
        diag("info", "sparkline-hidden", `The sparkline needs ${SPARK_GAP + SPARK_HEIGHT}px more height than the box has; it is not drawn.`, {
          suggestions: [`Raise h by ${Math.ceil((SPARK_GAP + SPARK_HEIGHT - (height - needed)) / ctx.unit)} row(s).`],
        }),
      );
    }
    const block = needed + (spark && sparkFits ? SPARK_GAP + SPARK_HEIGHT : 0);
    const offset = Math.max(0, (height - block) / 2);
    const sparkColor = trend === "up" || trend === "down" ? trendColor : trend === "flat" ? deltaStyle.muted : style.accent;

    return {
      needed,
      natural: needed + (spark ? SPARK_GAP + SPARK_HEIGHT : 0),
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
            html += renderTextBlock(labelBlock, { x, y: top, width: ctx.width, align: labelStyle.align, part: "label" });
            top += labelBlock.height + LABEL_DELTA_GAP;
            if (deltaBlock) {
              html += renderTextBlock(deltaBlock, { x, y: top, width: ctx.width, align: deltaStyle.align, part: "delta" });
              top += deltaBlock.height;
            }
            if (spark && sparkFits) html += sparkline(spark, x, top + SPARK_GAP, ctx.width, SPARK_HEIGHT, sparkColor, style.align);
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
