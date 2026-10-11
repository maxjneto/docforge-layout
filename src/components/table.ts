import type { Inline } from "../schema/content";
import { h, renderTextBlock, text } from "../render/html";
import { inlineHtml } from "../render/semantic";
import type { ResolvedStyle } from "../schema/style";
import { colorValue } from "../style/tokens";
import type { TextBlock } from "../text/layout";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { excerpt, layoutInline, rect } from "./shared";
import type { Chunk, ComponentContext, ComponentDef } from "./types";

interface Column {
  header: string;
  width: number;
  align: "left" | "center" | "right";
}

function rowChunk(
  cells: Inline[],
  columns: Column[],
  style: ResolvedStyle,
  ctx: ComponentContext,
  background: string | null,
  out: Diagnostic[],
): Chunk {
  const padX = style.gap;
  const padY = Math.round(style.gap * 0.75);
  const blocks: TextBlock[] = columns.map((col, i) =>
    layoutInline(cells[i] ?? "", style, ctx, col.width - padX * 2, out),
  );
  const contentHeight = Math.max(...blocks.map((b) => b.height));
  const height = contentHeight + padY * 2 + 1;
  return {
    height,
    html: (x, y) => {
      let html = background ? rect(x, y, ctx.width, height - 1, { background }) : "";
      let cx = x;
      columns.forEach((col, i) => {
        const block = blocks[i] as TextBlock;
        html += renderTextBlock(block, { x: cx + padX, y: y + padY, width: col.width - padX * 2, align: col.align });
        cx += col.width;
      });
      html += rect(x, y + height - 1, ctx.width, 1, { background: style.borderColor });
      return html;
    },
  };
}

export const tableComponent: ComponentDef<"table"> = {
  type: "table",
  sizing: "content",
  decorated: true,
  variants: ["header"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const style = ctx.style();
    const headerStyle = ctx.style("header");
    const showHeader = component.props?.header !== false;
    const zebra = component.props?.zebra === true;
    const zebraColor = colorValue("$color.subtle", ctx.tokens, "#f3f4f6");

    const specs = component.content.columns.map((c) => (typeof c === "string" ? { header: c } : c));
    const totalWeight = specs.reduce((s, c) => s + (c.width ?? 1), 0);
    const columns: Column[] = specs.map((c) => ({
      header: c.header,
      width: (ctx.width * (c.width ?? 1)) / totalWeight,
      align: c.align ?? "left",
    }));

    component.content.rows.forEach((row, index) => {
      if (row.length !== columns.length) {
        diagnostics.push(
          diag("warning", "table-row-length", `Row ${index + 1} has ${row.length} cells; the table has ${columns.length} columns.`, {
            suggestions: [row.length < columns.length ? "Missing cells render empty." : "Extra cells are dropped."],
          }),
        );
      }
    });

    const chunks: Chunk[] = [];
    let header: Chunk | undefined;
    if (showHeader) {
      header = rowChunk(columns.map((c) => c.header), columns, headerStyle, ctx, headerStyle.background, diagnostics);
      chunks.push(header);
    }
    component.content.rows.forEach((row, index) => {
      chunks.push(rowChunk(row, columns, style, ctx, zebra && index % 2 === 1 ? zebraColor : style.background, diagnostics));
    });

    const needed = chunks.reduce((s, c) => s + c.height, 0);
    return {
      needed,
      natural: needed,
      chunks,
      header: showHeader && component.props?.repeatHeader !== false ? header : undefined,
      splittable: true,
      diagnostics,
      facts: { columns: columns.length, rows: component.content.rows.length },
    };
  },

  semantic(component) {
    const headers = component.content.columns.map((c) => (typeof c === "string" ? c : c.header));
    const head =
      component.props?.header === false ? "" : h("thead", {}, h("tr", {}, ...headers.map((x) => h("th", { scope: "col" }, text(x)))));
    const body = h(
      "tbody",
      {},
      ...component.content.rows.map((row) => h("tr", {}, ...headers.map((_, i) => h("td", {}, inlineHtml(row[i] ?? ""))))),
    );
    return h("table", {}, head, body);
  },

  describe(component) {
    const headers = component.content.columns.map((c) => (typeof c === "string" ? c : c.header));
    return `table ${component.content.rows.length}×${headers.length}: ${excerpt(headers.join(" | "), 40)}`;
  },
};
