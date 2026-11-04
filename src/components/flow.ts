import type { TextRole } from "../schema/content";
import type { Component, FlowBlock } from "../schema/components";
import { anchorId, h } from "../render/html";
import { absStyle } from "../render/h";
import type { Diagnostic } from "../validate/diagnostics";
// A cycle (the registry lists flow), safe because defOf is only called while laying out.
import { defOf } from "./index";
import { excerpt, sumHeights } from "./shared";
import { HEADING_LEVEL } from "./text";
import type { Chunk, ComponentContext, ComponentDef } from "./types";

type Paragraph = { role: TextRole; text: string };
/** A block ready to lay out: a component of its own type, with the index of the block it came from. */
type Item = { index: number; component: Component; h?: number } | { index: number; break: true };

const PREFIXES: [string, TextRole][] = [
  ["### ", "title-3"],
  ["## ", "title-2"],
  ["# ", "title-1"],
  ["> ", "quote"],
];

/** A string block as a paragraph: `# ` / `## ` / `### ` / `> ` give its role. */
export function paragraphOf(block: string): Paragraph {
  for (const [prefix, role] of PREFIXES) if (block.startsWith(prefix)) return { role, text: block.slice(prefix.length) };
  return { role: "body", text: block };
}

/**
 * The blocks as components: strings in a row become one text (paragraph spacing between
 * them), objects become a component of their type, breaks stay breaks.
 */
export function flowItems(flowId: string, blocks: FlowBlock[]): Item[] {
  const items: Item[] = [];
  let run: { index: number; paragraphs: Paragraph[] } | null = null;
  const endRun = () => {
    if (run) items.push({ index: run.index, component: { id: blockIdOf(flowId, run.index), type: "text", content: { paragraphs: run.paragraphs } } as Component });
    run = null;
  };
  blocks.forEach((block, index) => {
    if (typeof block === "string") {
      const paragraph = paragraphOf(block);
      // A title starts a new block, so the space above a section is the flow's, not a paragraph's.
      if (run && HEADING_LEVEL[paragraph.role] !== undefined) endRun();
      run ??= { index, paragraphs: [] };
      run.paragraphs.push(paragraph);
      return;
    }
    endRun();
    if (block.type === "break") {
      items.push({ index, break: true });
      return;
    }
    const { h: rows, ...rest } = block as typeof block & { h?: number };
    items.push({ index, component: { ...rest, id: rest.id ?? blockIdOf(flowId, index) } as Component, ...(rows !== undefined ? { h: rows } : {}) });
  });
  endRun();
  return items;
}

const shifted = (chunk: Chunk, dx: number, dy = 0): Chunk => ({
  ...chunk,
  html: (x, y) => chunk.html(x + dx, y + dy),
  ...(chunk.repeat ? { repeat: shifted(chunk.repeat, dx) } : {}),
});

/** Space above a block, kept inside its first chunk so a page never starts with a lone gap chunk. */
const withTopGap = (chunk: Chunk, gap: number): Chunk => ({ ...chunk, height: chunk.height + gap, html: (x, y) => chunk.html(x, y + gap) });

/** Id given to a block that has none (only used for anchors and marks, never written). */
const blockIdOf = (flowId: string, index: number) => `${flowId}--b${index}`;
const isBlockId = (id: string, flowId: string) => !(id.startsWith(`${flowId}--b`) && /^\d+$/.test(id.slice(flowId.length + 3)));

