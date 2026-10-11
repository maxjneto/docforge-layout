import type { ListItemInput } from "../schema/components";
import { inlineHtml } from "../render/semantic";
import type { Inline } from "../schema/content";
import { cssFamilyValue } from "../fonts/registry";
import { absStyle, h, px, text } from "../render/html";
import type { Diagnostic } from "../validate/diagnostics";
import { excerpt, layoutInline, lineChunks, rect, sumHeights } from "./shared";
import type { Chunk, ComponentDef } from "./types";

const MARKER_GAP = 8;

interface FlatItem {
  text: Inline;
  checked: boolean;
  depth: number;
  ordinal: number;
}

function flatten(items: ListItemInput[], depth: number, out: FlatItem[]): void {
  items.forEach((item, index) => {
    const node = typeof item === "string" ? { text: item } : item;
    out.push({ text: node.text, checked: !!node.checked, depth, ordinal: index + 1 });
    if (node.items?.length) flatten(node.items, depth + 1, out);
  });
}

function roman(n: number): string {
  const table: [number, string][] = [
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let rest = n;
  for (const [value, symbol] of table) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

function letter(n: number): string {
  let out = "";
  let rest = n;
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

/** Markers change with depth, as in print: 1. → a. → i. and • → – → •. */
export function markerLabel(marker: "bullet" | "number", depth: number, ordinal: number): string {
  if (marker === "number") {
    const level = depth % 3;
    return level === 0 ? `${ordinal}.` : level === 1 ? `${letter(ordinal)}.` : `${roman(ordinal)}.`;
  }
  return depth % 2 === 1 ? "–" : "•";
}

export const listComponent: ComponentDef<"list"> = {
  type: "list",
  sizing: "content",
  decorated: true,
  variants: [],

  layout(component, ctx) {
    const diagnostics: Diagnostic[] = [];
    const style = ctx.style();
    const marker = component.props?.marker ?? "bullet";
    const items: FlatItem[] = [];
    flatten(component.content.items, 0, items);

    const face = ctx.registry.match(style.fontFamily, style.fontWeight, style.italic);
    const measure = (t: string) => ctx.registry.measure(face, style.fontSize, t);
    const labelOf = (item: FlatItem) => (marker === "check" ? "" : markerLabel(marker, item.depth, item.ordinal));
    const maxDepth = Math.max(...items.map((i) => i.depth));
    // Marker column width per depth: wide enough for the widest marker at that depth.
    const columns: number[] = [];
    for (let d = 0; d <= maxDepth; d++) {
      const atDepth = items.filter((i) => i.depth === d);
      const widest = marker === "check" ? style.fontSize * 0.9 : Math.max(...atDepth.map((i) => measure(labelOf(i))));
      columns.push(Math.ceil(widest));
    }
    const indentOf = (depth: number) => {
      let x = 0;
      for (let d = 0; d < depth; d++) x += (columns[d] ?? 0) + MARKER_GAP;
      return x;
    };

    const chunks: Chunk[] = [];
    items.forEach((item, index) => {
      const col = columns[item.depth] ?? 0;
      const x = indentOf(item.depth) + col + MARKER_GAP;
      const width = ctx.width - x;
      const block = layoutInline(item.text, style, ctx, width, diagnostics);
      const lines = lineChunks(block, { x, width, align: "left", topGap: index === 0 ? 0 : style.gap });
      const first = lines[0];
      const firstLine = block.lines[0];
      if (first && firstLine) {
        const gap = index === 0 ? 0 : style.gap;
        const markerX = indentOf(item.depth);
        const lineHeight = firstLine.height;
        const drawLine = first.html;
        first.html = (cx, cy) => {
          let markerHtml: string;
          if (marker === "check") {
            const box = style.fontSize * 0.9;
            const top = cy + gap + (lineHeight - box) / 2;
            markerHtml = rect(cx + markerX, top, box, box, {
              border: `1.5px solid ${style.muted}`,
              borderRadius: 2,
              background: item.checked ? style.accent : null,
              boxSizing: "border-box",
            });
            if (item.checked) {
              markerHtml += h(
                "div",
                {
                  style: absStyle(cx + markerX, top, box, box, {
                    color: "#ffffff",
                    fontSize: box * 0.8,
                    lineHeight: px(box),
                    textAlign: "center",
                    fontFamily: cssFamilyValue(face.family),
                  }),
                },
                text("✓"),
              );
            }
          } else {
            markerHtml = h(
              "div",
              {
                style: absStyle(cx + markerX, cy + gap, col, lineHeight, {
                  lineHeight: px(lineHeight),
                  whiteSpace: "pre",
                  textAlign: marker === "number" ? "right" : "center",
                  fontFamily: cssFamilyValue(face.family),
                  fontSize: style.fontSize,
                  fontWeight: String(face.weight),
                  fontStyle: face.style,
                  color: marker === "bullet" ? style.accent : style.color,
                }),
              },
              text(labelOf(item)),
            );
          }
          return markerHtml + drawLine(cx, cy);
        };
      }
      chunks.push(...lines);
    });

    const needed = sumHeights(chunks);
    return { needed, natural: needed, chunks, splittable: true, diagnostics, facts: { items: items.length, marker } };
  },

  semantic(component) {
    const tag = component.props?.marker === "number" ? "ol" : "ul";
    const check = component.props?.marker === "check";
    const render = (items: ListItemInput[]): string =>
      h(
        tag,
        {},
        ...items.map((item) => {
          const node = typeof item === "string" ? { text: item } : item;
          const mark = check ? text(node.checked ? "☑ " : "☐ ") : "";
          return h("li", {}, mark + inlineHtml(node.text) + (node.items?.length ? render(node.items) : ""));
        }),
      );
    return render(component.content.items);
  },

  describe(component) {
    const first = component.content.items[0];
    const label = first === undefined ? "" : typeof first === "string" ? first : first.text;
    return `${component.props?.marker ?? "bullet"} list, ${component.content.items.length} items: "${excerpt(label, 32)}"…`;
  },
};
