import { inlineHtml } from "../render/semantic";
import { h, renderTextBlock, text } from "../render/html";
import type { Diagnostic } from "../validate/diagnostics";
import { excerpt, layoutInline, rect, sumHeights } from "./shared";
import type { Chunk, ComponentDef } from "./types";

const COLUMN_GAP = 12;
const DOT = 10;
const RAIL = 16;
const TITLE_TEXT_GAP = 2;

export const timelineComponent: ComponentDef<"timeline"> = {
  type: "timeline",
  sizing: "content",
  decorated: true,
  variants: ["date", "title"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const style = ctx.style();
    const dateStyle = ctx.style("date");
    const titleStyle = ctx.style("title");
    const events = component.content.events;

    const dateFace = ctx.registry.match(dateStyle.fontFamily, dateStyle.fontWeight, dateStyle.italic);
    const widestDate = Math.max(...events.map((e) => ctx.registry.measure(dateFace, dateStyle.fontSize, e.date)));
    const dateWidth = Math.ceil(Math.min(widestDate, ctx.width * 0.35));
    const railX = dateWidth + COLUMN_GAP;
    const x = railX + RAIL + COLUMN_GAP;
    const width = ctx.width - x;

    const chunks: Chunk[] = events.map((event, index) => {
      const date = layoutInline(event.date, dateStyle, ctx, dateWidth, diagnostics);
      const title = layoutInline(event.title, titleStyle, ctx, width, diagnostics);
      const body = event.text !== undefined ? layoutInline(event.text, style, ctx, width, diagnostics) : null;
      const bodyHeight = title.height + (body ? TITLE_TEXT_GAP + body.height : 0);
      const gap = index === 0 ? 0 : style.gap;
      const height = gap + Math.max(date.height, bodyHeight);
      const firstLine = title.lines[0]?.height ?? DOT;
      const last = index === events.length - 1;
      return {
        height,
        html: (cx, cy) => {
          const top = cy + gap;
          const mid = cx + railX + RAIL / 2;
          const dotTop = top + (firstLine - DOT) / 2;
          let html = "";
          if (index > 0) html += rect(mid - 1, cy, 2, gap + dotTop - top, { background: style.borderColor });
          if (!last) html += rect(mid - 1, dotTop + DOT, 2, cy + height - dotTop - DOT, { background: style.borderColor });
          html += rect(mid - DOT / 2, dotTop, DOT, DOT, { background: style.accent, borderRadius: "50%" });
          html += renderTextBlock(date, { x: cx, y: top + Math.max(0, (firstLine - (date.lines[0]?.height ?? 0)) / 2), width: dateWidth, align: "right" });
          html += renderTextBlock(title, { x: cx + x, y: top, width, align: titleStyle.align });
          if (body) html += renderTextBlock(body, { x: cx + x, y: top + title.height + TITLE_TEXT_GAP, width, align: style.align });
          return html;
        },
      };
    });

    const needed = sumHeights(chunks);
    return { needed, natural: needed, chunks, splittable: true, diagnostics, facts: { events: events.length } };
  },

  semantic(component) {
    return h(
      "ol",
      {},
      ...component.content.events.map((event) =>
        h(
          "li",
          {},
          `${h("time", {}, text(event.date))} ${h("strong", {}, text(event.title))}${event.text !== undefined ? ` ${inlineHtml(event.text)}` : ""}`,
        ),
      ),
    );
  },

  describe(component) {
    const first = component.content.events[0];
    return `timeline, ${component.content.events.length} events from ${first?.date ?? "?"}: "${excerpt(first?.title ?? "", 28)}"`;
  },
};
