import { defOf } from "../components";
import { absStyle, h } from "../render/html";
import type { Component, MasterComponent } from "../schema/components";
import { defaultPresets } from "../style/presets";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { renderBox } from "./box";
import { measureComponents, type MeasureInput } from "./measure";
import { masterOn } from "./surface";
import type { PageLayout, Prepared } from "./types";

/** The class every master component gets, carrying the `master` preset. */
const MASTER_LABEL = "dfl-master";
const PLACEHOLDER = /\{\{(\w+)\}\}|\{(page|pages|title|date)\}/g;
const BARE_PLACEHOLDER = /(?<!\{)\{(page|pages|title|date)\}(?!\})/;
/** Keys under which strings are not text (a placeholder there means nothing). */
const NOT_TEXT_TREE = new Set(["props", "style", "styles", "src", "href", "link", "role", "kind", "color"]);

type Values = Record<"page" | "pages" | "title" | "date", string>;

/** Placeholders in every text of `value` swapped for `values`; `{{page}}` writes a literal `{page}`. */
function fill(value: unknown, values: Values): unknown {
  if (typeof value === "string") return value.replace(PLACEHOLDER, (_, literal: string | undefined, key: keyof Values | undefined) => (literal !== undefined ? `{${literal}}` : values[key as keyof Values]));
  if (Array.isArray(value)) return value.map((v) => fill(v, values));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, NOT_TEXT_TREE.has(k) ? v : fill(v, values)]));
  return value;
}

function hasPlaceholder(value: unknown): boolean {
  if (typeof value === "string") return /\{\{\w+\}\}|\{(page|pages|title|date)\}/.test(value);
  if (Array.isArray(value)) return value.some(hasPlaceholder);
  if (value && typeof value === "object") return Object.entries(value).some(([k, v]) => !NOT_TEXT_TREE.has(k) && hasPlaceholder(v));
  return false;
}

/** A body component that writes `{page}` & co. in its text: they only mean something in the master. */
export function checkBodyPlaceholders(placed: Component[], out: Diagnostic[]): void {
  for (const c of placed) {
    const found = JSON.stringify((c as { content?: unknown }).content ?? "").match(BARE_PLACEHOLDER);
    if (!found) continue;
    out.push(
      diag("warning", "placeholder-outside-master", `"${c.id}" writes ${found[0]} in its text; placeholders are filled only in a page master, so it shows as written.`, {
        component: c.id,
        suggestions: ["Move the page number or title to the surface's master (setMaster).", `Write {${found[0]}} to keep the braces on purpose.`],
      }),
    );
  }
}

function formatDate(iso: string | undefined, locale: string): string {
  const date = iso ? new Date(`${iso}T12:00:00Z`) : new Date();
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Draw the surface's master on every page it applies to, after the body is placed (the page
 * count is known, so `{pages}` is exact). Its components have fixed boxes measured from the
 * top of the margins; they never move, never split and are cut at their `h`. They go under
 * the body, above a full-bleed background, hidden from assistive technology.
 */
export function drawMaster(input: MeasureInput, pages: PageLayout[], out: Diagnostic[]): void {
  const { doc, frame, locale } = input;
  const surface = frame.surface;
  const master = surface.kind === "page" ? surface.master : undefined;
  if (!master || !master.components.length || !Number.isFinite(frame.rows)) return;
  const unit = frame.grid.unit;
  const applies = (index: number) => masterOn(surface, index);

  const measure = (values: Values | null, sink: Diagnostic[]) => {
    const components = master.components.map((c: MasterComponent) => {
      const content = (c as { content?: unknown }).content;
      return {
        ...c,
        ...(values && content !== undefined ? { content: fill(content, values) } : {}),
        labels: [MASTER_LABEL, ...(c.labels ?? [])],
        at: { page: 1, ...c.at },
      } as Component;
    });
    const masterDoc = { ...doc, styles: { ...doc.styles, labels: { [MASTER_LABEL]: defaultPresets.master ?? {}, ...doc.styles?.labels } }, components };
    const structure = { components: new Map(components.map((c) => [c.id, c] as const)), placed: components, blocks: new Map<string, string>() };
    return measureComponents({ ...input, doc: masterDoc, structure }, sink).prepared;
  };

  const varies = master.components.some((c) => hasPlaceholder((c as { content?: unknown }).content));
  const values = (index: number): Values => ({
    page: String(index + 1),
    pages: String(pages.length),
    title: doc.meta?.title ?? "",
    date: formatDate(doc.meta?.date, locale),
  });
  const fixed = varies ? null : measure(null, out);
  const reported = new Set<string>();

  pages.forEach((page, index) => {
    if (!applies(index)) return;
    const sink: Diagnostic[] = [];
    const prepared: Prepared[] = fixed ?? measure(values(index), sink);
    if (index === pages.findIndex((_, i) => applies(i))) out.push(...sink);
    const boxes = prepared.map((p) => {
      const def = defOf(p.component.type);
      const hgt = (p.declared.h ?? 1) * unit;
      if (def.sizing === "area") {
        p.ctx.height = Math.max(0, hgt - p.inset * 2);
        p.laid = def.layout(p.component as never, p.ctx);
      }
      if (p.laid.needed + p.inset * 2 > hgt + 0.5 && !reported.has(p.component.id)) {
        reported.add(p.component.id);
        out.push(
          diag("warning", "master-overflow", `Master component "${p.component.id}" needs ${Math.ceil(p.laid.needed + p.inset * 2)}px; its h gives ${hgt}px, so it is cut.`, {
            component: p.component.id,
            suggestions: [`Raise its h to ${Math.ceil((p.laid.needed + p.inset * 2) / unit)}.`, "Shorten its text."],
          }),
        );
      }
      for (const d of p.laid.diagnostics) if (!reported.has(`${p.component.id}:${d.code}`)) {
        reported.add(`${p.component.id}:${d.code}`);
        out.push({ ...d, component: d.component ?? p.component.id });
      }
      const x = frame.margin.left + p.x * unit;
      const y = frame.margin.top + p.declared.y * unit;
      const inner = renderBox(p, 0, 0, p.areaWidth, hgt, p.laid.chunks, { piece: 0, decorative: true });
      return {
        component: p.component.id,
        x,
        y,
        width: p.areaWidth,
        height: hgt,
        html: h("div", { class: "dfl-master", "data-master": p.component.id, style: absStyle(x, y, p.areaWidth, hgt, { overflow: "hidden" }) }, inner),
        layer: "master" as const,
      };
    });
    // Under the body, above a full-bleed background.
    const after = page.boxes.filter((b) => b.layer === "bleed").length;
    page.boxes.splice(after, 0, ...boxes);
  });
}
