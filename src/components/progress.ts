import { absStyle, h, rect, renderTextBlock, text } from "../render/html";
import { colorValue } from "../style/tokens";
import type { TextBlock } from "../text/layout";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { excerpt, layoutInline } from "./shared";
import type { Chunk, ComponentDef } from "./types";

const SYMBOL_GAP = 3;

/** The 10 points of a 5-pointed star in a `size` box, clockwise from the top tip. */
function starPoints(size: number): [number, number][] {
  const c = size / 2;
  const outer = size / 2;
  const inner = outer * 0.45;
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return [c + r * Math.cos(a), c + r * Math.sin(a) + size * 0.04];
  });
}

/** One star or dot, empty, half or full. */
function symbol(kind: "stars" | "dots", size: number, fill: number, on: string, off: string): string {
  const n = (v: number) => v.toFixed(2);
  if (kind === "dots") {
    const r = size / 2 - 1;
    const c = size / 2;
    const whole = h("circle", { cx: n(c), cy: n(c), r: n(r), fill: fill >= 1 ? on : off });
    return fill > 0 && fill < 1 ? whole + h("path", { d: `M${n(c)},${n(c - r)} A${n(r)},${n(r)} 0 0 0 ${n(c)},${n(c + r)} Z`, fill: on }) : whole;
  }
  const points = starPoints(size);
  const all = points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
  const whole = h("polygon", { points: all, fill: fill >= 1 ? on : off });
  if (!(fill > 0 && fill < 1)) return whole;
  // Left half: from the bottom inner point round to the top tip (both on the center line).
  const left = [5, 6, 7, 8, 9, 0].map((i) => points[i] as [number, number]).map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
  return whole + h("polygon", { points: left, fill: on });
}

/**
 * One line per item: label on the left, a bar (or stars, or dots) in the middle, the value
 * or a short text on the right. Splits between items.
 */
export const progressComponent: ComponentDef<"progress"> = {
  type: "progress",
  sizing: "content",
  decorated: true,
  variants: ["label", "value"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const style = ctx.style();
    const labelStyle = ctx.style("label");
    const valueStyle = ctx.style("value");
    const kind = component.props?.kind ?? "bar";
    const showValue = component.props?.showValue !== false;
    const number = new Intl.NumberFormat(ctx.locale, { maximumFractionDigits: 1 });
    const track = colorValue("$color.subtle", ctx.tokens, "#f3f4f6");
    const off = colorValue("$color.border", ctx.tokens, "#d9dce1");
    const gap = style.gap;

    const items = component.content.items.map((item) => {
      let max = item.max ?? (kind === "bar" ? 100 : 5);
      if (kind !== "bar") {
        const whole = Math.min(10, Math.max(1, Math.round(max)));
        if (whole !== max) {
          diagnostics.push(diag("warning", "progress-range", `"${item.label}": stars and dots need a whole max from 1 to 10; using ${whole}.`, { suggestions: ["Use max 5 or 10."] }));
          max = whole;
        }
      }
      if (max <= 0 || item.value < 0 || item.value > max) {
        diagnostics.push(
          diag("warning", "progress-range", `"${item.label}": value ${item.value} is outside 0–${max}; it is drawn at the nearest end.`, {
            suggestions: ["Keep value between 0 and max (max above 0)."],
          }),
        );
      }
      const fraction = max > 0 ? Math.min(1, Math.max(0, item.value / max)) : 0;
      const shown = item.text ?? (kind === "bar" && max === 100 ? `${number.format(item.value)}%` : `${number.format(item.value)}/${number.format(max)}`);
      return { ...item, max, fraction, shown };
    });

    const labels = items.map((i) => layoutInline(i.label, labelStyle, ctx, Number.MAX_SAFE_INTEGER, diagnostics));
    const labelW = Math.min(ctx.width * 0.4, Math.max(0, ...labels.map((b) => b.width)));
    const labelBlocks = items.map((i) => layoutInline(i.label, labelStyle, ctx, labelW, diagnostics));
    const values: (TextBlock | null)[] = items.map((i) => (showValue ? layoutInline(i.shown, valueStyle, ctx, Number.MAX_SAFE_INTEGER, diagnostics) : null));
    const valueW = Math.max(0, ...values.map((b) => b?.width ?? 0));
    const middleX = labelW + gap;
    const middleW = Math.max(1, ctx.width - middleX - (showValue ? valueW + gap : 0));

    const chunks: Chunk[] = items.map((item, index) => {
      const label = labelBlocks[index] as TextBlock;
      const value = values[index];
      const lineH = label.lines[0]?.height ?? style.fontSize * style.lineHeight;
      const rowH = Math.max(label.height, value?.height ?? 0);
      const top = index > 0 ? gap : 0;
      return {
        height: rowH + top,
        html: (x, y) => {
          const y0 = y + top;
          let html = renderTextBlock(label, { x, y: y0, width: labelW, align: "left", part: "label" });
          if (kind === "bar") {
            const barH = Math.max(4, Math.round(style.fontSize * 0.55));
            const by = y0 + (lineH - barH) / 2;
            html += rect(x + middleX, by, middleW, barH, { background: track, borderRadius: barH / 2 });
            if (item.fraction > 0) html += rect(x + middleX, by, Math.max(barH, middleW * item.fraction), barH, { background: style.accent, borderRadius: barH / 2 }, "bar");
          } else {
            const size = Math.min(Math.round(lineH * 0.8), Math.floor((middleW - SYMBOL_GAP * (item.max - 1)) / item.max));
            let svg = "";
            for (let i = 0; i < item.max; i++) {
              const fill = Math.min(1, Math.max(0, item.fraction * item.max - i));
              const rounded = fill >= 0.75 ? 1 : fill >= 0.25 ? 0.5 : 0;
              svg += h("g", { transform: `translate(${i * (size + SYMBOL_GAP)} 0)` }, symbol(kind, size, rounded, style.accent, off));
            }
            const w = item.max * size + (item.max - 1) * SYMBOL_GAP;
            html += h("svg", { xmlns: "http://www.w3.org/2000/svg", width: w, height: size, viewBox: `0 0 ${w} ${size}`, "data-part": "bar", style: absStyle(x + middleX, y0 + (lineH - size) / 2, w, size) }, svg);
          }
          if (value) html += renderTextBlock(value, { x: x + ctx.width - valueW, y: y0, width: valueW, align: "right", part: "value" });
          return html;
        },
      };
    });

    const needed = chunks.reduce((s, c) => s + c.height, 0);
    return { needed, natural: needed, chunks, splittable: true, diagnostics, facts: { kind, items: items.length } };
  },

  semantic(component) {
    const kind = component.props?.kind ?? "bar";
    return h(
      "dl",
      {},
      ...component.content.items.flatMap((item) => {
        const max = item.max ?? (kind === "bar" ? 100 : 5);
        return [h("dt", {}, text(item.label)), h("dd", {}, h("meter", { min: 0, max, value: item.value }, text(`${item.value}/${max}`)), item.text ? ` ${text(item.text)}` : "")];
      }),
    );
  },

  describe(component) {
    const kind = component.props?.kind ?? "bar";
    return `progress ${kind} ${component.content.items.length}: ${excerpt(component.content.items.map((i) => `${i.label} ${i.value}`).join(", "), 44)}`;
  },
};
