import { absStyle, h, renderTextBlock, safeHref, text } from "../render/html";
import type { TextBlock } from "../text/layout";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { layoutInline } from "./shared";
import type { ComponentOf } from "../schema/components";
import type { Chunk, ComponentDef, OutlineEntry } from "./types";

const INDENT = 16;
const LEADER_MIN = 16;

/** "Contents" in the document's language. */
function contentsWord(locale: string): string {
  const lang = locale.slice(0, 2).toLowerCase();
  return lang === "pt" ? "Sumário" : lang === "es" ? "Índice" : lang === "de" ? "Inhalt" : lang === "fr" ? "Sommaire" : "Contents";
}

/** The titles a table of contents lists: the levels asked for, from its `from` page on. */
function tocEntries(component: ComponentOf<"toc">, outline: OutlineEntry[]) {
  const levels: string[] = component.props?.levels ?? ["title-1", "title-2"];
  const from = component.props?.from ?? (component.at ? component.at.page + 1 : 1);
  return { levels, from, entries: outline.filter((e) => levels.includes(e.role) && e.page >= from) };
}

/**
 * A table of contents in one pass: the titles are known before anything is placed, so its
 * height is fixed; the page numbers come from where each title lands and are filled in
 * once every box is placed. Each entry links to its title. Splits between entries.
 */
export const tocComponent: ComponentDef<"toc"> = {
  type: "toc",
  sizing: "content",
  decorated: true,
  variants: ["title", "entry-1", "entry-2", "entry-3", "page"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const { levels, from, entries } = tocEntries(component, ctx.outline);
    const showPages = component.props?.pages !== false;
    const leaders = component.props?.leaders !== false && showPages;
    const pageStyle = ctx.style("page");
    const top = Math.min(...entries.map((e) => e.level), 3);

    const titleText = component.content?.title ?? contentsWord(ctx.locale);
    const titleBlock = titleText ? layoutInline(titleText, ctx.style("title"), ctx, ctx.width, diagnostics) : null;
    const numberW = showPages ? layoutInline("999", pageStyle, ctx, Number.MAX_SAFE_INTEGER, diagnostics).width : 0;

    const chunks: Chunk[] = [];
    if (titleBlock) chunks.push({ height: titleBlock.height, html: (x, y) => renderTextBlock(titleBlock, { x, y, width: ctx.width, align: "left", part: "title" }) });
    if (!entries.length) {
      diagnostics.push(
        diag("info", "toc-empty", `No ${levels.join(" or ")} titles from page ${from} on: the table of contents is empty.`, {
          suggestions: ["Give section titles the title-1 or title-2 role, or change props.levels / props.from."],
        }),
      );
    }
    entries.forEach((entry, index) => {
      const part = `entry-${Math.min(3, Math.max(1, entry.level))}`;
      const entryStyle = ctx.style(part);
      const indent = (entry.level - top) * INDENT;
      const room = Math.max(1, ctx.width - indent - (showPages ? numberW + LEADER_MIN : 0));
      const block: TextBlock = layoutInline(entry.text, entryStyle, ctx, room, diagnostics);
      const space = index === 0 && !titleBlock ? 0 : entryStyle.gap;
      const href = safeHref(`#${entry.id}`);
      chunks.push({
        height: block.height + space,
        html: (x, y) => {
          const y0 = y + space;
          let html = renderTextBlock(block, { x: x + indent, y: y0, width: room, align: "left", part });
          const page = ctx.late.pages.get(entry.id);
          const last = block.lines[block.lines.length - 1];
          const lastTop = y0 + block.height - (last?.height ?? 0);
          if (showPages && page !== undefined) {
            const number = layoutInline(String(page), pageStyle, ctx, Number.MAX_SAFE_INTEGER, []);
            html += renderTextBlock(number, { x: x + ctx.width - numberW, y: lastTop, width: numberW, align: "right", part: "page" });
            if (leaders && last) {
              const start = x + indent + last.width + 4;
              const end = x + ctx.width - number.width - 4;
              const baseline = lastTop + last.height * 0.78;
              if (end - start > 4) html += h("div", { "data-part": "leader", style: absStyle(start, baseline, end - start, 0, { borderBottom: `1px dotted ${pageStyle.muted}` }) }, "");
            }
          }
          // The pointer and the PDF follow this layer; the accessible link is in the semantic list.
          if (href) html += h("a", { class: "dfl-box-link", href, tabindex: -1, "aria-hidden": "true", style: absStyle(x, y0, ctx.width, block.height) }, "");
          return html;
        },
      });
    });
    const needed = chunks.reduce((s, c) => s + c.height, 0);
    return { needed, natural: needed, chunks, splittable: true, diagnostics, facts: { entries: entries.length, levels, from } };
  },

  semantic(component, { locale, late, outline }) {
    const title = component.content?.title ?? contentsWord(locale);
    const { entries } = tocEntries(component, outline ?? []);
    const items = entries.map((e) => {
      const href = safeHref(`#${e.id}`);
      const page = late?.pages.get(e.id);
      const label = `${e.text}${component.props?.pages !== false && page !== undefined ? `, ${page}` : ""}`;
      return h("li", {}, href ? h("a", { href }, text(label)) : text(label));
    });
    return h("nav", { "aria-label": title }, h("p", {}, text(title)), entries.length ? h("ol", {}, ...items) : "");
  },

  describe(component) {
    const levels = component.props?.levels ?? ["title-1", "title-2"];
    return `toc (${levels.join(", ")})${component.props?.from ? ` from page ${component.props.from}` : ""}`;
  },
};
