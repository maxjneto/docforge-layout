import { diffLayouts, type Change } from "../layout/changes";
import type { LayoutResult } from "../layout/types";
import type { Component } from "../schema/components";
import type { LayoutDocument } from "../schema/document";

/**
 * What changed between two versions of a document, the way a person reviews it:
 * per component, what someone did on purpose (added, removed, moved, resized,
 * rewrote, restyled), then what the layout did on its own as a consequence.
 * `restoreOps` turns any one of those components back, so a review can undo one
 * change and keep the rest.
 */

export type EditKind = "added" | "removed" | "moved" | "resized" | "content" | "style" | "labels" | "props";

export interface ComponentEdit {
  component: string;
  type: string;
  /** Everything that changed on it, in a stable order. */
  kinds: EditKind[];
  /** Where it is now (null when removed). */
  page: number | null;
}

export interface Comparison {
  edits: ComponentEdit[];
  /** Document-wide changes: grid, surfaces, tokens, document styles, meta. */
  document: string[];
  /** What moved, split or grew as a consequence (components nobody touched). */
  effects: Change[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

type Loose = Component & { content?: unknown; props?: unknown; style?: unknown };

export function compareDocuments(before: LayoutDocument, after: LayoutDocument, layout: (d: LayoutDocument) => LayoutResult): Comparison {
  const prev = new Map(before.components.map((c) => [c.id, c as Loose] as const));
  const next = new Map(after.components.map((c) => [c.id, c as Loose] as const));
  const afterLayout = layout(after);
  const edits: ComponentEdit[] = [];

  for (const c of after.components as Loose[]) {
    const old = prev.get(c.id);
    const page = afterLayout.components[c.id]?.box.page ?? c.at?.page ?? null;
    if (!old) {
      edits.push({ component: c.id, type: c.type, kinds: ["added"], page });
      continue;
    }
    const kinds: EditKind[] = [];
    const a = old.at;
    const b = c.at;
    if (!same(a && { page: a.page, x: a.x, y: a.y }, b && { page: b.page, x: b.x, y: b.y })) kinds.push("moved");
    if (!same(a && { w: a.w, h: a.h }, b && { w: b.w, h: b.h })) kinds.push("resized");
    if (!same(old.content, c.content)) kinds.push("content");
    if (!same(old.style, c.style)) kinds.push("style");
    if (!same(old.labels, c.labels)) kinds.push("labels");
    if (!same(old.props, c.props)) kinds.push("props");
    if (kinds.length) edits.push({ component: c.id, type: c.type, kinds, page });
  }
  for (const c of before.components) {
    if (!next.has(c.id)) edits.push({ component: c.id, type: c.type, kinds: ["removed"], page: null });
  }

  const document: string[] = [];
  for (const key of ["grid", "surfaces", "tokens", "meta"] as const) if (!same(before[key], after[key])) document.push(key);
  if (!same(before.styles, after.styles)) document.push("styles");

  const touched = new Set(edits.map((e) => e.component));
  const effects = diffLayouts(layout(before), afterLayout, touched);
  return { edits, document, effects };
}

/** Ops that bring component `id` back to how it was in `before` (empty when nothing to undo). */
export function restoreOps(before: LayoutDocument, after: LayoutDocument, id: string): unknown[] {
  const old = before.components.find((c) => c.id === id) as Loose | undefined;
  const now = after.components.find((c) => c.id === id) as Loose | undefined;
  if (!old && now) return [{ op: "remove", component: id }];
  if (old && !now) {
    const { at, ...component } = old;
    return at ? [{ op: "add", component, at }] : [];
  }
  if (!old || !now) return [];
  const ops: unknown[] = [];
  if (!same(old.content, now.content)) ops.push({ op: "update", component: id, content: old.content });
  if (!same(old.props, now.props)) ops.push({ op: "update", component: id, props: null }, ...(old.props ? [{ op: "update", component: id, props: old.props }] : []));
  if (!same(old.style, now.style)) ops.push({ op: "update", component: id, style: null }, ...(old.style ? [{ op: "update", component: id, style: old.style }] : []));
  if (!same(old.labels, now.labels)) ops.push({ op: "update", component: id, labels: old.labels ?? [] });
  if (!same(old.at, now.at) && old.at) ops.push({ op: "place", component: id, at: { ...old.at, h: old.at.h ?? null } });
  return ops;
}
