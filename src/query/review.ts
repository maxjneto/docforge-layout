import { rowsOf } from "../layout/rows";
import type { ComponentGeometry, LayoutResult } from "../layout/types";
import type { LayoutDocument } from "../schema/document";
import { contrast, mix, parseColor, toHex, type Rgb } from "../style/color";

/**
 * A second pair of eyes on composition: what the layout engine accepts but a reader
 * would notice. Diagnostics say whether things fit; this says whether they look
 * right. Each finding comes with the ops that would fix it, to preview or apply.
 */

export type ReviewCode =
  | "empty-space"
  | "uneven-row"
  | "uneven-top"
  | "off-guide"
  | "page-balance"
  | "title-count"
  | "unbalanced-page"
  | "low-contrast"
  | "double-numbering";

export interface ReviewFinding {
  code: ReviewCode;
  severity: "warning" | "info";
  /** Components the finding is about, left to right. */
  components: string[];
  page?: number;
  message: string;
  /** Ops that fix it (try them with preview first). Empty when the fix is a choice. */
  fixes: unknown[];
  /** Plain words for the fix, for a person: "Fit to the text", "Same height". */
  fixLabel?: string;
  data: Record<string, unknown>;
}

export interface ReviewResult {
  findings: ReviewFinding[];
  text: string;
}

/** Rows a component needs for its content, in units. */
function neededRows(g: ComponentGeometry, unit: number): number {
  return Math.max(1, Math.ceil(g.needed / unit));
}

const CONTENT_TYPES = new Set(["text", "list", "table", "code", "steps", "timeline", "card"]);

