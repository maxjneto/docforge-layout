import type { Inline } from "../schema/content";
import { absStyle, h, renderTextBlock, safeHref, safeSrc, text } from "../render/html";
import { inlineHtml } from "../render/semantic";
import { inlineText } from "../text/inline";
import type { TextBlock } from "../text/layout";
import type { Diagnostic } from "../validate/diagnostics";
import { layoutInline } from "./shared";
import type { ComponentDef } from "./types";

const MIN_HEIGHT = 24;
/** The widest number a figure label reserves room for. */
const RESERVED = "99";

/** "Figure" in the document's language. */
export function figureWord(locale: string): string {
  const lang = locale.slice(0, 2).toLowerCase();
  return lang === "pt" || lang === "es" ? "Figura" : lang === "de" ? "Abbildung" : "Figure";
}

/** The caption with its "Figure N:" label in front, laid out with room for a two-digit number. */
function captionInline(caption: Inline | undefined, label: string | null): Inline | undefined {
  if (!label) return caption;
  const head = caption === undefined || caption === "" ? `${label}` : `${label}: `;
  if (caption === undefined || typeof caption === "string") return `**${head}**${caption ?? ""}`;
  return [{ text: head, bold: true }, ...caption];
}

/** The same lines with the reserved number swapped for the real one. */
function numbered(block: TextBlock, word: string, n: number): TextBlock {
  const first = block.lines[0];
  const fragment = first?.fragments[0];
  if (!first || !fragment) return block;
  const swapped = { ...fragment, text: fragment.text.replace(`${word} ${RESERVED}`, `${word} ${n}`) };
  return { ...block, lines: [{ ...first, fragments: [swapped, ...first.fragments.slice(1)] }, ...block.lines.slice(1)] };
}

/**
 * Natural height keeps the image's aspect ratio at the area width; `fit` decides how it
 * fills a fixed area. A caption goes under it, numbered when `figure` is on (the number
 * follows reading order, so it is filled in once every box is placed).
 */
export const imageComponent: ComponentDef<"image"> = {
  type: "image",
  sizing: "area",
  decorated: true,
  variants: ["caption"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const { src, alt, width, height: intrinsicHeight, caption } = component.content;
    const fit = component.props?.fit ?? "contain";
    const figure = component.props?.figure === true;
    const word = figureWord(ctx.locale);
    const captionStyle = ctx.style("caption");
    const inline = captionInline(caption, figure ? `${word} ${RESERVED}` : null);
    const block = inline !== undefined ? layoutInline(inline, captionStyle, ctx, ctx.width, diagnostics) : null;
    const gap = block ? ctx.style().gap : 0;
    const below = block ? block.height + gap : 0;

    const imageNatural = (ctx.width * intrinsicHeight) / width;
    const natural = imageNatural + below;
    const height = ctx.height ?? natural;
    const imageHeight = Math.max(1, height - below);
    const radius = ctx.style().radius;
    const id = component.id;
    return {
      needed: MIN_HEIGHT + below,
      natural,
      splittable: false,
      diagnostics,
      facts: { natural: Math.round(natural), fit, ...(block ? { caption: true } : {}), ...(figure ? { figure: true } : {}) },
      chunks: [
        {
          height,
          ...(figure ? { marks: [{ id, kind: "figure" as const }] } : {}),
          html: (x, y) => {
            let html = h("img", {
              src: safeSrc(src) ?? "",
              alt,
              style: absStyle(x, y, ctx.width, imageHeight, { objectFit: fit, borderRadius: radius || null, display: "block" }),
            });
            if (block) {
              const n = ctx.late.figures.get(id);
              const drawn = figure && n !== undefined ? numbered(block, word, n) : block;
              html += renderTextBlock(drawn, { x, y: y + imageHeight + gap, width: ctx.width, align: captionStyle.align, part: "caption" });
            }
            return html;
          },
        },
      ],
    };
  },

  // Only when there is something to say beyond the <img> alt: a caption or a link.
  semantic(component) {
    const { alt, caption } = component.content;
    const href = component.props?.href ? safeHref(component.props.href) : null;
    if (caption === undefined && !href) return "";
    const picture = h("span", { role: "img", "aria-label": alt }, "");
    return h("figure", {}, href ? h("a", { href }, picture, text(alt)) : picture, caption !== undefined ? h("figcaption", {}, inlineHtml(caption)) : "");
  },

  describe(component) {
    const { width, height, alt, caption } = component.content;
    const link = component.props?.href ? ` → ${component.props.href}` : "";
    const fig = component.props?.figure ? " (figure)" : "";
    return `image ${width}×${height} "${alt}"${caption !== undefined ? ` — ${inlineText(caption).slice(0, 30)}` : ""}${fig}${link}`;
  },
};
