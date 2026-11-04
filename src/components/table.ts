import type { Inline } from "../schema/content";
import type { ComponentOf, TableCell } from "../schema/components";
import { h, renderTextBlock, text } from "../render/html";
import { inlineHtml } from "../render/semantic";
import type { ResolvedStyle } from "../schema/style";
import { mix, parseColor } from "../style/color";
import { colorValue } from "../style/tokens";
import { inlineText } from "../text/inline";
import type { TextBlock } from "../text/layout";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { excerpt, inlineWidths, layoutInline, rect } from "./shared";
import type { Chunk, ComponentContext, ComponentDef } from "./types";

interface Column {
  header: string;
  width: number;
  align: "left" | "center" | "right";
}

interface Cell {
  text: Inline;
  span: number;
  align?: "left" | "center" | "right";
}

/** A bar drawn behind one cell: the share of the column's largest value. */
interface Bar {
  col: number;
  fraction: number;
  color: string;
}

const cellOf = (cell: TableCell): Cell =>
  typeof cell === "string" || Array.isArray(cell) ? { text: cell, span: 1 } : { text: cell.text, span: cell.span ?? 1, align: cell.align };

/** Columns a row covers, counting spans. */
const widthOfRow = (cells: Cell[]) => cells.reduce((s, c) => s + c.span, 0);

