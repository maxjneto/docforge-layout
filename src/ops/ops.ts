import type { Component } from "../schema/components";
import type { Band, LayoutDocument } from "../schema/document";
import type { StyleProps } from "../schema/style";
import type { TokenOverrides } from "../schema/tokens";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { parseOp, type Position } from "./schema";

export type { Op, Position } from "./schema";

export interface OpsResult {
  doc: LayoutDocument;
  /** Problems applying the operations themselves (unknown ids…). Layout diagnostics come from the engine. */
  errors: Diagnostic[];
  /** Components and bands the operations touched. */
  touched: { components: string[]; bands: string[] };
}

function opError(message: string, extra: Partial<Diagnostic> = {}): Diagnostic {
  return diag("error", "invalid-op", message, extra);
}

function findBand(doc: LayoutDocument, id: string) {
  for (const section of doc.sections) {
    const index = section.bands.findIndex((b) => b.id === id);
    if (index !== -1) return { section, band: section.bands[index] as Band, index };
  }
  return null;
}

function unplace(doc: LayoutDocument, componentId: string): void {
  for (const section of doc.sections) {
    for (const band of section.bands) band.items = band.items.filter((i) => i.component !== componentId);
  }
}

function insertAfter<T extends { id: string }>(list: T[], item: T, after: string | undefined | null): boolean {
  if (after === undefined) {
    list.push(item);
    return true;
  }
  if (after === null) {
    list.unshift(item);
    return true;
  }
  const index = list.findIndex((x) => x.id === after);
  if (index === -1) return false;
  list.splice(index + 1, 0, item);
  return true;
}

function placeAt(doc: LayoutDocument, componentId: string, at: Position, errors: Diagnostic[], touched: OpsResult["touched"]): void {
  const section = doc.sections.find((s) => s.id === at.section);
  if (!section) {
    errors.push(opError(`Section "${at.section}" does not exist.`, { section: at.section }));
    return;
  }
  let band = section.bands.find((b) => b.id === at.band);
  if (!band) {
    const elsewhere = findBand(doc, at.band);
    if (elsewhere) {
      errors.push(opError(`Band "${at.band}" is in section "${elsewhere.section.id}", not "${at.section}".`, { band: at.band }));
      return;
    }
    if (!at.newBand) {
      errors.push(opError(`Band "${at.band}" does not exist in "${at.section}". Pass newBand to create it.`, { band: at.band }));
      return;
    }
    band = { id: at.band, span: at.newBand.span ?? "auto", items: [] };
    if (!insertAfter(section.bands, band, at.newBand.after)) {
      errors.push(opError(`Band "${at.newBand.after}" (newBand.after) is not in section "${at.section}".`));
      return;
    }
  }
  unplace(doc, componentId);
  band.items.push({ component: componentId, colStart: at.colStart, colSpan: at.colSpan });
  band.items.sort((a, b) => a.colStart - b.colStart);
  touched.components.push(componentId);
  touched.bands.push(band.id);
}

/**
 * Apply operations to a copy of the document. Pure: the input is never mutated.
 * Each op's shape is checked first (callers send JSON), so a malformed op is an
 * `invalid-op` error, not an exception.
 */
