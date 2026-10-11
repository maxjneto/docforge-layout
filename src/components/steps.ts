import { cssFamilyValue } from "../fonts/registry";
import { absStyle, h, px, renderTextBlock, text } from "../render/html";
import { inlineHtml } from "../render/semantic";
import type { Diagnostic } from "../validate/diagnostics";
import { excerpt, layoutInline, rect, sumHeights } from "./shared";
import type { Chunk, ComponentDef } from "./types";

const BADGE_GAP = 12;
const TITLE_TEXT_GAP = 2;

export const stepsComponent: ComponentDef<"steps"> = {
  type: "steps",
  sizing: "content",
  decorated: true,
  variants: ["title"],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const style = ctx.style();
    const titleStyle = ctx.style("title");
    const badge = Math.round(style.fontSize * 1.7);
    const x = badge + BADGE_GAP;
    const width = ctx.width - x;
    const steps = component.content.steps;
    const badgeFace = ctx.registry.match(titleStyle.fontFamily, 600, false);

    const chunks: Chunk[] = steps.map((step, index) => {
      const title = layoutInline(step.title, titleStyle, ctx, width, diagnostics);
      const body = step.text !== undefined ? layoutInline(step.text, style, ctx, width, diagnostics) : null;
      const bodyHeight = title.height + (body ? TITLE_TEXT_GAP + body.height : 0);
      const gap = index === 0 ? 0 : style.gap;
      const height = gap + Math.max(badge, bodyHeight);
      const last = index === steps.length - 1;
      return {
        height,
        html: (cx, cy) => {
          const top = cy + gap;
          const mid = cx + badge / 2;
          let html = "";
          if (index > 0) html += rect(mid - 1, cy, 2, gap, { background: style.borderColor });
          if (!last) html += rect(mid - 1, top + badge, 2, height - gap - badge, { background: style.borderColor });
          html += rect(cx, top, badge, badge, { background: style.accent, borderRadius: "50%" });
          html += h(
            "div",
            {
              style: absStyle(cx, top, badge, badge, {
                lineHeight: px(badge),
                textAlign: "center",
                color: "#ffffff",
                fontFamily: cssFamilyValue(badgeFace.family),
                fontWeight: String(badgeFace.weight),
                fontSize: Math.round(style.fontSize * 0.85),
              }),
            },
            text(String(index + 1)),
          );
          html += renderTextBlock(title, { x: cx + x, y: top, width, align: titleStyle.align });
          if (body) html += renderTextBlock(body, { x: cx + x, y: top + title.height + TITLE_TEXT_GAP, width, align: style.align });
          return html;
        },
      };
    });

    const needed = sumHeights(chunks);
    return { needed, natural: needed, chunks, splittable: true, diagnostics, facts: { steps: steps.length } };
  },

  semantic(component) {
    return h(
      "ol",
      {},
      ...component.content.steps.map((step) =>
        h("li", {}, h("strong", {}, text(step.title)) + (step.text !== undefined ? ` ${inlineHtml(step.text)}` : "")),
      ),
    );
  },

  describe(component) {
    const first = component.content.steps[0];
    return `${component.content.steps.length} steps: "${excerpt(first?.title ?? "", 32)}"…`;
  },
};
