import { diffLayouts } from "../layout/changes";
import type { LayoutResult } from "../layout/types";
import { table } from "../map/map";
import { applyOps } from "../ops/ops";
import type { LayoutDocument } from "../schema/document";
import { StylePropsSchema, type StyleProps } from "../schema/style";

/** What a style variant applies to: one component, a class, or a selector (`text`, `text.title-1`). */
export type CalibrateTarget = { component: string } | { label: string } | { selector: string };

export interface VariantMeasure {
  /** 0 is the document as it is; then one per variant, in order. */
  index: number;
  style: StyleProps | null;
  ok: boolean;
  error?: string;
  pages: number;
  /** The components the variant restyles, with their size and what the layout did to them. */
  components: { id: string; h: number; needed: number; grew: number; pages: number; facts: Record<string, unknown> }[];
  /** Other components that would move because of the variant. */
  moved: string[];
  /** Warnings and errors on the restyled components. */
  issues: string[];
}

export interface CalibrateResult {
  ok: boolean;
  variants: VariantMeasure[];
  text: string;
}

function affectedIds(doc: LayoutDocument, target: CalibrateTarget): string[] {
  if ("component" in target) return [target.component];
  if ("label" in target) return doc.components.filter((c) => (c.labels ?? []).includes(target.label)).map((c) => c.id);
  const type = target.selector.split(".")[0];
  return doc.components.filter((c) => c.type === type).map((c) => c.id);
}

function opFor(target: CalibrateTarget, style: StyleProps): unknown {
  if ("component" in target) return { op: "update", component: target.component, style };
  if ("label" in target) return { op: "setStyle", layer: "label", label: target.label, style };
  return { op: "setStyle", layer: "document", selector: target.selector, style };
}

const describeStyle = (style: StyleProps | null) =>
  style === null
    ? "current"
    : Object.entries(style)
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(", ");

/**
 * Try style variants without applying any: each one is layered on the document
 * (merged into the component's own style, the class or the selector), laid out,
 * and measured next to the document as it is — height, growth, pages, what else
 * would move, and new problems. For choosing a style before writing it.
 */
export function calibrateStyle(
  doc: LayoutDocument,
  target: CalibrateTarget,
  variants: unknown[],
  layout: (doc: LayoutDocument) => LayoutResult,
): CalibrateResult {
  const base = layout(doc);
  const ids = affectedIds(doc, target);
  if ("component" in target && !doc.components.some((c) => c.id === target.component)) {
    return { ok: false, variants: [], text: `Component "${target.component}" does not exist.` };
  }

  const measure = (index: number, style: StyleProps | null, result: LayoutResult, moved: string[]): VariantMeasure => ({
    index,
    style,
    ok: true,
    pages: result.pages.length,
    components: ids
      .map((id) => result.components[id])
      .filter((g): g is NonNullable<typeof g> => !!g)
      .map((g) => ({ id: g.id, h: g.pieces.reduce((s, p) => s + p.h, 0), needed: g.needed, grew: g.grew, pages: g.pages.length, facts: g.facts })),
    moved,
    issues: result.diagnostics.filter((d) => d.component !== undefined && ids.includes(d.component) && d.severity !== "info").map((d) => `${d.severity === "error" ? "!" : "~"}${d.code}`),
  });

  const rows: VariantMeasure[] = [measure(0, null, base, [])];
  variants.forEach((raw, i) => {
    const parsed = StylePropsSchema.safeParse(raw);
    if (!parsed.success) {
      const error = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(style)"}: ${issue.message}`).join("; ");
      rows.push({ index: i + 1, style: null, ok: false, error, pages: 0, components: [], moved: [], issues: [] });
      return;
    }
    const applied = applyOps(doc, [opFor(target, parsed.data)], { layout });
    const result = layout(applied.doc);
    const moved = [...new Set(diffLayouts(base, result, new Set(ids)).flatMap((c) => (c.component ? [c.component] : [])))];
    rows.push(measure(i + 1, parsed.data, result, moved));
  });

  const what = "component" in target ? `component ${target.component}` : "label" in target ? `class ${target.label} (${ids.length} components)` : `selector ${target.selector} (${ids.length} components)`;
  const single = ids.length === 1;
  const header = single
    ? ["#", "style", "h", "needs", "grew", "pages(doc)", "moves", "issues", "facts"]
    : ["#", "style", "total h", "tallest", "split", "pages(doc)", "moves", "issues"];
  const lines = table(
    header,
    rows.map((r) => {
      if (!r.ok) return [String(r.index), `invalid: ${r.error}`, "", "", "", "", "", ""];
      const moves = r.moved.length ? `${r.moved.length} (${r.moved.slice(0, 3).join(", ")}${r.moved.length > 3 ? "…" : ""})` : "—";
      const issues = [...new Set(r.issues)].join(" ") || "—";
      if (single) {
        const c = r.components[0];
        return [String(r.index), describeStyle(r.style), String(c?.h ?? "—"), c ? `${c.needed}px` : "—", c?.grew ? `+${c.grew}` : "—", String(r.pages), moves, issues, c ? JSON.stringify(c.facts) : ""];
      }
      const total = r.components.reduce((s, c) => s + c.h, 0);
      const tallest = r.components.reduce((m, c) => (c.h > (m?.h ?? -1) ? c : m), r.components[0]);
      const split = r.components.filter((c) => c.pages > 1).length;
      return [String(r.index), describeStyle(r.style), String(total), tallest ? `${tallest.id} ${tallest.h}` : "—", String(split), String(r.pages), moves, issues];
    }),
    "",
  );
  return {
    ok: rows.every((r) => r.ok),
    variants: rows,
    text: [`calibrating ${what} · heights in units of ${base.grid.unit}px · 0 is the document as it is; nothing was applied`, ...lines].join("\n"),
  };
}