export function applyOps(input: LayoutDocument, ops: readonly unknown[]): OpsResult {
  const doc = structuredClone(input);
  const errors: Diagnostic[] = [];
  const touched: OpsResult["touched"] = { components: [], bands: [] };
  const component = (id: string) => doc.components.find((c) => c.id === id);

  ops.forEach((raw, index) => {
    const parsed = parseOp(raw);
    if (!parsed.ok) {
      const name = (raw as { op?: unknown } | null)?.op;
      errors.push(opError(`op ${index + 1}${typeof name === "string" ? ` (${name})` : ""}: ${parsed.message}`));
      return;
    }
    const op = parsed.op;
    const before = errors.length;
    switch (op.op) {
      case "add": {
        if (component(op.component.id)) {
          errors.push(opError(`Component "${op.component.id}" already exists; use "update" or "place".`, { component: op.component.id }));
          break;
        }
        doc.components.push(structuredClone(op.component));
        placeAt(doc, op.component.id, op.at, errors, touched);
        break;
      }
      case "place": {
        if (!component(op.component)) {
          errors.push(opError(`Component "${op.component}" does not exist.`, { component: op.component }));
          break;
        }
        placeAt(doc, op.component, op.at, errors, touched);
        break;
      }
      case "update": {
        const c = component(op.component) as (Component & { props?: Record<string, unknown>; style?: StyleProps }) | undefined;
        if (!c) {
          errors.push(opError(`Component "${op.component}" does not exist.`, { component: op.component }));
          break;
        }
        if (op.content !== undefined) (c as { content: unknown }).content = structuredClone(op.content);
        if (op.props !== undefined) c.props = { ...(c.props ?? {}), ...op.props };
        if (op.labels !== undefined) c.labels = [...op.labels];
        if (op.style === null) delete c.style;
        else if (op.style !== undefined) c.style = { ...(c.style ?? {}), ...op.style };
        touched.components.push(c.id);
        break;
      }
      case "remove": {
        if (!component(op.component)) {
          errors.push(opError(`Component "${op.component}" does not exist.`, { component: op.component }));
          break;
        }
        doc.components = doc.components.filter((c) => c.id !== op.component);
        unplace(doc, op.component);
        break;
      }
      case "addSection": {
        if (doc.sections.some((s) => s.id === op.section.id)) {
          errors.push(opError(`Section "${op.section.id}" already exists.`, { section: op.section.id }));
          break;
        }
        if (!insertAfter(doc.sections, { ...op.section, bands: [] }, op.after)) errors.push(opError(`Section "${op.after}" (after) does not exist.`));
        break;
      }
      case "addBand": {
        const section = doc.sections.find((s) => s.id === op.section);
        if (!section) errors.push(opError(`Section "${op.section}" does not exist.`, { section: op.section }));
        else if (findBand(doc, op.band.id)) errors.push(opError(`Band "${op.band.id}" already exists.`, { band: op.band.id }));
        else if (!insertAfter(section.bands, { id: op.band.id, span: op.band.span ?? "auto", items: [] }, op.after)) {
          errors.push(opError(`Band "${op.after}" (after) is not in section "${op.section}".`));
        } else touched.bands.push(op.band.id);
        break;
      }
      case "setBand": {
        const found = findBand(doc, op.band);
        if (!found) errors.push(opError(`Band "${op.band}" does not exist.`, { band: op.band }));
        else {
          found.band.span = op.span;
          touched.bands.push(op.band);
          touched.components.push(...found.band.items.map((i) => i.component));
        }
        break;
      }
      case "moveBand": {
        const found = findBand(doc, op.band);
        const target = doc.sections.find((s) => s.id === (op.section ?? found?.section.id));
        if (!found || !target) {
          errors.push(opError(`Band "${op.band}" or its target section does not exist.`, { band: op.band }));
          break;
        }
        found.section.bands.splice(found.index, 1);
        if (!insertAfter(target.bands, found.band, op.after)) {
          found.section.bands.splice(found.index, 0, found.band);
          errors.push(opError(`Band "${op.after}" (after) is not in section "${target.id}".`));
        } else touched.bands.push(op.band);
        break;
      }
      case "removeBand": {
        const found = findBand(doc, op.band);
        if (!found) errors.push(opError(`Band "${op.band}" does not exist.`, { band: op.band }));
        else found.section.bands.splice(found.index, 1);
        break;
      }
      case "setStyle": {
        doc.styles ??= {};
        if (op.layer === "document") {
          doc.styles.document ??= {};
          if (op.style === null) delete doc.styles.document[op.selector];
          else doc.styles.document[op.selector] = { ...(doc.styles.document[op.selector] ?? {}), ...op.style };
        } else {
          doc.styles.labels ??= {};
          if (op.style === null) delete doc.styles.labels[op.label];
          else doc.styles.labels[op.label] = { ...(doc.styles.labels[op.label] ?? {}), ...op.style };
        }
        break;
      }
      case "setRegion": {
        doc.styles ??= {};
        const regions = (doc.styles.regions ??= []);
        const existing = regions.findIndex((r) => r.id === op.region.id);
        if (existing === -1) regions.push(structuredClone(op.region));
        else regions[existing] = structuredClone(op.region);
        break;
      }
      case "removeRegion": {
        if (doc.styles?.regions) doc.styles.regions = doc.styles.regions.filter((r) => r.id !== op.region);
        break;
      }
      case "setTokens": {
        doc.tokens ??= {};
        for (const [group, values] of Object.entries(op.tokens)) {
          const key = group as keyof TokenOverrides;
          doc.tokens[key] = { ...(doc.tokens[key] ?? {}), ...(values as object) } as never;
        }
        break;
      }
    }
    for (let i = before; i < errors.length; i++) {
      const e = errors[i] as Diagnostic;
      e.message = `op ${index + 1} (${op.op}): ${e.message}`;
    }
  });

  return { doc, errors, touched: { components: [...new Set(touched.components)], bands: [...new Set(touched.bands)] } };
}
