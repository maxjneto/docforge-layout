import { cssFamily } from "../fonts/registry";
import { absStyle, h, text as textNode } from "../render/html";
import { colorValue } from "../style/tokens";
import { diag, type Diagnostic } from "../validate/diagnostics";
import type { ComponentOf } from "../schema/components";
import type { ComponentDef } from "./types";

const MIN_PLOT_HEIGHT = 60;
const MIN_PLOT_WIDTH = 80;
const MIN_PIE_RADIUS = 40;
const NATURAL_PLOT = 200;
const SWATCH = 10;
const DONUT_HOLE = 0.6;
const AREA_OPACITY = 0.25;

type Chart = ComponentOf<"chart">;
type ValuesSeries = { name: string; values: number[] };
type PointsSeries = { name: string; points: [number, number][] };

const valuesOf = (chart: Chart): ValuesSeries[] => chart.content.series.filter((s): s is ValuesSeries => "values" in s);
const pointsOf = (chart: Chart): PointsSeries[] => chart.content.series.filter((s): s is PointsSeries => "points" in s);

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

/** A scale from `min` to `max` (0 included unless `withZero` is off), widened to nice ticks; axis.min/max win. */
function scale(min: number, max: number, axis: { min?: number; max?: number } | undefined, withZero = true) {
  let a = withZero ? Math.min(0, min) : min;
  let b = withZero ? Math.max(0, max) : max;
  if (a === b) {
    a -= 1;
    b += 1;
  }
  const step0 = niceStep(b - a, 4);
  let lo = axis?.min ?? Math.floor(a / step0) * step0;
  let hi = axis?.max ?? (Math.ceil(b / step0) * step0 || step0);
  if (hi <= lo) hi = lo + step0;
  const step = axis?.min !== undefined || axis?.max !== undefined ? niceStep(hi - lo, 4) : step0;
  const ticks: number[] = [];
  const first = Math.ceil(lo / step - 1e-9) * step;
  // `+ 0` turns -0 into 0, so an axis never says "-0".
  for (let t = first; t <= hi + step / 1e6; t += step) ticks.push(Math.round(t * 1e6) / 1e6 + 0);
  if (!ticks.length) ticks.push(lo, hi);
  lo = Math.min(lo, ticks[0] as number);
  hi = Math.max(hi, ticks[ticks.length - 1] as number);
  return { lo, hi, ticks };
}

