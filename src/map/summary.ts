import type { Change } from "../layout/changes";
import type { ComponentGeometry, LayoutResult, UnitBox } from "../layout/types";
import type { Diagnostic } from "../validate/diagnostics";

/**
 * What a write did, in a few lines: what the ops changed, what moved on its own,
 * problems, and how full the pages are. The full map stays available, but an agent
 * that just moved one box does not need every page redrawn to know what happened.
 */

/** Two columns, the first padded: "  id      what". */
function pairs(rows: string[][]): string[] {
  const width = Math.max(0, ...rows.map((r) => (r[0] ?? "").length));
  return rows.map(([a = "", b = ""]) => `  ${a.padEnd(width)}  ${b}`.trimEnd());
}

const boxText = (b: UnitBox) => `p${b.page} x${b.x} y${b.y} w${b.w} h${b.h}`;

function boxDelta(before: UnitBox, after: UnitBox): string {
  const keys = ["page", "x", "y", "w", "h"] as const;
  const changed = keys.filter((k) => before[k] !== after[k]);
  if (!changed.length) return `same box ${boxText(after)}`;
  const label = (k: (typeof keys)[number], b: UnitBox) => (k === "page" ? `p${b.page}` : `${k}${b[k]}`);
  return `${boxText(before)} → ${changed.map((k) => label(k, after)).join(" ")}`;
}

function pieces(g: ComponentGeometry): string {
  return g.pieces.length > 1 ? ` (split: ${g.pieces.map((p) => `p${p.page}`).join("+")})` : "";
}

function changeText(c: Change): [string, string] {
  const id = c.component ?? "document";
  const data = c.data as { before?: UnitBox; after?: UnitBox; pushedBy?: string; pieces?: UnitBox[] };
  const cause = data.pushedBy ? ` (pushed by ${data.pushedBy})` : "";
  switch (c.code) {
    case "moved": {
      const dy = (data.after?.y ?? 0) - (data.before?.y ?? 0);
      const how = dy > 0 ? `↓${dy}` : dy < 0 ? `↑${-dy} (back toward its place)` : "sideways";
      return [id, `${how}${dy >= 0 ? cause : ""}`];
    }
    case "moved-page":
      return [id, `p${data.before?.page} → p${data.after?.page}${cause || " (page break)"}`];
    case "resized":
      return [id, `now ${String(c.data.after)} rows tall (was ${String(c.data.before)})`];
    case "split":
      return [id, `splits across ${(data.pieces ?? []).map((p) => `p${p.page}`).join("+")}`];
    case "joined":
      return [id, "fits on one page again"];
    default:
      return [id, c.message];
  }
}

function freeRows(result: LayoutResult, pageIndex: number): number | null {
  const page = result.pages[pageIndex];
  if (!page || !Number.isFinite(page.rows)) return null;
  let lowest = 0;
  for (const g of Object.values(result.components)) {
    for (const p of g.pieces) if (p.page === pageIndex + 1) lowest = Math.max(lowest, p.y + p.h);
  }
  return Math.max(0, page.rows - lowest);
}

export interface SummaryInput {
  before: LayoutResult;
  after: LayoutResult;
  touched: ReadonlySet<string>;
  changes: Change[];
  diagnostics: Diagnostic[];
}

export function summarizeApply({ before, after, touched, changes, diagnostics }: SummaryInput): string {
  const lines: string[] = [];

  const mine: string[][] = [];
  for (const id of touched) {
    const a = after.components[id];
    const b = before.components[id];
    if (a && b) mine.push([id, boxDelta(b.box, a.box) + pieces(a)]);
    else if (a) mine.push([id, `added at ${boxText(a.box)}${pieces(a)}`]);
    else mine.push([id, "not placed (no position)"]);
  }
  for (const id of Object.keys(before.components)) {
    if (!after.components[id] && !after.doc?.components.some((c) => c.id === id)) mine.push([id, "removed"]);
  }
  if (mine.length) lines.push("you changed", ...pairs(mine));

  const side = changes.filter((c) => c.component).map(changeText);
  if (side.length) lines.push("it moved on its own", ...pairs(side));
  for (const change of changes.filter((c) => !c.component)) lines.push(`document: ${change.message}`);

  const problems = diagnostics.filter((d) => d.severity !== "info");
  const notes = diagnostics.filter((d) => d.severity === "info");
  if (problems.length) {
    lines.push(`problems (${problems.length})`);
    for (const d of problems.slice(0, 8)) lines.push(`  ${d.severity === "error" ? "!" : "~"} ${d.code}${d.component ? ` (${d.component})` : ""}: ${d.message}`);
    if (problems.length > 8) lines.push(`  +${problems.length - 8} more (get the full map for all)`);
  } else {
    lines.push("problems: none");
  }
  for (const d of notes) lines.push(`note: ${d.message}`);

  const count = after.pages.length;
  const was = before.pages.length !== count ? ` (was ${before.pages.length})` : "";
  const touchedPages = new Set<number>();
  for (const id of [...touched, ...changes.map((c) => c.component).filter((x): x is string => !!x)]) {
    for (const g of [after.components[id], before.components[id]]) g?.pieces.forEach((p) => touchedPages.add(p.page));
  }
  const show = count <= 4 ? after.pages.map((_, i) => i + 1) : [...touchedPages].filter((p) => p <= count).sort((a, b) => a - b);
  const usage = show
    .map((n) => {
      const free = freeRows(after, n - 1);
      return free === null ? `p${n}` : `p${n} ${free} free rows`;
    })
    .join(" · ");
  lines.push(`pages: ${count}${was}${usage ? ` · ${usage}` : ""}`);
  return lines.join("\n");
}
