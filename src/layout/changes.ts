import type { LayoutResult, UnitBox } from "./types";

export type ChangeCode = "moved" | "moved-page" | "resized" | "split" | "joined" | "page-count" | "page-limit";

/**
 * Something the layout did on its own between two versions of a document: a box
 * that was pushed, went to another page, grew, split… Components the caller changed
 * on purpose are left out; these are the side effects worth telling someone about.
 */
export interface Change {
  code: ChangeCode;
  severity: "info" | "warning";
  component?: string;
  message: string;
  data: Record<string, unknown>;
  /** True when the change undoes an earlier side effect (a box back toward its place, a split that closed, back under the page limit). */
  recovery: boolean;
}

const at = (b: UnitBox) => `p${b.page} x${b.x} y${b.y}`;

/** Side effects of going from `before` to `after`, ignoring the components in `touched`. */
export function diffLayouts(before: LayoutResult, after: LayoutResult, touched: ReadonlySet<string> = new Set()): Change[] {
  const changes: Change[] = [];
  for (const [id, a] of Object.entries(after.components)) {
    const b = before.components[id];
    if (!b || touched.has(id)) continue;
    const cause = a.pushedBy ? ` (pushed by ${a.pushedBy})` : a.shifted > 0 ? " (page break)" : "";
    const data = { before: b.box, after: a.box, ...(a.pushedBy ? { pushedBy: a.pushedBy } : {}) };
    if (a.box.page !== b.box.page) {
      changes.push({
        code: "moved-page",
        severity: "warning",
        component: id,
        message: `"${id}" moved from ${at(b.box)} to ${at(a.box)}${cause}.`,
        data,
        recovery: a.shifted < b.shifted,
      });
    } else if (a.box.y !== b.box.y || a.box.x !== b.box.x || a.box.w !== b.box.w) {
      const dy = a.box.y - b.box.y;
      const how = dy > 0 ? `down ${dy}` : dy < 0 ? `up ${-dy}` : "sideways";
      changes.push({
        code: "moved",
        severity: "info",
        component: id,
        message: `"${id}" moved ${how}: ${at(b.box)} w${b.box.w} → ${at(a.box)} w${a.box.w}${dy < 0 ? " (back toward its declared place)" : cause}.`,
        data,
        recovery: a.shifted < b.shifted,
      });
    }
    if (a.box.h !== b.box.h && a.pieces.length === b.pieces.length) {
      changes.push({
        code: "resized",
        severity: "info",
        component: id,
        message: `"${id}" is now ${a.box.h} rows tall (was ${b.box.h}).`,
        data: { before: b.box.h, after: a.box.h },
        recovery: a.grew < b.grew,
      });
    }
    if (a.pieces.length > b.pieces.length) {
      changes.push({
        code: "split",
        severity: "warning",
        component: id,
        message: `"${id}" now splits across ${a.pieces.length} pages (${a.pieces.map((p) => `p${p.page}`).join(", ")}).`,
        data: { pieces: a.pieces },
        recovery: false,
      });
    } else if (a.pieces.length < b.pieces.length) {
      changes.push({
        code: "joined",
        severity: "info",
        component: id,
        message: `"${id}" ${a.pieces.length === 1 ? "fits on one page again" : `now takes ${a.pieces.length} pieces`}.`,
        data: { pieces: a.pieces },
        recovery: true,
      });
    }
  }

  if (before.pages.length !== after.pages.length && before.ok && after.ok) {
    changes.push({
      code: "page-count",
      severity: after.pages.length > before.pages.length ? "warning" : "info",
      message: `The document went from ${before.pages.length} to ${after.pages.length} pages.`,
      data: { before: before.pages.length, after: after.pages.length },
      recovery: after.pages.length < before.pages.length,
    });
  }
  const over = (r: LayoutResult) => r.diagnostics.find((d) => d.code === "page-limit");
  const nowOver = over(after);
  if (nowOver && !over(before)) {
    changes.push({ code: "page-limit", severity: "warning", message: nowOver.message, data: nowOver.data ?? {}, recovery: false });
  } else if (!nowOver && over(before)) {
    changes.push({ code: "page-limit", severity: "info", message: "The document is back within its page limit.", data: {}, recovery: true });
  }
  return changes;
}
