import { defOf, type Chunk } from "../components";
import { absStyle, anchorId, h, safeHref } from "../render/html";
import type { Prepared } from "./types";

export interface BoxOptions {
  /** 0 for the first (or only) piece of a component. */
  piece: number;
}

/**
 * One component box (or one piece of a split component):
 * - the visual layer, absolutely positioned and hidden from assistive technology when
 *   the component has a semantic version;
 * - the semantic layer (real headings, lists, tables…), visually hidden, on the first piece;
 * - anchors for `#id` links and, for `href`, a clickable layer over the box.
 */
export function renderBox(p: Prepared, x: number, y: number, w: number, hgt: number, chunks: Chunk[], options: BoxOptions): string {
  const def = defOf(p.component.type);
  const s = p.decoration;
  const offset = def.decorated ? s.padding : 0;

  let visual = "";
  let cy = offset;
  for (const chunk of chunks) {
    visual += chunk.html(offset, cy);
    cy += chunk.height;
  }

  const semantic = options.piece === 0 && def.semantic ? def.semantic(p.component as never, { locale: p.ctx.locale }) : "";
  const hasSemantic = !!def.semantic && (options.piece > 0 || semantic !== "");
  const layers =
    (semantic ? h("div", { class: "dfl-sr" }, semantic) : "") + (hasSemantic ? h("div", { "aria-hidden": "true" }, visual) : visual);

  const rawHref = (p.component as { props?: { href?: string } }).props?.href;
  const href = rawHref ? safeHref(rawHref) : null;
  // The semantic layer already holds the accessible link; this one is for the pointer and the PDF.
  const link = href
    ? h("a", { class: "dfl-box-link", href, tabindex: -1, "aria-hidden": "true", style: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 1 } })
    : "";

  return h(
    "div",
    {
      class: "dfl-box",
      id: options.piece === 0 ? anchorId(p.component.id) : null,
      "data-component": p.component.id,
      "data-type": p.component.type,
      style: absStyle(x, y, w, hgt, {
        background: def.decorated ? s.background : null,
        border: def.decorated && s.borderWidth ? `${s.borderWidth}px solid ${s.borderColor}` : null,
        borderRadius: def.decorated && s.radius ? s.radius : null,
        boxSizing: "border-box",
      }),
    },
    layers + link,
  );
}
