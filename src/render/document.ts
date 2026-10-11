import type { FontRegistry } from "../fonts/registry";
import type { LayoutResult, PageLayout } from "../layout/engine";
import { colorValue } from "../style/tokens";
import { absStyle, h, px, styleString, text } from "./html";
import { SR_ONLY_CSS } from "./semantic";

export interface RenderedDocument {
  html: string;
  css: string;
  pages: number;
  width: number;
  /** Height of the tallest page (continuous surfaces: the whole document). */
  height: number;
}

const GRID_COLUMN = "rgba(31,79,216,0.07)";
const GRID_COLUMN_EDGE = "rgba(31,79,216,0.25)";
const GRID_BAND = "rgba(197,34,31,0.65)";
const GRID_BOX = "rgba(30,142,62,0.8)";
const GRID_PAGE = "rgba(31,79,216,0.85)";

const r1 = (n: number) => String(Math.round(n * 10) / 10);

function chip(x: number, y: number, label: string, color: string, anchor: "left" | "right" = "left"): string {
  return h("div", { class: "dfl-grid-chip", style: { [anchor]: x, top: y, color, borderColor: color } }, text(label));
}

/** A see-through layer showing the columns, every band and every component area. Never printed. */
function gridOverlay(result: LayoutResult, page: PageLayout): string {
  const { grid, columnWidth } = result;
  const c = page.content;
  let shapes = "";
  // Labels go last so no outline crosses them.
  let labels = "";
  const numbersY = Math.max(2, c.y - 34);
  for (let i = 0; i < grid.columns; i++) {
    const x = c.x + i * (columnWidth + grid.columnGap);
    shapes += h("div", {
      style: absStyle(x, c.y, columnWidth, c.height, {
        background: GRID_COLUMN,
        borderLeft: `1px dashed ${GRID_COLUMN_EDGE}`,
        borderRight: `1px dashed ${GRID_COLUMN_EDGE}`,
        boxSizing: "border-box",
      }),
    });
    labels += h("div", { class: "dfl-grid-col", style: { left: x, top: numbersY, width: columnWidth } }, text(String(i + 1)));
  }
  labels += chip(
    c.x - 6,
    numbersY - 18 < 0 ? page.height - 18 : numbersY - 18,
    `page ${r1(page.width)}×${r1(page.height)} · content ${r1(c.width)}×${r1(c.height)} · col ${r1(columnWidth)} · gap ${grid.columnGap} · row ${grid.rowUnit}`,
    GRID_PAGE,
  );
  for (const band of page.bands) {
    shapes += h("div", { style: absStyle(c.x - 6, band.y, c.width + 12, band.height, { border: `1px dashed ${GRID_BAND}`, boxSizing: "border-box" }) });
    const part = band.piece !== undefined ? ` · part ${band.piece + 1}` : "";
    labels += chip(c.x - 6, band.y - 16, `${band.section} · ${band.id} · ${band.rows} rows · ${r1(band.height)}px${part}`, GRID_BAND);
  }
  for (const box of page.boxes) {
    const geo = result.components[box.component];
    shapes += h("div", { style: absStyle(box.x, box.y, box.width, box.height, { outline: `1.5px solid ${GRID_BOX}`, outlineOffset: -1 }) });
    const cols = geo ? ` · ${geo.colStart}–${geo.colStart + geo.colSpan - 1}` : "";
    const overflow = geo?.overflow ? ` · +${geo.overflow}px` : "";
    const label = `${box.component}${cols} · ${r1(box.width)}×${r1(box.height)}${overflow}`;
    labels += chip(page.width - box.x - box.width, box.y + box.height - 16, label, geo?.overflow ? GRID_BAND : GRID_BOX, "right");
  }
  return h("div", { class: "dfl-grid", "aria-hidden": "true" }, shapes + labels);
}

/**
 * HTML and CSS for a laid-out document. Every page is a fixed-size box and every
 * component is absolutely positioned, so printing to PDF reproduces the screen:
 * the browser makes no layout decision of its own.
 */
export function renderLayout(
  result: LayoutResult,
  registry: FontRegistry,
  options: { screen?: boolean; grid?: boolean } = {},
): RenderedDocument {
  const screen = options.screen ?? true;
  const width = result.pages[0]?.width ?? 0;
  const height = Math.max(0, ...result.pages.map((p) => p.height));
  const paper = colorValue("$color.surface", result.tokens, "#ffffff");

  const pagesHtml = result.pages
    .map(
      (page) =>
        h(
          "div",
          { class: "dfl-page", "data-page": page.index + 1, style: { width: page.width, height: page.height } },
          page.boxes.map((b) => b.html).join("") + (options.grid ? gridOverlay(result, page) : ""),
        ),
    )
    .join("");

  const css = [
    registry.fontFaceCss(),
    `@page{size:${px(width)} ${px(height)};margin:0}`,
    `.dfl-doc{${screen ? "padding:24px 0;" : ""}}`,
    `.dfl-page{position:relative;overflow:hidden;${styleString({ background: paper })};margin:${screen ? "0 auto 24px" : "0"};${screen ? "box-shadow:0 1px 3px rgba(0,0,0,.12),0 4px 16px rgba(0,0,0,.06);" : ""}font-kerning:normal;font-variant-ligatures:normal;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}`,
    `.dfl-page *{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
    SR_ONLY_CSS,
    `.dfl-grid{position:absolute;inset:0;pointer-events:none;z-index:10}.dfl-grid-col{position:absolute;font:600 10px/14px system-ui,sans-serif;color:rgba(31,79,216,.7);text-align:center}.dfl-grid-chip{position:absolute;font:600 10px/14px system-ui,sans-serif;padding:0 5px;background:#fff;border:1px solid;border-radius:3px;white-space:nowrap}`,
    `@media print{.dfl-grid{display:none}html,body{margin:0;padding:0;background:none}.dfl-doc{padding:0}.dfl-page{margin:0;box-shadow:none;break-after:page;page-break-after:always}.dfl-page:last-child{break-after:auto;page-break-after:auto}}`,
  ].join("\n");

  return { html: h("div", { class: "dfl-doc" }, pagesHtml), css, pages: result.pages.length, width, height };
}

/** A standalone HTML page (for printing, embedding in an iframe or saving to a file). */
export function toHtmlPage(rendered: RenderedDocument, title = "Document"): string {
  // The page shell is static markup; the only dynamic parts (title, CSS, body) are escaped or built by h().
  // eslint-disable-next-line no-restricted-syntax
  return `<!doctype html><html><head><meta charset="utf-8"><title>${text(title)}</title><style>html,body{margin:0;background:#e9ebee}@media print{html,body{background:none}}\n${rendered.css}</style></head><body>${rendered.html}</body></html>`;
}
