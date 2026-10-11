import type { Inline } from "../schema/content";
import { inlineToRuns } from "../text/inline";
import { h, safeHref, text } from "./h";

/**
 * Inline content as real markup for the semantic layer: what screen readers read
 * and what gives the printed PDF its structure. Unsafe links become plain text.
 */
export function inlineHtml(inline: Inline): string {
  return inlineToRuns(inline)
    .map((run) => {
      let html = text(run.text);
      if (run.code) html = h("code", {}, html);
      if (run.italic) html = h("em", {}, html);
      if (run.bold) html = h("strong", {}, html);
      if (run.highlight) html = h("mark", {}, html);
      const href = run.link ? safeHref(run.link) : null;
      if (href) html = h("a", { href }, html);
      return html;
    })
    .join("");
}

/** Visually hidden but read by assistive technology; not selectable, so copying text takes the visible layer. */
export const SR_ONLY_CSS =
  ".dfl-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0;user-select:none}";
