import type { FontRegistry } from "../fonts/registry";
import type { LayoutResult, PageLayout } from "../layout/engine";
import { colorValue } from "../style/tokens";
import { absStyle, cssSafe, h, px, styleString, text } from "./html";
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
const GRID_UNIT = "rgba(31,79,216,0.06)";
const GRID_MOVED = "rgba(197,34,31,0.75)";
const GRID_BOX = "rgba(30,142,62,0.8)";
const GRID_PAGE = "rgba(31,79,216,0.85)";

const r1 = (n: number) => String(Math.round(n * 10) / 10);

function chip(x: number, y: number, label: string, color: string, anchor: "left" | "right" = "left"): string {
  return h("div", { class: "dfl-grid-chip", style: { [anchor]: x, top: y, color, borderColor: color } }, text(label));
}

/** A see-through layer with the unit grid, the guide columns and every component box. Never printed. */
function gridOverlay(result: LayoutResult, page: PageLayout): string {
  const { grid, guides } = result;
  const unit = grid.unit;
  const c = page.content;
  let shapes = "";
  // Labels go last so no outline crosses them.
  let labels = "";
  const numbersY = Math.max(2, c.y - 34);
  shapes += h("div", {
    style: absStyle(c.x, c.y, result.units.cols * unit, page.rows * unit, {
      backgroundImage: `linear-gradient(to right, ${GRID_UNIT} 1px, transparent 1px), linear-gradient(to bottom, ${GRID_UNIT} 1px, transparent 1px)`,
      backgroundSize: `${unit}px ${unit}px`,
    }),
  });
  for (const g of guides) {
    const x = c.x + g.x * unit;
    shapes += h("div", {
      style: absStyle(x, c.y, g.w * unit, c.height, {
        background: GRID_COLUMN,
        borderLeft: `1px dashed ${GRID_COLUMN_EDGE}`,
        borderRight: `1px dashed ${GRID_COLUMN_EDGE}`,
        boxSizing: "border-box",
      }),
    });
    labels += h("div", { class: "dfl-grid-col", style: { left: x, top: numbersY, width: g.w * unit } }, text(String(g.col)));
  }
  labels += chip(
    c.x - 6,
    numbersY - 18 < 0 ? page.height - 18 : numbersY - 18,
    `page ${page.index + 1} · ${r1(page.width)}×${r1(page.height)} · ${result.units.cols}×${page.rows} units of ${unit}px · ${grid.columns} guides`,
    GRID_PAGE,
  );
  for (const box of page.boxes) {
    const geo = result.components[box.component];
    const piece = geo ? (geo.pieces[box.piece ?? 0] ?? geo.box) : null;
    const moved = !!geo && geo.shifted > 0 && (box.piece ?? 0) === 0;
    const color = moved ? GRID_MOVED : GRID_BOX;
    shapes += h("div", { style: absStyle(box.x, box.y, box.width, box.height, { outline: `1.5px solid ${color}`, outlineOffset: -1 }) });
    const where = piece ? ` · x${piece.x} y${piece.y} w${piece.w} h${piece.h}` : "";
    const note = moved ? ` · ↓${geo?.shifted}${geo?.pushedBy ? ` by ${geo.pushedBy}` : ""}` : "";
    labels += chip(page.width - box.x - box.width, box.y + box.height - 16, `${box.component}${where}${note}`, color, "right");
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

/**
 * A standalone HTML page (for printing, embedding in an iframe or saving to a file).
 * `backdrop` is the colour around the pages on screen (never printed); `null` leaves it
 * transparent, for an iframe that should show its host's background.
 */
export function toHtmlPage(rendered: RenderedDocument, title = "Document", options: { backdrop?: string | null } = {}): string {
  const backdrop = options.backdrop === undefined ? "#e9ebee" : options.backdrop === null ? "transparent" : cssSafe(options.backdrop);
  // The page shell is static markup; the only dynamic parts (title, CSS, body) are escaped or built by h().
  // eslint-disable-next-line no-restricted-syntax
  return `<!doctype html><html><head><meta charset="utf-8"><title>${text(title)}</title><style>html,body{margin:0;background:${backdrop}}@media print{html,body{background:none}}\n${rendered.css}</style></head><body>${rendered.html}</body></html>`;
}