export function reviewLayout(layout: LayoutResult): ReviewResult {
  const findings: ReviewFinding[] = [];
  const doc = layout.doc as LayoutDocument | null;
  if (!doc) return { findings, text: "The document is invalid; nothing to review." };
  const unit = layout.grid.unit;
  const geo = layout.components;
  // A deck: every slide stands alone, so a short last slide or a title per slide is normal.
  const slides = layout.surface?.kind === "page" && layout.surface.size === "Slide";

  // 1. Boxes much taller than their content (a minimum height set for another reason).
  for (const g of Object.values(geo)) {
    if (!CONTENT_TYPES.has(g.type) || g.declared.h === undefined || g.pieces.length > 1) continue;
    const need = neededRows(g, unit);
    const empty = g.box.h - need;
    if (empty >= 4 && empty / g.box.h >= 0.35) {
      findings.push({
        code: "empty-space",
        severity: "warning",
        components: [g.id],
        page: g.box.page,
        message: `"${g.id}" is ${g.box.h} rows tall but its content needs ${need} (${Math.round((empty / g.box.h) * 100)}% empty).`,
        fixes: [{ op: "place", component: g.id, at: { h: null } }],
        fixLabel: "fit-content",
        data: { height: g.box.h, needed: need },
      });
    }
  }

  // 2. Rows: tops that almost line up, heights that almost match.
  for (const row of rowsOf(layout)) {
    if (row.ids.length < 2) continue;
    const boxes = row.ids.map((id) => geo[id] as ComponentGeometry);
    const tops = boxes.map((g) => g.box.y);
    const minTop = Math.min(...tops);
    const offTop = boxes.filter((g) => g.box.y !== minTop && g.box.y - minTop <= 3);
    if (offTop.length) {
      findings.push({
        code: "uneven-top",
        severity: "warning",
        components: row.ids,
        page: row.page,
        message: `${offTop.map((g) => `"${g.id}"`).join(", ")} start${offTop.length === 1 ? "s" : ""} ${offTop.map((g) => g.box.y - minTop).join("/")} row(s) below the rest of the row.`,
        fixes: offTop.map((g) => ({ op: "place", component: g.id, at: { y: g.declared.y - (g.box.y - minTop) } })),
        fixLabel: "align-tops",
        data: { tops },
      });
    }
    const heights = boxes.map((g) => g.box.h);
    const tallest = Math.max(...heights);
    // Only boxes of the same kind are expected to match (a text beside a chart is case 1).
    const sameKind = boxes.every((g) => g.type === (boxes[0] as ComponentGeometry).type) || boxes.every((g) => CONTENT_TYPES.has(g.type) === CONTENT_TYPES.has((boxes[0] as ComponentGeometry).type));
    const shorter = boxes.filter((g) => g.box.h < tallest && tallest - g.box.h <= Math.max(2, Math.round(tallest * 0.3)));
    if (sameKind && shorter.length && !offTop.length) {
      findings.push({
        code: "uneven-row",
        severity: "warning",
        components: row.ids,
        page: row.page,
        message: `Side-by-side boxes have different heights (${heights.join(" / ")} rows); the row looks ragged.`,
        fixes: shorter.map((g) => ({ op: "place", component: g.id, at: { h: tallest } })),
        fixLabel: "same-height",
        data: { heights },
      });
    }
  }

  // 3. Edges one or two units away from a guide.
  for (const g of Object.values(geo)) {
    if (g.clamped) continue;
    const { x, w } = g.declared;
    const starts = layout.guides.map((gd) => gd.x);
    const ends = layout.guides.map((gd) => gd.x + gd.w);
    const near = (v: number, list: number[]) => list.find((t) => t !== v && Math.abs(t - v) <= 2);
    const onStart = starts.includes(x);
    const onEnd = ends.includes(x + w);
    const startTo = onStart ? undefined : near(x, starts);
    const endTo = onEnd ? undefined : near(x + w, ends);
    if (startTo === undefined && endTo === undefined) continue;
    const first = layout.guides.find((gd) => gd.x === (startTo ?? x));
    const last = layout.guides.find((gd) => gd.x + gd.w === (endTo ?? x + w));
    if (!first || !last || last.col < first.col) continue;
    findings.push({
      code: "off-guide",
      severity: "info",
      components: [g.id],
      page: g.box.page,
      message: `"${g.id}" ${startTo !== undefined ? `starts at x${x}, ${Math.abs(startTo - x)} from guide ${first.col}` : `ends at x${x + w}, ${Math.abs((endTo as number) - (x + w))} from the end of guide ${last.col}`}.`,
      fixes: [{ op: "place", component: g.id, at: { cols: [first.col, last.col] } }],
      fixLabel: "snap-guides",
      data: { cols: [first.col, last.col] },
    });
  }

  // 4. A last page that is mostly empty.
  const pages = layout.pages;
  if (pages.length > 1 && !slides) {
    const lastIndex = pages.length;
    const lastPage = pages[lastIndex - 1];
    if (lastPage && Number.isFinite(lastPage.rows)) {
      let lowest = 0;
      for (const g of Object.values(geo)) for (const p of g.pieces) if (p.page === lastIndex) lowest = Math.max(lowest, p.y + p.h);
      const used = lowest / lastPage.rows;
      if (used < 0.3) {
        findings.push({
          code: "page-balance",
          severity: "info",
          components: [],
          page: lastIndex,
          message: `Page ${lastIndex} uses ${Math.round(used * 100)}% of its height; the document might fit in ${lastIndex - 1} page${lastIndex - 1 === 1 ? "" : "s"}.`,
          fixes: [{ op: "fit", pages: lastIndex - 1 }],
          fixLabel: "fit-pages",
          data: { used, pages: lastIndex },
        });
      }
    }
  }

  // 5. More than one main title.
  const titles = doc.components.filter(
    (c) =>
      c.type === "text" &&
      (((c as { props?: { role?: string } }).props?.role === "title-1") ||
        ((c as { content?: { paragraphs?: unknown[] } }).content?.paragraphs ?? []).some((p) => typeof p === "object" && p !== null && (p as { role?: string }).role === "title-1")),
  );
  if (titles.length > 1 && !slides) {
    findings.push({
      code: "title-count",
      severity: "info",
      components: titles.map((c) => c.id),
      message: `${titles.length} components use title-1 (${titles.map((c) => `"${c.id}"`).join(", ")}); a document usually has one, with title-2 for sections.`,
      fixes: [],
      data: { count: titles.length },
    });
  }

  // 6. Content bunched at the top: a slide, or a document already at its page limit (a
  // one-pager), whose lower part is empty. A short note without a limit is just short.
  const maxPages = layout.surface?.kind === "page" ? layout.surface.maxPages : undefined;
  const atLimit = maxPages !== undefined && pages.length === maxPages;
  pages.forEach((page, i) => {
    const index = i + 1;
    if (!(slides || atLimit) || !Number.isFinite(page.rows) || page.rows <= 0) return;
    const pieces = Object.values(geo).flatMap((g) => g.pieces.filter((p) => p.page === index).map((p) => ({ id: g.id, ...p })));
    if (!pieces.length) return;
    const lowest = Math.max(...pieces.map((p) => p.y + p.h));
    const top = Math.min(...pieces.map((p) => p.y));
    const below = page.rows - lowest;
    const used = lowest / page.rows;
    if (below < page.rows * 0.4 || below <= 2 * top + 4) return;
    const offset = Math.floor((below - top) / 2);
    const ids = [...new Set(pieces.map((p) => p.id))];
    findings.push({
      code: "unbalanced-page",
      severity: "warning",
      components: ids,
      page: index,
      message: `${slides ? "Slide" : "Page"} ${index} uses the top ${Math.round(used * 100)}% of its height; the rest is empty. Give the content more room (larger type, a visual, more space between blocks) or center it.`,
      fixes: slides ? ids.map((id) => ({ op: "place", component: id, at: { y: ((geo[id] as ComponentGeometry).declared.y ?? 0) + offset } })) : [],
      fixLabel: slides ? "center-vertically" : undefined,
      data: { used, rows: page.rows, lowest },
    });
  });

  // 7. Text that is hard to read on its background (WCAG: 4.5:1, 3:1 for large text).
  const surface = parseColor(layout.tokens.color.surface);
  const subtle = parseColor(layout.tokens.color.subtle);
  const textColor = parseColor(layout.tokens.color.text);
  for (const g of Object.values(geo)) {
    const fg = parseColor(g.style.color.value);
    const bg = parseColor(g.style.background.value) ?? surface;
    if (!fg || !bg) continue;
    const large = g.style.fontSize.value >= 18 || (g.style.fontSize.value >= 14 && g.style.fontWeight.value >= 700);
    const needed = large ? 3 : 4.5;
    const ratio = contrast(fg, bg);
    const component = doc.components.find((c) => c.id === g.id) as { content?: unknown } | undefined;
    // Inline `code` is drawn on $color.subtle inside any text.
    const inlineCode = g.type !== "code" && subtle && /`[^`]+`/.test(JSON.stringify(component?.content ?? ""));
    const codeRatio = inlineCode && subtle ? contrast(fg, subtle) : Infinity;
    if (ratio >= needed && codeRatio >= 4.5) continue;
    const onSubtle = (ratio < needed && g.style.background.written === "$color.subtle") || codeRatio < 4.5;
    const best = ([textColor, [255, 255, 255], [17, 17, 17]].filter(Boolean) as Rgb[]).sort((x, y) => contrast(y, bg) - contrast(x, bg))[0] as Rgb;
    findings.push({
      code: "low-contrast",
      severity: "warning",
      components: [g.id],
      page: g.box.page,
      message: ratio < needed
        ? `"${g.id}": text on its background has contrast ${ratio.toFixed(1)}:1 (needs ${needed}:1); it is hard to read.`
        : `"${g.id}": inline code has contrast ${codeRatio.toFixed(1)}:1 on $color.subtle (needs 4.5:1).`,
      fixes: onSubtle && surface && textColor
        ? [{ op: "setTokens", tokens: { color: { subtle: mix(surface, textColor, 0.1) } } }]
        : [{ op: "update", component: g.id, style: { color: toHex(best) } }],
      fixLabel: "contrast",
      data: { ratio: Math.round(ratio * 10) / 10, needed, ...(Number.isFinite(codeRatio) ? { inlineCode: Math.round(codeRatio * 10) / 10 } : {}) },
    });
  }

  // 8. Numbers typed into items that are already numbered ("1  1. Get a key").
  const NUMBERED = /^\s*\d+\s*[.)\-–:]\s+/;
  for (const c of doc.components as { id: string; type: string; content?: { steps?: { title: string }[]; items?: unknown[] }; props?: { marker?: string } }[]) {
    const paths: [string, string][] = [];
    if (c.type === "steps") (c.content?.steps ?? []).forEach((st, i) => NUMBERED.test(st.title) && paths.push([`steps.${i}.title`, st.title]));
    if (c.type === "list" && c.props?.marker === "number") {
      (c.content?.items ?? []).forEach((it, i) => {
        const text = typeof it === "string" ? it : (it as { text?: string }).text ?? "";
        if (NUMBERED.test(text)) paths.push([typeof it === "string" ? `items.${i}` : `items.${i}.text`, text]);
      });
    }
    if (!paths.length) continue;
    findings.push({
      code: "double-numbering",
      severity: "warning",
      components: [c.id],
      page: geo[c.id]?.box.page,
      message: `"${c.id}" numbers its items already, and ${paths.length} of them start with a number too (${JSON.stringify(paths[0]?.[1])}); readers see it twice.`,
      fixes: [{ op: "edit", component: c.id, set: Object.fromEntries(paths.map(([path, text]) => [path, text.replace(NUMBERED, "")])) }],
      fixLabel: "drop-numbers",
      data: { items: paths.length },
    });
  }

  return { findings, text: reviewText(findings) };
}

function reviewText(findings: ReviewFinding[]): string {
  if (!findings.length) return "No composition problems found.";
  const lines = [`${findings.length} finding${findings.length === 1 ? "" : "s"}`];
  for (const f of findings) {
    lines.push("", `${f.severity === "warning" ? "~" : "·"} ${f.code}${f.components.length ? `  ${f.components.join(" · ")}` : ""}${f.page ? ` · p${f.page}` : ""}`, `  ${f.message}`);
    for (const fix of f.fixes) lines.push(`  fix ${JSON.stringify(fix)}`);
  }
  return lines.join("\n");
}