/** "R$ 1.234,56", "12%", "-3.5" → number, reading the decimal mark of `locale`; null when it is not a number. */
export function cellNumber(value: string, locale: string): number | null {
  const decimal = (1.5).toLocaleString(locale).charAt(1) === "," ? "," : ".";
  const cleaned = value.replace(/[^\d,.\-−]/g, "").replace("−", "-");
  if (!/\d/.test(cleaned)) return null;
  const group = decimal === "," ? "." : ",";
  const normalized = cleaned.split(group).join("").replace(decimal, ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function rowChunk(
  cells: Cell[],
  columns: Column[],
  style: ResolvedStyle,
  ctx: ComponentContext,
  background: string | null,
  out: Diagnostic[],
  part?: string,
  bar?: Bar,
): Chunk {
  const padX = style.gap;
  const padY = Math.round(style.gap * 0.75);
  // Each cell's box: first column and the columns it covers (a short row ends in empty cells).
  const boxes: { cell: Cell; x: number; width: number; align: Column["align"]; col: number }[] = [];
  let col = 0;
  let x = 0;
  for (const cell of cells) {
    if (col >= columns.length) break;
    const span = Math.min(cell.span, columns.length - col);
    const width = columns.slice(col, col + span).reduce((s, c) => s + c.width, 0);
    boxes.push({ cell, x, width, align: cell.align ?? (columns[col] as Column).align, col });
    col += span;
    x += width;
  }
  for (; col < columns.length; col++) {
    const c = columns[col] as Column;
    boxes.push({ cell: { text: "", span: 1 }, x, width: c.width, align: c.align, col });
    x += c.width;
  }
  const blocks: TextBlock[] = boxes.map((b) => layoutInline(b.cell.text, style, ctx, b.width - padX * 2, out));
  const contentHeight = Math.max(...blocks.map((b) => b.height));
  const height = contentHeight + padY * 2 + 1;
  return {
    height,
    html: (x0, y) => {
      let html = background ? rect(x0, y, ctx.width, height - 1, { background }, part) : "";
      boxes.forEach((b, i) => {
        if (bar && bar.col === b.col && b.cell.span === 1 && bar.fraction > 0) {
          html += rect(x0 + b.x + padX, y + padY, Math.max(1, (b.width - padX * 2) * bar.fraction), contentHeight, { background: bar.color }, "bar");
        }
        html += renderTextBlock(blocks[i] as TextBlock, { x: x0 + b.x + padX, y: y + padY, width: b.width - padX * 2, align: b.align, part });
      });
      html += rect(x0, y + height - 1, ctx.width, 1, { background: style.borderColor });
      return html;
    },
  };
}

/** One chunk drawing `a` then `b` right below it (a footer never leaves the last row). */
const joined = (a: Chunk, b: Chunk): Chunk => ({ height: a.height + b.height, html: (x, y) => a.html(x, y) + b.html(x, y + a.height) });

interface Widths {
  mode: "auto" | "fixed";
  columns: Column[];
  /** Per column, px including the cell padding (auto only). */
  min?: number[];
  max?: number[];
  /** Narrowest content width that cuts no word (auto only). */
  minTotal?: number;
}

/**
 * Column widths. `fixed` splits the width by weights. `auto` works like a browser's table:
 * every column gets at least its widest word, and the room left goes to the columns whose
 * text would otherwise wrap, in proportion to how much more they ask for.
 */
function columnWidths(component: ComponentOf<"table">, ctx: ComponentContext, rows: Cell[][], footer: Cell[] | null): Widths {
  const specs = component.content.columns.map((c) => (typeof c === "string" ? { header: c } : c));
  const declared = component.props?.columnWidths;
  const mode = declared ?? (specs.some((c) => c.width !== undefined) ? "fixed" : "auto");
  const W = ctx.width;
  if (mode === "fixed") {
    const totalWeight = specs.reduce((s, c) => s + (c.width ?? 1), 0);
    return { mode, columns: specs.map((c) => ({ header: c.header, width: (W * (c.width ?? 1)) / totalWeight, align: c.align ?? "left" })) };
  }

  const style = ctx.style();
  const n = specs.length;
  const min = new Array<number>(n).fill(0);
  const max = new Array<number>(n).fill(0);
  const take = (cells: Cell[], s: ResolvedStyle) => {
    let col = 0;
    for (const cell of cells) {
      if (col >= n) break;
      // Spanning cells share their columns; only single cells size a column.
      if (cell.span === 1) {
        const w = inlineWidths(cell.text, s, ctx);
        min[col] = Math.max(min[col] as number, w.min);
        max[col] = Math.max(max[col] as number, w.max);
      }
      col += cell.span;
    }
  };
  if (component.props?.header !== false) take(specs.map((c) => ({ text: c.header, span: 1 })), ctx.style("header"));
  for (const row of rows) take(row, style);
  if (footer) take(footer, ctx.style("footer"));

  // Cell padding on both sides, and half a pixel so a measured width never rounds into a cut.
  const pad = (s: ResolvedStyle) => s.gap * 2 + 0.5;
  const cellPad = Math.max(pad(style), pad(ctx.style("header")));
  for (let i = 0; i < n; i++) {
    min[i] = (min[i] as number) + cellPad;
    max[i] = Math.max(min[i] as number, (max[i] as number) + cellPad);
  }
  const sumMin = min.reduce((a, b) => a + b, 0);
  const sumMax = max.reduce((a, b) => a + b, 0);
  let widths: number[];
  if (sumMax <= W) widths = max.map((m) => m + ((W - sumMax) * m) / sumMax);
  else if (sumMin <= W) {
    const slack = sumMax - sumMin;
    widths = min.map((m, i) => m + ((W - sumMin) * ((max[i] as number) - m)) / slack);
  } else widths = min.map((m) => (m * W) / sumMin);
  return {
    mode,
    columns: specs.map((c, i) => ({ header: c.header, width: widths[i] as number, align: c.align ?? "left" })),
    min,
    max,
    minTotal: Math.ceil(sumMin),
  };
}

export const tableComponent: ComponentDef<"table"> = {
  type: "table",
  sizing: "content",
  decorated: true,
  variants: ["header", "zebra", "footer"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const cellDiagnostics: Diagnostic[] = [];
    const style = ctx.style();
    const headerStyle = ctx.style("header");
    const footerStyle = ctx.style("footer");
    const showHeader = component.props?.header !== false;
    const zebra = component.props?.zebra === true;
    // The striped rows' color is the `zebra` part's background (the preset gives it the subtle tone).
    const zebraColor = ctx.style("zebra").background ?? colorValue("$color.subtle", ctx.tokens, "#f3f4f6");

    const rows = component.content.rows.map((row) => row.map(cellOf));
    const footer = component.content.footer ? component.content.footer.map(cellOf) : null;
    const sized = columnWidths(component, ctx, rows, footer);
    const { columns } = sized;

    const checkLength = (cells: Cell[], where: string) => {
      const count = widthOfRow(cells);
      if (count === columns.length) return;
      diagnostics.push(
        diag("warning", "table-row-length", `${where} covers ${count} columns; the table has ${columns.length}.`, {
          suggestions: [count < columns.length ? "Missing cells render empty." : "Extra cells are dropped."],
        }),
      );
    };
    rows.forEach((row, index) => checkLength(row, `Row ${index + 1}`));
    if (footer) checkLength(footer, "The footer");

    // Bars: one numeric column, each value as a share of the column's largest.
    let barCol = -1;
    const barsProp = component.props?.bars;
    if (barsProp !== undefined) {
      barCol = typeof barsProp === "number" ? barsProp : columns.findIndex((c) => c.header === barsProp);
      if (barCol < 0 || barCol >= columns.length) {
        diagnostics.push(
          diag("warning", "table-bars-column", `bars names ${JSON.stringify(barsProp)}, which is not a column of this table.`, {
            suggestions: [`Use a header (${columns.map((c) => JSON.stringify(c.header)).join(", ")}) or a 0-based index.`],
          }),
        );
        barCol = -1;
      }
    }
    const valueAt = (cells: Cell[]): number | null => {
      let col = 0;
      for (const cell of cells) {
        if (col === barCol) return cell.span === 1 ? cellNumber(inlineText(cell.text), ctx.locale) : null;
        col += cell.span;
        if (col > barCol) return null;
      }
      return null;
    };
    const values = barCol >= 0 ? rows.map(valueAt) : [];
    const top = Math.max(0, ...values.map((v) => v ?? 0));
    const surface = parseColor(colorValue("$color.surface", ctx.tokens, "#ffffff"));
    const accent = parseColor(style.accent);
    const barColor = surface && accent ? mix(surface, accent, 0.25) : colorValue("$color.subtle", ctx.tokens, "#f3f4f6");

    const chunks: Chunk[] = [];
    let header: Chunk | undefined;
    if (showHeader) {
      header = rowChunk(columns.map((c) => ({ text: c.header, span: 1 })), columns, headerStyle, ctx, headerStyle.background, cellDiagnostics, "header");
      chunks.push(header);
    }
    const repeat = showHeader && component.props?.repeatHeader !== false ? header : undefined;
    rows.forEach((row, index) => {
      const striped = zebra && index % 2 === 1;
      const value = values[index];
      const bar = barCol >= 0 && value !== null && value !== undefined && value > 0 && top > 0 ? { col: barCol, fraction: value / top, color: barColor } : undefined;
      const chunk = rowChunk(row, columns, style, ctx, striped ? zebraColor : style.background, cellDiagnostics, striped ? "zebra" : undefined, bar);
      chunks.push(repeat ? { ...chunk, repeat } : chunk);
    });
    if (footer) {
      const foot = rowChunk(footer, columns, footerStyle, ctx, footerStyle.background, cellDiagnostics, "footer");
      const last = rows.length ? chunks.pop() : undefined;
      chunks.push(last ? { ...joined(last, foot), ...(repeat ? { repeat } : {}) } : foot);
    }

    // Cut words: one diagnostic for the table, saying what would keep them whole.
    const broken = cellDiagnostics.filter((d) => d.code === "word-broken").length;
    diagnostics.push(...cellDiagnostics.filter((d) => d.code !== "word-broken"));
    const unit = ctx.unit;
    const minUnits = sized.minTotal !== undefined ? Math.ceil((sized.minTotal + ctx.inset * 2) / unit - 1e-6) : null;
    if (sized.mode === "auto" && sized.minTotal !== undefined && sized.minTotal > ctx.width + 0.5) {
      const tight = (sized.min ?? [])
        .map((m, i) => ({ header: (columns[i] as Column).header, m }))
        .sort((a, b) => b.m - a.m)
        .slice(0, 2)
        .map((c) => `"${c.header}" (${Math.ceil(c.m)}px)`);
      diagnostics.push(
        diag("warning", "table-too-narrow", `The columns need ${sized.minTotal}px to keep every word whole; the table has ${Math.floor(ctx.width)}px, so words are cut.`, {
          data: { neededPx: sized.minTotal, widthPx: Math.floor(ctx.width), minW: minUnits },
          suggestions: [
            `Make the table at least w ${minUnits} (${minUnits} units).`,
            `Widest columns: ${tight.join(", ")}: shorten their longest word, or use a smaller fontSize.`,
          ],
        }),
      );
    } else if (broken > 0) {
      diagnostics.push(
        diag("warning", "word-broken", `${broken} cell(s) have a word wider than their column and were cut mid-word.`, {
          suggestions:
            sized.mode === "fixed"
              ? ['Set props.columnWidths: "auto" so each column gets the width its words need.', "Or raise the width weight of the cut columns."]
              : ["Widen the table or shorten the long word/URL."],
        }),
      );
    }

    const needed = chunks.reduce((s, c) => s + c.height, 0);
    return {
      needed,
      natural: needed,
      chunks,
      header: repeat,
      splittable: true,
      diagnostics,
      facts: {
        columns: columns.length,
        rows: component.content.rows.length,
        columnWidths: sized.mode,
        columnPx: columns.map((c) => Math.round(c.width)),
        ...(sized.min ? { columnMinPx: sized.min.map((m) => Math.ceil(m)), columnMaxPx: (sized.max ?? []).map((m) => Math.ceil(m)) } : {}),
        ...(minUnits !== null ? { minW: minUnits } : {}),
        ...(footer ? { footer: true } : {}),
      },
    };
  },

  semantic(component) {
    const headers = component.content.columns.map((c) => (typeof c === "string" ? c : c.header));
    const cellsHtml = (cells: Cell[], tag: "td" | "th") => {
      const out: string[] = [];
      let col = 0;
      for (const cell of cells) {
        if (col >= headers.length) break;
        const span = Math.min(cell.span, headers.length - col);
        out.push(h(tag, span > 1 ? { colspan: span } : {}, inlineHtml(cell.text)));
        col += span;
      }
      for (; col < headers.length; col++) out.push(h(tag, {}, ""));
      return out;
    };
    const head =
      component.props?.header === false ? "" : h("thead", {}, h("tr", {}, ...headers.map((x) => h("th", { scope: "col" }, text(x)))));
    const body = h("tbody", {}, ...component.content.rows.map((row) => h("tr", {}, ...cellsHtml(row.map(cellOf), "td"))));
    const foot = component.content.footer ? h("tfoot", {}, h("tr", {}, ...cellsHtml(component.content.footer.map(cellOf), "td"))) : "";
    return h("table", {}, head, body, foot);
  },

  describe(component) {
    const headers = component.content.columns.map((c) => (typeof c === "string" ? c : c.header));
    return `table ${component.content.rows.length}×${headers.length}: ${excerpt(headers.join(" | "), 40)}`;
  },
};
