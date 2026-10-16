import { rowsOf } from "../layout/rows";
import type { ComponentGeometry, LayoutResult } from "../layout/types";
import type { LayoutDocument } from "../schema/document";

/**
 * A second pair of eyes on composition: what the layout engine accepts but a reader
 * would notice. Diagnostics say whether things fit; this says whether they look
 * right. Each finding comes with the ops that would fix it, to preview or apply.
 */

export type ReviewCode = "empty-space" | "uneven-row" | "uneven-top" | "off-guide" | "page-balance" | "title-count";

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
