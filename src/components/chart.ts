import { cssFamily } from "../fonts/registry";
import { absStyle, h, text as textNode } from "../render/html";
import { colorValue } from "../style/tokens";
import { diag, type Diagnostic } from "../validate/diagnostics";
import type { ComponentDef } from "./types";

const MIN_PLOT_HEIGHT = 60;
const MIN_PLOT_WIDTH = 80;
const MIN_PIE_RADIUS = 40;
const NATURAL_PLOT = 200;
const SWATCH = 10;

/** Axis and value labels in the document's locale (decimal comma in pt-BR), with k/M for large numbers. */
function formatter(locale: string) {
  const short = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const exact = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return (n: number, unit = ""): string => {
    const size = Math.abs(n);
    const body = size >= 1e6 ? `${short.format(n / 1e6)}M` : size >= 1e4 ? `${short.format(n / 1e3)}k` : exact.format(n);
    return `${body}${unit}`;
  };
}

function niceStep(range: number, count: number): number {
  const raw = range / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / magnitude;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * magnitude;
}

export const chartComponent: ComponentDef<"chart"> = {
  type: "chart",
  sizing: "area",
  decorated: true,
  variants: [],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const style = ctx.style();
    const { kind, categories, series } = component.content;
    const unit = component.props?.unit ?? "";
    const showValues = component.props?.values === true;
    const format = formatter(ctx.locale);
    const palette = [1, 2, 3, 4, 5, 6].map((i) => colorValue(`$color.chart${i}`, ctx.tokens, style.accent));
    const color = (i: number) => palette[i % palette.length] as string;

    series.forEach((s) => {
      if (s.values.length !== categories.length) {
        diagnostics.push(
          diag("warning", "chart-series-length", `Series "${s.name}" has ${s.values.length} values for ${categories.length} categories.`, {
            suggestions: ["Give every series one value per category."],
          }),
        );
      }
    });

    const face = ctx.registry.match(style.fontFamily, style.fontWeight, false);
    const fs = style.fontSize;
    const lineH = Math.ceil(fs * 1.4);
    const measure = (t: string) => ctx.registry.measure(face, fs, t);
    const W = ctx.width;
    const family = cssFamily(face.family);
    const n2 = (v: number) => v.toFixed(2);
    const text = (x: number, y: number, t: string, anchor: "start" | "middle" | "end", fill = style.color) =>
      h(
        "text",
        { x: n2(x), y: n2(y), "text-anchor": anchor, "font-family": family, "font-size": fs, "font-weight": face.weight, fill },
        textNode(t),
      );

    // Legend: one item per series (per category for pie), wrapped into rows.
    const pieValues = (series[0]?.values ?? []).map((v) => Math.max(0, v));
    const pieTotal = pieValues.reduce((s, v) => s + v, 0) || 1;
    const legendLabels =
      kind === "pie"
        ? categories.map((c, i) => `${c} ${Math.round(((pieValues[i] ?? 0) / pieTotal) * 100)}%`)
        : series.map((s) => s.name);
    const showLegend = component.props?.legend ?? (kind === "pie" || series.length > 1);
    const legendRows: { label: string; index: number; x: number }[][] = [];
    if (showLegend) {
      let row: { label: string; index: number; x: number }[] = [];
      let x = 0;
      legendLabels.forEach((label, index) => {
        const w = SWATCH + 6 + measure(label) + 16;
        if (x + w > W && row.length) {
          legendRows.push(row);
          row = [];
          x = 0;
        }
        row.push({ label, index, x });
        x += w;
      });
      if (row.length) legendRows.push(row);
    }
    const legendH = legendRows.length ? legendRows.length * lineH + 8 : 0;

    const xLabelH = kind === "pie" ? 0 : lineH + 4;
    const topPad = kind === "pie" ? 0 : Math.ceil(fs / 2) + (showValues ? lineH : 0);
    const minPlot = kind === "pie" ? MIN_PIE_RADIUS * 2 : MIN_PLOT_HEIGHT;
    const needed = minPlot + legendH + xLabelH + topPad;
    const natural = (kind === "pie" ? Math.min(NATURAL_PLOT, W) : NATURAL_PLOT) + legendH + xLabelH + topPad;
    const H = ctx.height ?? natural;
    const plotTop = topPad;
    const plotH = H - legendH - xLabelH - topPad;

    let svg = "";

    if (kind === "pie") {
      const values = pieValues;
      const total = pieTotal;
      const r = Math.max(0, Math.min(W, plotH) / 2 - 2);
      if (r < MIN_PIE_RADIUS) {
        diagnostics.push(
          diag("error", "chart-too-small", `Pie radius would be ${Math.round(r)}px; it needs at least ${MIN_PIE_RADIUS}px.`, {
            suggestions: [`Give the band at least ${Math.ceil(needed)}px of content height, or widen the component.`],
          }),
        );
      }
      const cx = W / 2;
      const cy = plotTop + plotH / 2;
      let angle = -Math.PI / 2;
      values.forEach((v, i) => {
        const sweep = (v / total) * Math.PI * 2;
        if (sweep <= 0) return;
        const end = angle + sweep;
        if (sweep >= Math.PI * 2 - 1e-6) {
          svg += h("circle", { cx: n2(cx), cy: n2(cy), r: n2(r), fill: color(i) });
        } else {
          const x1 = cx + r * Math.cos(angle);
          const y1 = cy + r * Math.sin(angle);
          const x2 = cx + r * Math.cos(end);
          const y2 = cy + r * Math.sin(end);
          const d = `M${n2(cx)},${n2(cy)} L${n2(x1)},${n2(y1)} A${n2(r)},${n2(r)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${n2(x2)},${n2(y2)} Z`;
          svg += h("path", { d, fill: color(i), stroke: "#ffffff", "stroke-width": 1 });
        }
        angle = end;
      });
    } else {
      const all = series.flatMap((s) => s.values);
      const maxV = Math.max(0, ...all);
      const minV = Math.min(0, ...all);
      const step = niceStep(maxV - minV || 1, 4);
      const lo = Math.floor(minV / step) * step;
      const hi = Math.ceil(maxV / step) * step || step;
      const ticks: number[] = [];
      for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
      const yLabelW = Math.ceil(Math.max(...ticks.map((t) => measure(format(t, unit)))));
      const plotX = yLabelW + 8;
      const plotW = W - plotX;

      if (plotH < MIN_PLOT_HEIGHT || plotW < MIN_PLOT_WIDTH) {
        diagnostics.push(
          diag("error", "chart-too-small", `Plot area would be ${Math.round(plotW)}×${Math.round(plotH)}px; it needs at least ${MIN_PLOT_WIDTH}×${MIN_PLOT_HEIGHT}px.`, {
            suggestions: [`Give the band at least ${Math.ceil(needed)}px of content height, or widen the component.`],
          }),
        );
      }

      const yOf = (v: number) => plotTop + plotH - ((v - lo) / (hi - lo)) * plotH;
      for (const t of ticks) {
        const y = yOf(t);
        svg += h("line", { x1: n2(plotX), x2: n2(W), y1: n2(y), y2: n2(y), stroke: style.borderColor, "stroke-width": 1 });
        svg += text(yLabelW, y + fs * 0.35, format(t, unit), "end");
      }

      const slot = plotW / categories.length;
      let overlapping = 0;
      categories.forEach((cat, i) => {
        const cx = plotX + slot * i + slot / 2;
        let label = cat;
        if (measure(label) > slot - 4) {
          overlapping += 1;
          while (label.length > 1 && measure(`${label}…`) > slot - 4) label = label.slice(0, -1);
          label = `${label}…`;
        }
        svg += text(cx, plotTop + plotH + 4 + fs, label, "middle");
      });
      if (overlapping) {
        diagnostics.push(
          diag("warning", "chart-labels-overlap", `${overlapping} of ${categories.length} category labels do not fit their ${Math.round(slot)}px slot and were truncated.`, {
            suggestions: ["Widen the component (colSpan).", "Shorten the category names.", "Use fewer categories."],
          }),
        );
      }

      if (kind === "bar") {
        const group = slot * 0.7;
        const barW = group / series.length;
        series.forEach((s, si) => {
          s.values.forEach((v, i) => {
            const x = plotX + slot * i + (slot - group) / 2 + barW * si;
            const y0 = yOf(Math.max(0, v));
            const barH = Math.abs(yOf(v) - yOf(0));
            svg += h("rect", { x: n2(x), y: n2(y0), width: n2(Math.max(1, barW - 2)), height: n2(barH), fill: color(si), rx: 2 });
            if (showValues) svg += text(x + barW / 2 - 1, y0 - 4, format(v, unit), "middle", style.color);
          });
        });
      } else {
        series.forEach((s, si) => {
          const points = s.values.map((v, i) => `${(plotX + slot * i + slot / 2).toFixed(2)},${yOf(v).toFixed(2)}`);
          svg += h("polyline", { points: points.join(" "), fill: "none", stroke: color(si), "stroke-width": 2 });
          s.values.forEach((v, i) => {
            const x = plotX + slot * i + slot / 2;
            svg += h("circle", { cx: n2(x), cy: n2(yOf(v)), r: 3, fill: color(si) });
            if (showValues) svg += text(x, yOf(v) - 8, format(v, unit), "middle", style.color);
          });
        });
      }
      svg += h("line", { x1: n2(plotX), x2: n2(W), y1: n2(yOf(0)), y2: n2(yOf(0)), stroke: style.muted, "stroke-width": 1 });
    }

    legendRows.forEach((row, ri) => {
      const y = H - legendH + 8 + ri * lineH;
      row.forEach((item) => {
        svg += h("rect", { x: n2(item.x), y: n2(y + (lineH - SWATCH) / 2), width: SWATCH, height: SWATCH, rx: 2, fill: color(item.index) });
        svg += text(item.x + SWATCH + 6, y + lineH / 2 + fs * 0.35, item.label, "start");
      });
    });

    return {
      needed,
      natural,
      splittable: false,
      diagnostics,
      facts: { kind, categories: categories.length, series: series.length },
      chunks: [
        {
          height: H,
          html: (x, y) =>
            h(
              "svg",
              {
                xmlns: "http://www.w3.org/2000/svg",
                width: n2(W),
                height: n2(H),
                viewBox: `0 0 ${n2(W)} ${n2(H)}`,
                style: absStyle(x, y, W, H, { overflow: "visible" }),
              },
              svg,
            ),
        },
      ],
    };
  },

  semantic(component, { locale }) {
    const { kind, categories, series } = component.content;
    const unit = component.props?.unit ?? "";
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    const caption = `${kind} chart: ${series.map((s) => s.name).join(", ")}`;
    const head = h("thead", {}, h("tr", {}, h("td", {}), ...series.map((s) => h("th", { scope: "col" }, textNode(s.name)))));
    const rows = categories.map((category, i) =>
      h(
        "tr",
        {},
        h("th", { scope: "row" }, textNode(category)),
        ...series.map((s) => h("td", {}, textNode(s.values[i] === undefined ? "" : `${number.format(s.values[i] as number)}${unit}`))),
      ),
    );
    return h("figure", {}, h("figcaption", {}, textNode(caption)), h("table", {}, head, h("tbody", {}, ...rows)));
  },

  describe(component) {
    const { kind, categories, series } = component.content;
    return `${kind} chart, ${categories.length} categories × ${series.length} series`;
  },
};
