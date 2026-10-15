import type { FontRegistry } from "../fonts/registry";
import type { LayoutResult } from "../layout/types";
import { colorValue } from "../style/tokens";
import { h, safeSrc, text } from "./h";

/**
 * One page as SVG, drawn from the same HTML the library renders — so there is one
 * renderer to keep right, and no browser is needed to turn a page into an image
 * (an agent that can see gets a PNG through resvg).
 *
 * That HTML is a small, closed subset built by `h()`: absolutely positioned divs
 * (backgrounds, borders, radii), measured text lines (`div.dfl-line` with styled
 * spans), links, chart SVGs and images. The semantic layer (`.dfl-sr`) is skipped.
 * Text keeps the library's line breaks and positions: each fragment is placed at
 * the x the library measured, on a baseline computed from the font's metrics the
 * way a browser lays out a line box.
 */

interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: (Node | string)[];
  /** Raw markup of the element (kept for SVG subtrees, copied as they are). */
  raw?: string;
}

const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "col"]);

const NAMED: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'" };

/** Undo `esc()` (numeric entities) and the few named ones a browser would also accept. */
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

/** Parse the renderer's markup (well formed by construction: everything comes from `h()`). */
function parse(html: string): Node {
  const root: Node = { tag: "#root", attrs: {}, children: [] };
  const stack: { node: Node; start: number }[] = [{ node: root, start: 0 }];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [all, closing, tag, attrText, selfClosing, chars] = m;
    const top = stack[stack.length - 1] as { node: Node; start: number };
    if (chars !== undefined) {
      top.node.children.push(decode(chars));
      continue;
    }
    const name = (tag as string).toLowerCase();
    if (closing) {
      // Close up to the matching tag.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]?.node.tag === name) {
          const closed = stack[i] as { node: Node; start: number };
          if (name === "svg") closed.node.raw = html.slice(closed.start, m.index + all.length);
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (attrText ?? "").matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) attrs[a[1] as string] = decode(a[2] ?? "");
    const node: Node = { tag: name, attrs, children: [] };
    top.node.children.push(node);
    if (!selfClosing && !VOID.has(name)) stack.push({ node, start: m.index });
  }
  return root;
}

function styleOf(node: Node): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of (node.attrs.style ?? "").split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