export const flowComponent: ComponentDef<"flow"> = {
  type: "flow",
  sizing: "content",
  decorated: true,
  variants: [],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const chunks: Chunk[] = [];
    const gap = ctx.style().gap;
    const kinds: Record<string, number> = {};
    const headings: { text: string; role: TextRole; block: number }[] = [];
    let pendingBreak = false;

    for (const item of flowItems(component.id, component.content.blocks)) {
      if ("break" in item) {
        pendingBreak = chunks.length > 0;
        continue;
      }
      const block = item.component;
      const def = defOf(block.type);
      kinds[block.type] = (kinds[block.type] ?? 0) + 1;
      if (block.type === "text") {
        for (const p of block.content.paragraphs) {
          if (typeof p !== "string" && (p.role === "title-1" || p.role === "title-2" || p.role === "title-3")) {
            headings.push({ text: excerpt(p.text, 80), role: p.role, block: item.index });
          }
        }
      }

      const styleOf = ctx.styleFor(block.type, { style: block.style, styles: block.styles });
      const own = styleOf();
      const pad = def.decorated ? own.padding + own.borderWidth : 0;
      const sub: ComponentContext = { ...ctx, style: styleOf, width: Math.max(1, ctx.width - pad * 2), height: null, inset: ctx.inset + pad };
      let laid = def.layout(block as never, sub);
      if (def.sizing === "area") {
        sub.height = item.h !== undefined ? Math.max(1, item.h * ctx.unit - pad * 2) : laid.natural;
        laid = def.layout(block as never, sub);
      }
      const label = `Block ${item.index + 1} (${block.type})`;
      for (const d of laid.diagnostics) diagnostics.push({ ...d, message: `${label}: ${d.message}`, data: { ...d.data, block: item.index } });

      const marksOf = (list: Chunk[]) => {
        const marks = list.flatMap((c) => c.marks ?? []);
        return marks.length ? { marks } : {};
      };
      let blockChunks: Chunk[] =
        def.sizing === "area"
          ? [{ height: sub.height as number, html: (x: number, y: number) => laid.chunks.map((c) => c.html(x, y)).join(""), ...marksOf(laid.chunks) }]
          : laid.chunks;
      const box = def.decorated && (own.background || own.borderWidth > 0);
      if (box || def.sizing === "area" || !laid.splittable) {
        // A block with a visible box (code, card, KPI…) stays whole, drawn with its decoration.
        const inner = blockChunks;
        const height = sumHeights(inner) + pad * 2;
        blockChunks = [
          {
            height,
            ...marksOf(inner),
            html: (x, y) => {
              let html = box
                ? h("div", {
                    style: absStyle(x, y, ctx.width, height, {
                      background: own.background,
                      border: own.borderWidth ? `${own.borderWidth}px solid ${own.borderColor}` : null,
                      borderRadius: own.radius || null,
                      boxSizing: "border-box",
                    }),
                  })
                : "";
              let cy = y + pad;
              for (const c of inner) {
                html += c.html(x + pad, cy);
                cy += c.height;
              }
              return html;
            },
          },
        ];
      } else if (pad > 0) {
        blockChunks = blockChunks.map((c, i) => shifted(c, pad, i === 0 ? pad : 0));
        const first = blockChunks[0] as Chunk;
        blockChunks[0] = { ...first, height: first.height + pad };
        const last = blockChunks[blockChunks.length - 1] as Chunk;
        blockChunks[blockChunks.length - 1] = { ...last, height: last.height + pad };
      }
      if (!blockChunks.length) continue;

      let first = blockChunks[0] as Chunk;
      // A block that opens with a title gets twice the space above it: it starts a section.
      const firstParagraph = block.type === "text" ? block.content.paragraphs[0] : undefined;
      const opensSection = firstParagraph !== undefined && typeof firstParagraph !== "string" && HEADING_LEVEL[firstParagraph.role ?? "body"] !== undefined;
      if (chunks.length && !pendingBreak) first = withTopGap(first, opensSection ? gap * 2 : gap);
      if (pendingBreak) first = { ...first, breakBefore: true };
      const anchor = isBlockId(block.id, component.id) ? block.id : undefined;
      if (anchor) {
        const drawn = first;
        first = { ...first, html: (x, y) => h("span", { id: anchorId(anchor), style: absStyle(x, y, 0, 0) }, "") + drawn.html(x, y) };
      }
      blockChunks[0] = first;
      chunks.push(...blockChunks);
      pendingBreak = false;
    }

    const needed = sumHeights(chunks);
    return {
      needed,
      natural: needed,
      chunks,
      splittable: true,
      diagnostics,
      facts: { blocks: component.content.blocks.length, kinds, headings: headings.length },
    };
  },

  semantic(component, options) {
    return flowItems(component.id, component.content.blocks)
      .map((item) => {
        if ("break" in item) return "";
        const def = defOf(item.component.type);
        const body = def.semantic ? def.semantic(item.component as never, options) : "";
        const id = item.component.id;
        return isBlockId(id, component.id) && body ? h("div", { id: `${anchorId(id)}-sr` }, body) : body;
      })
      .join("");
  },

  describe(component) {
    const items = flowItems(component.id, component.content.blocks);
    const counts: Record<string, number> = {};
    for (const item of items) if (!("break" in item)) counts[item.component.type] = (counts[item.component.type] ?? 0) + 1;
    const parts = Object.entries(counts).map(([t, n]) => `${n} ${t}`);
    const first = component.content.blocks.find((b) => typeof b === "string") as string | undefined;
    return `flow ${component.content.blocks.length} blocks (${parts.join(", ")})${first ? `: "${excerpt(paragraphOf(first).text)}"` : ""}`;
  },
};

/** Block ids inside every flow of a document, for duplicate checks and link targets. */
export function flowBlockIds(component: Component): string[] {
  if (component.type !== "flow") return [];
  return component.content.blocks.flatMap((b) => (typeof b !== "string" && b.type !== "break" && b.id ? [b.id] : []));
}
