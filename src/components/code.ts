import { diag, type Diagnostic } from "../validate/diagnostics";
import { h, text } from "../render/html";
import { baseText, lineChunks, sumHeights } from "./shared";
import { layoutText, type StyledRun } from "../text/layout";
import type { Chunk, ComponentDef } from "./types";

/**
 * Code keeps its own line breaks. A source line wider than the box has nowhere to
 * scroll in print, so it wraps and the agent is told which lines did.
 */
export const codeComponent: ComponentDef<"code"> = {
  type: "code",
  sizing: "content",
  decorated: true,
  variants: [],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const style = ctx.style();
    const base = baseText(style);
    const source = component.content.code.replace(/\t/g, "  ").replace(/\r\n?/g, "\n");
    const sourceLines = source.split("\n");
    const wrapped: number[] = [];
    const chunks: Chunk[] = [];

    sourceLines.forEach((line, index) => {
      const run: StyledRun = {
        text: line,
        family: style.fontFamily,
        weight: style.fontWeight,
        italic: style.italic,
        size: style.fontSize,
        color: style.color,
        background: null,
        underline: false,
        href: null,
      };
      const block = layoutText([run], { maxWidth: Math.max(ctx.width, 1), lineHeight: style.lineHeight, base, registry: ctx.registry, preserveLeadingSpace: true });
      if (block.lines.length > 1) wrapped.push(index + 1);
      chunks.push(...lineChunks(block, { width: ctx.width, align: "left" }));
    });

    if (wrapped.length) {
      diagnostics.push(
        diag("warning", "code-line-wrapped", `Line(s) ${wrapped.join(", ")} are wider than ${Math.round(ctx.width)}px and wrap.`, {
          data: { lines: wrapped },
          suggestions: ["Widen the component (colSpan), lower the font size, or break the lines in the source."],
        }),
      );
    }

    const needed = sumHeights(chunks);
    return { needed, natural: needed, chunks, splittable: true, diagnostics, facts: { lines: sourceLines.length, wrapped } };
  },

  semantic(component) {
    const { code, language } = component.content;
    return h("pre", {}, h("code", { "data-language": language ?? null }, text(code)));
  },

  describe(component) {
    const lines = component.content.code.split("\n").length;
    return `code${component.content.language ? ` (${component.content.language})` : ""}, ${lines} lines`;
  },
};
