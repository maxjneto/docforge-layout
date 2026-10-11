import type { Inline } from "../schema/content";
import type { ResolvedStyle } from "../schema/style";
import { renderTextBlock, rect } from "../render/html";

export { rect };
import { inlineText, inlineToRuns } from "../text/inline";
import { layoutText, styleRuns, type BaseTextStyle, type TextBlock } from "../text/layout";
import { diag, type Diagnostic } from "../validate/diagnostics";
import type { Chunk, ComponentContext } from "./types";

export function baseText(style: ResolvedStyle): BaseTextStyle {
  return {
    family: style.fontFamily,
    weight: style.fontWeight,
    italic: style.italic,
    size: style.fontSize,
    color: style.color,
    lineHeight: style.lineHeight,
  };
}

/** Lay out inline content in `width`, reporting glyph and fit problems into `out`. */
export function layoutInline(
  inline: Inline,
  style: ResolvedStyle,
  ctx: ComponentContext,
  width: number,
  out: Diagnostic[],
): TextBlock {
  const base = baseText(style);
  const runs = styleRuns(inlineToRuns(inline), base, {
    ...ctx.runStyle,
    onUnknownSize: (key) =>
      out.push(
        diag("warning", "unknown-size", `Inline size "${key}" is not in the size scale; using the paragraph size.`, {
          suggestions: [`Use one of: ${Object.keys(ctx.tokens.size).join(", ")}.`],
        }),
      ),
  });
  const block = layoutText(runs, { maxWidth: Math.max(width, 1), lineHeight: style.lineHeight, base, registry: ctx.registry });
  if (block.missingGlyphs.length) {
    out.push(
      diag("warning", "missing-glyphs", `The font has no glyph for ${block.missingGlyphs.map((c) => `"${c}"`).join(", ")}; the browser would substitute another font and measurement may drift.`, {
        data: { characters: block.missingGlyphs },
        suggestions: ["Remove or replace these characters."],
      }),
    );
  }
  if (block.brokenWords > 0) {
    out.push(
      diag("warning", "word-broken", `${block.brokenWords} word(s) are wider than the available ${Math.round(width)}px and were cut mid-word.`, {
        suggestions: ["Widen the component (colSpan) or shorten the long word/URL."],
      }),
    );
  }
  return block;
}

/** One chunk per line, so the text can split across pages between any two lines. */
export function lineChunks(
  block: TextBlock,
  options: { x?: number; width: number; align: "left" | "center" | "right"; topGap?: number; decorate?: (x: number, y: number, h: number) => string },
): Chunk[] {
  return block.lines.map((line, index) => {
    const gap = index === 0 ? (options.topGap ?? 0) : 0;
    return {
      height: line.height + gap,
      html: (x: number, y: number) =>
        (options.decorate ? options.decorate(x, y + gap, line.height) : "") +
        renderTextBlock(block, {
          x: x + (options.x ?? 0),
          y: y + gap,
          width: options.width,
          align: options.align,
          firstLine: index,
          lastLine: index + 1,
        }),
    };
  });
}

/** A single chunk holding several pieces drawn at fixed offsets. */
export function fixedChunk(height: number, draw: (x: number, y: number) => string): Chunk {
  return { height, html: draw };
}

export function sumHeights(chunks: Chunk[]): number {
  return chunks.reduce((s, c) => s + c.height, 0);
}

export function excerpt(inline: Inline | string, max = 48): string {
  const text = (typeof inline === "string" ? inlineText(inline) : inlineText(inline)).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