const num = (v: string | undefined) => (v ? Number.parseFloat(v) || 0 : 0);
const n2 = (v: number) => String(Math.round(v * 100) / 100);
/** "'DFL Inter', sans-serif" → "Inter": the renderer namespaces its families; fonts carry the real names. */
const familyOf = (css: string | undefined) => (css ?? "").split(",")[0]?.trim().replace(/^['"]|['"]$/g, "").replace(/^DFL /, "") ?? "";

function textOf(node: Node | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

interface Ctx {
  registry: FontRegistry;
  out: string[];
}

function drawBox(node: Node, x: number, y: number, s: Record<string, string>, ctx: Ctx): void {
  const w = num(s.width);
  const hgt = num(s.height);
  const bg = s.background && s.background !== "transparent" ? s.background : null;
  const border = s.border ? /^([\d.]+)px solid (.+)$/.exec(s.border) : null;
  const radius = num(s["border-radius"]);
  if (!bg && !border) return;
  const bw = border ? num(border[1]) : 0;
  ctx.out.push(
    h("rect", {
      x: n2(x + bw / 2),
      y: n2(y + bw / 2),
      width: n2(Math.max(0, w - bw)),
      height: n2(Math.max(0, hgt - bw)),
      rx: radius ? n2(radius) : null,
      fill: bg ?? "none",
      stroke: border ? (border[2] as string) : null,
      "stroke-width": border ? n2(bw) : null,
    }),
  );
  void node;
}

const snap = (v: number) => v;

/**
 * Text written straight into a positioned div (a step's number): one fragment in the
 * div's own font, aligned in its width, on the same browser-like baseline.
 */
function drawPlainText(node: Node, x: number, y: number, s: Record<string, string>, ctx: Ctx): void {
  const content = node.children.filter((c): c is string => typeof c === "string").join("").trim();
  if (!content) return;
  const face = ctx.registry.match(familyOf(s["font-family"]), Number(s["font-weight"] ?? 400), s["font-style"] === "italic");
  const size = num(s["font-size"]) || 16;
  const width = num(s.width);
  const lineHeight = num(s["line-height"]) || num(s.height);
  const measured = ctx.registry.measure(face, size, content);
  const align = s["text-align"] ?? "left";
  const a = (face.ascent / face.unitsPerEm) * size;
  const d = (-face.descent / face.unitsPerEm) * size;
  const tx = x + (align === "center" ? (width - measured) / 2 : align === "right" ? width - measured : 0);
  ctx.out.push(
    h(
      "text",
      { x: n2(tx), y: n2(snap(y + lineHeight / 2 + (a - d) / 2)), "font-family": face.family, "font-size": n2(size), "font-weight": face.weight, fill: s.color ?? "#000", "xml:space": "preserve" },
      text(content),
    ),
  );
}

/** A measured line: fragments at the x the library measured, on a browser-like baseline. */
function drawLine(node: Node, x: number, y: number, s: Record<string, string>, ctx: Ctx): void {
  const width = num(s.width);
  const lineHeight = num(s.height) || num(s["line-height"]);
  const measured = num(node.attrs["data-w"]);
  const align = s["text-align"] ?? "left";
  let cx = x + (align === "center" ? (width - measured) / 2 : align === "right" ? width - measured : 0);

  const spans = node.children.filter((c): c is Node => typeof c !== "string" && c.tag === "span");
  const frags = spans.map((span) => {
    const st = styleOf(span);
    const family = familyOf(st["font-family"]);
    const size = num(st["font-size"]);
    const weight = Number(st["font-weight"] ?? 400);
    const italic = st["font-style"] === "italic";
    const face = ctx.registry.match(family, weight, italic);
    const content = textOf(span);
    return { st, family: face.family, size, weight, italic, face, content, width: ctx.registry.measure(face, size, content) };
  });
  // A browser centers each inline box's content area in the line height, aligns baselines
  // and draws the baseline on a whole pixel.
  const baseline = snap(
    y +
    Math.max(
      0,
      ...frags.map((f) => {
        const a = (f.face.ascent / f.face.unitsPerEm) * f.size;
        const d = (-f.face.descent / f.face.unitsPerEm) * f.size;
        return lineHeight / 2 + (a - d) / 2;
      }),
    ),
  );

  for (const f of frags) {
    const bg = f.st.background && f.st.background !== "transparent" ? f.st.background : null;
    if (bg) {
      const a = (f.face.ascent / f.face.unitsPerEm) * f.size;
      const d = (-f.face.descent / f.face.unitsPerEm) * f.size;
      ctx.out.push(h("rect", { x: n2(cx), y: n2(baseline - a), width: n2(f.width), height: n2(a + d), fill: bg }));
    }
    if (f.content.trim()) {
      ctx.out.push(
        h(
          "text",
          {
            x: n2(cx),
            y: n2(baseline),
            "font-family": f.family,
            "font-size": n2(f.size),
            "font-weight": f.weight,
            "font-style": f.italic ? "italic" : null,
            fill: f.st.color ?? "#000",
            "xml:space": "preserve",
          },
          text(f.content),
        ),
      );
    }
    if (f.st["text-decoration"] === "underline") {
      const thickness = Math.max(1, f.size / 14);
      ctx.out.push(h("rect", { x: n2(cx), y: n2(baseline + f.size * 0.12), width: n2(f.width), height: n2(thickness), fill: f.st.color ?? "#000" }));
    }
    cx += f.width;
  }
}

function walk(node: Node, ox: number, oy: number, ctx: Ctx): void {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const cls = child.attrs.class ?? "";
    if (cls.split(" ").includes("dfl-sr") || cls.includes("dfl-box-link") || child.attrs["data-overlay"] !== undefined) continue;
    const s = styleOf(child);
    const positioned = s.position === "absolute";
    const x = ox + (positioned ? num(s.left) : 0);
    const y = oy + (positioned ? num(s.top) : 0);
    if (child.tag === "svg" && child.raw) {
      // Chart markup was built by h() already: only its CSS position and the family namespace change.
      const inner = child.raw.replace(/\sstyle="[^"]*"/, "").replace(/font-family="DFL /g, 'font-family="');
      ctx.out.push(h("g", { transform: `translate(${n2(x)} ${n2(y)})` }, inner));
      continue;
    }
    if (child.tag === "img") {
      const src = safeSrc(child.attrs.src ?? "");
      const fit = s["object-fit"] === "cover" ? "xMidYMid slice" : "xMidYMid meet";
      if (src) ctx.out.push(h("image", { x: n2(x), y: n2(y), width: n2(num(s.width)), height: n2(num(s.height)), href: src, preserveAspectRatio: fit }));
      continue;
    }
    if (cls.split(" ").includes("dfl-line")) {
      drawLine(child, x, y, s, ctx);
      continue;
    }
    if (child.tag === "div") {
      drawBox(child, x, y, s, ctx);
      drawPlainText(child, x, y, s, ctx);
    }
    // Children of a bordered box are positioned inside the border (box-sizing: border-box).
    const border = s.border ? /^([\d.]+)px/.exec(s.border) : null;
    const inset = border ? num(border[1]) : 0;
    walk(child, x + inset, y + inset, ctx);
  }
}

/**
 * Page `page` (1-based) of a layout result as a standalone SVG document. `highlight`
 * outlines components (every piece on this page), so an agent can ask to see one.
 */
export function renderPageSvg(result: LayoutResult, registry: FontRegistry, page: number, highlight: string[] = []): string {
  const p = result.pages[page - 1];
  if (!p) throw new Error(`page ${page} does not exist (the document has ${result.pages.length})`);
  const paper = colorValue("$color.surface", result.tokens, "#ffffff");
  const ctx: Ctx = { registry, out: [] };
  walk(parse(p.boxes.map((b) => b.html).join("")), 0, 0, ctx);
  const unit = result.grid.unit;
  for (const id of highlight) {
    for (const piece of result.components[id]?.pieces ?? []) {
      if (piece.page !== page) continue;
      ctx.out.push(
        h("rect", {
          x: n2(p.content.x + piece.x * unit - 3),
          y: n2(p.content.y + piece.y * unit - 3),
          width: n2(piece.w * unit + 6),
          height: n2(piece.h * unit + 6),
          rx: "3",
          fill: "none",
          stroke: "#ff4d00",
          "stroke-width": "2",
          "stroke-dasharray": "6 4",
        }),
      );
    }
  }
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", width: n2(p.width), height: n2(p.height), viewBox: `0 0 ${n2(p.width)} ${n2(p.height)}` },
    h("rect", { width: "100%", height: "100%", fill: paper }),
    ...ctx.out,
  );
}