export const chartComponent: ComponentDef<"chart"> = {
  type: "chart",
  sizing: "area",
  decorated: true,
  variants: [],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const style = ctx.style();
    const props = component.props ?? {};
    const { kind } = component.content;
    const categories = component.content.categories ?? [];
    const series = valuesOf(component);
    const points = pointsOf(component);
    const unit = props.unit ?? "";
    const showValues = props.values === true;
    const format = formatter(ctx.locale);
    const round = kind === "pie" || kind === "donut";
    const horizontal = kind === "bar" && props.orientation === "horizontal";
    const stacked = props.stacked === true && (kind === "bar" || kind === "area");
    const palette = (props.colors ?? [1, 2, 3, 4, 5, 6].map((i) => `$color.chart${i}`)).map((c) => colorValue(c, ctx.tokens, style.accent));
    const color = (i: number) => palette[i % palette.length] as string;
    const surface = colorValue("$color.surface", ctx.tokens, "#ffffff");

    if (kind !== "scatter") {
      series.forEach((s) => {
        if (s.values.length !== categories.length) {
          diagnostics.push(
            diag("warning", "chart-series-length", `Series "${s.name}" has ${s.values.length} values for ${categories.length} categories.`, {
              suggestions: ["Give every series one value per category."],
            }),
          );
        }
      });
    }
    const value = (s: ValuesSeries, i: number) => {
      const v = s.values[i] ?? 0;
      return stacked ? Math.max(0, v) : v;
    };
    if (stacked && series.some((s) => s.values.some((v) => v < 0))) {
      diagnostics.push(
        diag("warning", "chart-stacked-negative", "A stacked chart cannot stack negative values; they are drawn as 0.", {
          suggestions: ["Turn stacked off to show negative values, or remove them."],
        }),
      );
    }

    const face = ctx.registry.match(style.fontFamily, style.fontWeight, false);
    const fs = style.fontSize;
    const lineH = Math.ceil(fs * 1.4);
    const measure = (t: string) => ctx.registry.measure(face, fs, t);
    const W = ctx.width;
    const family = cssFamily(face.family);
    const n2 = (v: number) => v.toFixed(2);
    const text = (x: number, y: number, t: string, anchor: "start" | "middle" | "end", extra: Record<string, string | number> = {}) =>
      h(
        "text",
        { x: n2(x), y: n2(y), "text-anchor": anchor, "font-family": family, "font-size": fs, "font-weight": face.weight, fill: style.color, ...extra },
        textNode(t),
      );
    const truncate = (label: string, room: number): [string, boolean] => {
      if (measure(label) <= room) return [label, false];
      let cut = label;
      while (cut.length > 1 && measure(`${cut}…`) > room) cut = cut.slice(0, -1);
      return [`${cut}…`, true];
    };

    // Legend: one item per series (per category for pie and donut), below the plot or on its right.
    const roundValues = (series[0]?.values ?? []).map((v) => Math.max(0, v));
    const roundTotal = roundValues.reduce((s, v) => s + v, 0);
    const legendLabels = round
      ? categories.map((c, i) => `${c} ${Math.round(((roundValues[i] ?? 0) / (roundTotal || 1)) * 100)}%`)
      : component.content.series.map((s) => s.name);
    const showLegend = props.legend ?? (round || component.content.series.length > 1);
    const legendRight = showLegend && props.legendPosition === "right";
    const legendRows: { label: string; index: number; x: number }[][] = [];
    let legendW = 0;
    if (legendRight) {
      const widest = Math.max(...legendLabels.map(measure));
      legendW = Math.min(W * 0.4, SWATCH + 6 + widest + 12);
      legendLabels.forEach((label, index) => legendRows.push([{ label: truncate(label, legendW - SWATCH - 18)[0], index, x: 0 }]));
    } else if (showLegend) {
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
    const legendH = legendRows.length && !legendRight ? legendRows.length * lineH + 8 : 0;
    const legendColumnH = legendRight ? legendRows.length * lineH : 0;
    const areaW = W - legendW;

    const xTitle = round ? undefined : props.axis?.x;
    const yTitle = round ? undefined : props.axis?.y;
    const xTitleH = xTitle ? lineH : 0;
    const yTitleW = yTitle ? lineH : 0;
    const xLabelH = round ? 0 : lineH + 4;
    const topPad = round ? 0 : Math.ceil(fs / 2) + (showValues && !horizontal ? lineH : 0);
    const minPlot = round ? MIN_PIE_RADIUS * 2 : horizontal ? Math.max(MIN_PLOT_HEIGHT, categories.length * lineH) : MIN_PLOT_HEIGHT;
    const around = legendH + xLabelH + xTitleH + topPad;
    const needed = Math.max(minPlot + around, legendColumnH);
    const naturalPlot = round ? Math.min(NATURAL_PLOT, areaW) : horizontal ? Math.max(NATURAL_PLOT, categories.length * (lineH + 8)) : NATURAL_PLOT;
    const natural = Math.max(naturalPlot + around, legendColumnH);
    const H = ctx.height ?? natural;
    const plotTop = topPad;
    const plotH = H - around;

    let svg = "";
    let roundLegendX: number | null = null;
    let roundLegendY: number | null = null;
    const tooSmall = (w: number, hgt: number) =>
      diagnostics.push(
        diag("error", "chart-too-small", `Plot area would be ${Math.round(w)}×${Math.round(hgt)}px; it needs at least ${MIN_PLOT_WIDTH}×${MIN_PLOT_HEIGHT}px.`, {
          suggestions: [`Give it at least ${Math.ceil(needed)}px of content height, or widen the component.`],
        }),
      );

    if (round) {
      const r = Math.max(0, Math.min(areaW, plotH) / 2 - 2);
      if (r < MIN_PIE_RADIUS) {
        diagnostics.push(
          diag("error", "chart-too-small", `${kind === "donut" ? "Donut" : "Pie"} radius would be ${Math.round(r)}px; it needs at least ${MIN_PIE_RADIUS}px.`, {
            suggestions: [`Give it at least ${Math.ceil(needed)}px of content height, or widen the component.`],
          }),
        );
      }
      // With the legend on the right, the circle and the legend are centered together.
      const group = legendRight ? 2 * r + 12 + legendW : 2 * r;
      const cx = legendRight ? Math.max(r, (W - group) / 2 + r) : areaW / 2;
      roundLegendX = cx + r + 12;
      const cy = plotTop + plotH / 2;
      roundLegendY = cy - legendColumnH / 2;
      const inner = kind === "donut" ? r * DONUT_HOLE : 0;
      const total = roundTotal || 1;
      let angle = -Math.PI / 2;
      const at = (radius: number, a: number) => `${n2(cx + radius * Math.cos(a))},${n2(cy + radius * Math.sin(a))}`;
      roundValues.forEach((v, i) => {
        const sweep = (v / total) * Math.PI * 2;
        if (sweep <= 0) return;
        const end = angle + sweep;
        const large = sweep > Math.PI ? 1 : 0;
        if (sweep >= Math.PI * 2 - 1e-6) {
          svg += h("circle", { cx: n2(cx), cy: n2(cy), r: n2(r), fill: color(i) });
        } else if (inner > 0) {
          const d = `M${at(r, angle)} A${n2(r)},${n2(r)} 0 ${large} 1 ${at(r, end)} L${at(inner, end)} A${n2(inner)},${n2(inner)} 0 ${large} 0 ${at(inner, angle)} Z`;
          svg += h("path", { d, fill: color(i), stroke: surface, "stroke-width": 1 });
        } else {
          const d = `M${n2(cx)},${n2(cy)} L${at(r, angle)} A${n2(r)},${n2(r)} 0 ${large} 1 ${at(r, end)} Z`;
          svg += h("path", { d, fill: color(i), stroke: surface, "stroke-width": 1 });
        }
        angle = end;
      });
      if (inner > 0) {
        svg += h("circle", { cx: n2(cx), cy: n2(cy), r: n2(inner), fill: surface });
        const label = props.center ?? format(roundTotal, unit);
        const big = Math.round(fs * 1.6);
        const bigWidth = ctx.registry.measure(face, big, label);
        if (bigWidth <= inner * 1.8) svg += text(cx, cy + big * 0.35, label, "middle", { "font-size": big });
        else if (measure(label) <= inner * 1.8) svg += text(cx, cy + fs * 0.35, label, "middle");
        else {
          diagnostics.push(diag("warning", "chart-labels-overlap", `The donut's center text "${label}" does not fit the hole and is not drawn.`, { suggestions: ["Shorten props.center."] }));
        }
      }
    } else if (kind === "scatter") {
      const xs = points.flatMap((s) => s.points.map((p) => p[0]));
      const ys = points.flatMap((s) => s.points.map((p) => p[1]));
      const sy = scale(Math.min(...ys), Math.max(...ys), props.axis, false);
      const sx = scale(Math.min(...xs), Math.max(...xs), undefined, false);
      const yLabelW = Math.ceil(Math.max(...sy.ticks.map((t) => measure(format(t, unit)))));
      const plotX = yTitleW + yLabelW + 8;
      const lastX = measure(format(sx.ticks[sx.ticks.length - 1] as number)) / 2;
      const plotW = areaW - plotX - lastX;
      if (plotH < MIN_PLOT_HEIGHT || plotW < MIN_PLOT_WIDTH) tooSmall(plotW, plotH);
      const yOf = (v: number) => plotTop + plotH - ((v - sy.lo) / (sy.hi - sy.lo)) * plotH;
      const xOf = (v: number) => plotX + ((v - sx.lo) / (sx.hi - sx.lo)) * plotW;
      for (const t of sy.ticks) {
        if (props.grid !== false) svg += h("line", { x1: n2(plotX), x2: n2(plotX + plotW), y1: n2(yOf(t)), y2: n2(yOf(t)), stroke: style.borderColor, "stroke-width": 1 });
        svg += text(yTitleW + yLabelW, yOf(t) + fs * 0.35, format(t, unit), "end");
      }
      for (const t of sx.ticks) svg += text(xOf(t), plotTop + plotH + 4 + fs, format(t), "middle");
      svg += h("line", { x1: n2(plotX), x2: n2(plotX + plotW), y1: n2(plotTop + plotH), y2: n2(plotTop + plotH), stroke: style.muted, "stroke-width": 1 });
      let cut = 0;
      points.forEach((s, si) => {
        for (const [px, py] of s.points) {
          if (py < sy.lo || py > sy.hi) {
            cut++;
            continue;
          }
          svg += h("circle", { cx: n2(xOf(px)), cy: n2(yOf(py)), r: 3.5, fill: color(si), "fill-opacity": 0.85 });
          if (showValues) svg += text(xOf(px), yOf(py) - 7, format(py, unit), "middle");
        }
      });
      if (cut) axisRange(cut);
      drawTitles(plotX, plotW);
    } else {
      // bar, line and area over categories.
      const sums = categories.map((_, i) => series.reduce((s, ser) => s + value(ser, i), 0));
      const all = stacked ? sums : series.flatMap((s) => s.values);
      const sc = scale(Math.min(...all), Math.max(...all), props.axis);
      const outside = all.filter((v) => v < sc.lo - 1e-9 || v > sc.hi + 1e-9).length;
      if (outside) axisRange(outside);
      const clamp = (v: number) => Math.min(sc.hi, Math.max(sc.lo, v));
      const grid = props.grid !== false;

      if (horizontal) {
        const labelRoom = areaW * 0.4;
        const widest = Math.max(...categories.map(measure));
        const catW = Math.ceil(Math.min(labelRoom, widest));
        const plotX = yTitleW + catW + 8;
        const lastTick = measure(format(sc.ticks[sc.ticks.length - 1] as number, unit)) / 2;
        const valueRoom = showValues ? measure(format(Math.max(...all), unit)) + 6 : 0;
        const plotW = areaW - plotX - Math.max(lastTick, valueRoom);
        if (plotH < MIN_PLOT_HEIGHT || plotW < MIN_PLOT_WIDTH) tooSmall(plotW, plotH);
        const xOf = (v: number) => plotX + ((clamp(v) - sc.lo) / (sc.hi - sc.lo)) * plotW;
        for (const t of sc.ticks) {
          if (grid) svg += h("line", { x1: n2(xOf(t)), x2: n2(xOf(t)), y1: n2(plotTop), y2: n2(plotTop + plotH), stroke: style.borderColor, "stroke-width": 1 });
          svg += text(xOf(t), plotTop + plotH + 4 + fs, format(t, unit), "middle");
        }
        const slot = plotH / Math.max(1, categories.length);
        let truncated = 0;
        categories.forEach((cat, i) => {
          const [label, cutLabel] = truncate(cat, catW);
          if (cutLabel) truncated++;
          svg += text(yTitleW + catW, plotTop + slot * i + slot / 2 + fs * 0.35, label, "end");
        });
        if (truncated) labelsOverlap(truncated, categories.length, catW);
        const group = slot * 0.7;
        const barH = stacked ? group : group / Math.max(1, series.length);
        const offsets = categories.map(() => 0);
        series.forEach((s, si) => {
          categories.forEach((_, i) => {
            const v = value(s, i);
            const y = plotTop + slot * i + (slot - group) / 2 + (stacked ? 0 : barH * si);
            const from = stacked ? (offsets[i] as number) : 0;
            const to = from + v;
            const x0 = xOf(Math.min(from, to));
            const x1 = xOf(Math.max(from, to));
            svg += h("rect", { x: n2(x0), y: n2(y), width: n2(Math.max(1, x1 - x0)), height: n2(Math.max(1, barH - 2)), fill: color(si), rx: 2 });
            if (stacked) offsets[i] = to;
            if (showValues && !stacked) svg += text(x1 + 4, y + barH / 2 + fs * 0.3, format(v, unit), "start");
          });
        });
        if (showValues && stacked) sums.forEach((v, i) => (svg += text(xOf(v) + 4, plotTop + slot * i + slot / 2 + fs * 0.35, format(v, unit), "start")));
        svg += h("line", { x1: n2(xOf(0)), x2: n2(xOf(0)), y1: n2(plotTop), y2: n2(plotTop + plotH), stroke: style.muted, "stroke-width": 1 });
        drawTitles(plotX, plotW);
      } else {
        const yLabelW = Math.ceil(Math.max(...sc.ticks.map((t) => measure(format(t, unit)))));
        const plotX = yTitleW + yLabelW + 8;
        const plotW = areaW - plotX;
        if (plotH < MIN_PLOT_HEIGHT || plotW < MIN_PLOT_WIDTH) tooSmall(plotW, plotH);
        const yOf = (v: number) => plotTop + plotH - ((clamp(v) - sc.lo) / (sc.hi - sc.lo)) * plotH;
        for (const t of sc.ticks) {
          if (grid) svg += h("line", { x1: n2(plotX), x2: n2(areaW), y1: n2(yOf(t)), y2: n2(yOf(t)), stroke: style.borderColor, "stroke-width": 1 });
          svg += text(yTitleW + yLabelW, yOf(t) + fs * 0.35, format(t, unit), "end");
        }
        const slot = plotW / Math.max(1, categories.length);
        let truncated = 0;
        categories.forEach((cat, i) => {
          const [label, cutLabel] = truncate(cat, slot - 4);
          if (cutLabel) truncated++;
          svg += text(plotX + slot * i + slot / 2, plotTop + plotH + 4 + fs, label, "middle");
        });
        if (truncated) labelsOverlap(truncated, categories.length, slot);
        const cx = (i: number) => plotX + slot * i + slot / 2;

        if (kind === "bar") {
          const group = slot * 0.7;
          const barW = stacked ? group : group / Math.max(1, series.length);
          const offsets = categories.map(() => 0);
          series.forEach((s, si) => {
            categories.forEach((_, i) => {
              const v = value(s, i);
              const x = plotX + slot * i + (slot - group) / 2 + (stacked ? 0 : barW * si);
              const from = stacked ? (offsets[i] as number) : 0;
              const to = from + v;
              const top = yOf(Math.max(from, to));
              const bottom = yOf(Math.min(from, to));
              svg += h("rect", { x: n2(x), y: n2(top), width: n2(Math.max(1, barW - 2)), height: n2(Math.max(0, bottom - top)), fill: color(si), rx: 2 });
              if (stacked) offsets[i] = to;
              if (showValues && !stacked) svg += text(x + barW / 2 - 1, top - 4, format(v, unit), "middle");
            });
          });
          if (showValues && stacked) sums.forEach((v, i) => (svg += text(cx(i), yOf(v) - 4, format(v, unit), "middle")));
        } else {
          // line and area; a stacked area adds each series over the ones before it.
          const base = categories.map(() => 0);
          series.forEach((s, si) => {
            const tops = categories.map((_, i) => (stacked ? (base[i] as number) + value(s, i) : value(s, i)));
            const line = tops.map((v, i) => `${n2(cx(i))},${n2(yOf(v))}`);
            if (kind === "area") {
              const floor = stacked ? [...base] : categories.map(() => Math.max(sc.lo, Math.min(sc.hi, 0)));
              const under = floor.map((v, i) => `${n2(cx(i))},${n2(yOf(v))}`).reverse();
              svg += h("polygon", { points: [...line, ...under].join(" "), fill: color(si), "fill-opacity": AREA_OPACITY, stroke: "none" });
            }
            svg += h("polyline", { points: line.join(" "), fill: "none", stroke: color(si), "stroke-width": 2 });
            tops.forEach((v, i) => {
              if (kind === "line") svg += h("circle", { cx: n2(cx(i)), cy: n2(yOf(v)), r: 3, fill: color(si) });
              if (showValues) svg += text(cx(i), yOf(v) - 8, format(stacked ? value(s, i) : v, unit), "middle");
            });
            if (stacked) tops.forEach((v, i) => (base[i] = v));
          });
        }
        svg += h("line", { x1: n2(plotX), x2: n2(areaW), y1: n2(yOf(0)), y2: n2(yOf(0)), stroke: style.muted, "stroke-width": 1 });
        drawTitles(plotX, plotW);
      }
    }

    function axisRange(count: number) {
      diagnostics.push(
        diag("warning", "chart-axis-range", `axis.min/max leave ${count} value(s) outside the axis; they are drawn at its edge.`, {
          suggestions: ["Widen axis.min/axis.max, or remove them to let the axis follow the data."],
        }),
      );
    }
    function labelsOverlap(count: number, of: number, room: number) {
      diagnostics.push(
        diag("warning", "chart-labels-overlap", `${count} of ${of} category labels do not fit their ${Math.round(room)}px and were truncated.`, {
          suggestions: horizontal ? ["Shorten the category names, or widen the chart."] : ["Widen the component.", "Shorten the category names.", 'Use orientation: "horizontal" for long names.'],
        }),
      );
    }
    function drawTitles(plotX: number, plotW: number) {
      if (xTitle) svg += text(plotX + plotW / 2, plotTop + plotH + xLabelH + fs, truncate(xTitle, plotW)[0], "middle", { fill: style.muted });
      if (yTitle) {
        const cy = plotTop + plotH / 2;
        const x = fs;
        svg += text(x, cy, truncate(yTitle, plotH)[0], "middle", { fill: style.muted, transform: `rotate(-90 ${n2(x)} ${n2(cy)})` });
      }
    }

    legendRows.forEach((row, ri) => {
      const y = legendRight ? (roundLegendY ?? plotTop) + ri * lineH : H - legendH + 8 + ri * lineH;
      const x0 = legendRight ? (roundLegendX ?? areaW + 12) : 0;
      row.forEach((item) => {
        svg += h("rect", { x: n2(x0 + item.x), y: n2(y + (lineH - SWATCH) / 2), width: SWATCH, height: SWATCH, rx: 2, fill: color(item.index) });
        svg += text(x0 + item.x + SWATCH + 6, y + lineH / 2 + fs * 0.35, item.label, "start");
      });
    });

    return {
      needed,
      natural,
      splittable: false,
      diagnostics,
      facts: {
        kind,
        ...(kind === "scatter" ? { points: points.reduce((s, p) => s + p.points.length, 0) } : { categories: categories.length }),
        series: component.content.series.length,
        ...(horizontal ? { orientation: "horizontal" } : {}),
        ...(stacked ? { stacked: true } : {}),
      },
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
    const { kind } = component.content;
    const unit = component.props?.unit ?? "";
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    const caption = `${kind} chart: ${component.content.series.map((s) => s.name).join(", ")}`;
    if (kind === "scatter") {
      const tables = pointsOf(component).map((s) =>
        h(
          "table",
          {},
          h("caption", {}, textNode(s.name)),
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "x"), h("th", { scope: "col" }, "y"))),
          h("tbody", {}, ...s.points.map(([x, y]) => h("tr", {}, h("td", {}, textNode(number.format(x))), h("td", {}, textNode(`${number.format(y)}${unit}`))))),
        ),
      );
      return h("figure", {}, h("figcaption", {}, textNode(caption)), ...tables);
    }
    const series = valuesOf(component);
    const head = h("thead", {}, h("tr", {}, h("td", {}), ...series.map((s) => h("th", { scope: "col" }, textNode(s.name)))));
    const rows = (component.content.categories ?? []).map((category, i) =>
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
    const { kind } = component.content;
    const flags = [component.props?.orientation === "horizontal" ? "horizontal" : "", component.props?.stacked ? "stacked" : ""].filter(Boolean).join(" ");
    const name = `${kind}${flags ? ` ${flags}` : ""} chart`;
    if (kind === "scatter") return `${name}, ${component.content.series.length} series, ${pointsOf(component).reduce((s, p) => s + p.points.length, 0)} points`;
    return `${name}, ${(component.content.categories ?? []).length} categories × ${component.content.series.length} series`;
  },
};
