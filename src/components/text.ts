import type { TextRole } from "../schema/content";
import { inlineHtml } from "../render/semantic";
import { absStyle, anchorId, h } from "../render/html";
import { inlineText } from "../text/inline";
import type { Diagnostic } from "../validate/diagnostics";
import { excerpt, layoutInline, lineChunks, rect, sumHeights } from "./shared";
import type { Chunk, ComponentDef } from "./types";

/** Roles that are headings, with their outline level. */
export const HEADING_LEVEL: Partial<Record<TextRole, number>> = { display: 1, "title-1": 1, "title-2": 2, "title-3": 3 };

/** Id of the heading made by paragraph `index` of a text (its anchor and its mark). */
export const headingId = (componentId: string, index: number) => `${componentId}--h${index}`;

const QUOTE_BAR = 3;
const QUOTE_INDENT = 14;

export const textComponent: ComponentDef<"text"> = {
  type: "text",
  sizing: "content",
  decorated: true,
  variants: ["display", "title-1", "title-2", "title-3", "subtitle", "body", "quote", "caption"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const chunks: Chunk[] = [];
    const gap = ctx.style().gap;
    const defaultRole: TextRole = component.props?.role ?? "body";
    const roles: TextRole[] = [];
    let lines = 0;

    component.content.paragraphs.forEach((paragraph, index) => {
      const role = typeof paragraph === "string" ? defaultRole : (paragraph.role ?? defaultRole);
      const inline = typeof paragraph === "string" ? paragraph : paragraph.text;
      const style = ctx.style(role);
      const quote = role === "quote";
      const width = quote ? ctx.width - QUOTE_INDENT : ctx.width;
      const block = layoutInline(inline, style, ctx, width, diagnostics);
      roles.push(role);
      lines += block.lines.length;
      const paragraphChunks = lineChunks(block, {
          x: quote ? QUOTE_INDENT : 0,
          width,
          align: style.align,
          topGap: index === 0 ? 0 : gap,
          decorate: quote ? (x, y, hgt) => rect(x, y, QUOTE_BAR, hgt, { background: style.accent }, role) : undefined,
          part: role,
        });
      // A title is a heading: a mark the table of contents finds, and an anchor its link goes to.
      const level = HEADING_LEVEL[role];
      if (level !== undefined) paragraphChunks.forEach((c, i) => (paragraphChunks[i] = { ...c, keepWithNext: true }));
      const first = paragraphChunks[0];
      if (level !== undefined && first) {
        const id = headingId(component.id, index);
        paragraphChunks[0] = {
          ...first,
          marks: [{ id, kind: "heading", level, text: inlineText(inline) }],
          html: (x, y) => h("span", { id: anchorId(id), style: absStyle(x, y, 0, 0) }, "") + first.html(x, y),
        };
      }
      chunks.push(...paragraphChunks);
    });

    const needed = sumHeights(chunks);
    return { needed, natural: needed, chunks, splittable: true, diagnostics, facts: { paragraphs: roles.length, lines, roles } };
  },

  semantic(component) {
    const defaultRole = component.props?.role ?? "body";
    return component.content.paragraphs
      .map((paragraph) => {
        const role = typeof paragraph === "string" ? defaultRole : (paragraph.role ?? defaultRole);
        const body = inlineHtml(typeof paragraph === "string" ? paragraph : paragraph.text);
        const tag = role === "title-1" ? "h1" : role === "title-2" ? "h2" : role === "title-3" ? "h3" : role === "quote" ? "blockquote" : "p";
        return h(tag, {}, body);
      })
      .join("");
  },

  describe(component) {
    const first = component.content.paragraphs[0];
    const role = typeof first === "string" || !first ? (component.props?.role ?? "body") : (first.role ?? component.props?.role ?? "body");
    const text = first === undefined ? "" : typeof first === "string" ? first : first.text;
    const more = component.content.paragraphs.length > 1 ? ` (+${component.content.paragraphs.length - 1} ¶)` : "";
    return `${role}: "${excerpt(text)}"${more}`;
  },
};
