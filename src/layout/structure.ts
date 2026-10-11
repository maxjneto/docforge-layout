import type { Component } from "../schema/components";
import type { LayoutDocument } from "../schema/document";
import { diag, type Diagnostic } from "../validate/diagnostics";

export interface Structure {
  components: Map<string, Component>;
  /** component id → band id, for components placed exactly once. */
  placedAt: Map<string, string>;
}

/** Ids, placements and region targets. Reports problems; never throws. */
export function checkStructure(doc: LayoutDocument, out: Diagnostic[]): Structure {
  const components = new Map<string, Component>();
  for (const c of doc.components) {
    if (components.has(c.id)) out.push(diag("error", "duplicate-id", `Component id "${c.id}" is used twice.`, { component: c.id }));
    components.set(c.id, c);
  }

  const bandIds = new Set<string>();
  const sectionIds = new Set<string>();
  const placedAt = new Map<string, string>();
  for (const section of doc.sections) {
    if (sectionIds.has(section.id)) out.push(diag("error", "duplicate-id", `Section id "${section.id}" is used twice.`, { section: section.id }));
    sectionIds.add(section.id);
    for (const band of section.bands) {
      if (bandIds.has(band.id)) out.push(diag("error", "duplicate-id", `Band id "${band.id}" is used twice.`, { band: band.id }));
      bandIds.add(band.id);
      for (const item of band.items) {
        if (!components.has(item.component)) {
          out.push(
            diag("error", "unknown-component", `Band "${band.id}" places "${item.component}", which is not in components.`, {
              band: band.id,
              component: item.component,
            }),
          );
        } else if (placedAt.has(item.component)) {
          out.push(
            diag("error", "placed-twice", `"${item.component}" is placed in "${placedAt.get(item.component)}" and again in "${band.id}".`, {
              component: item.component,
              band: band.id,
            }),
          );
        } else placedAt.set(item.component, band.id);
      }
    }
  }
  for (const id of components.keys()) {
    if (!placedAt.has(id)) out.push(diag("info", "unplaced-component", `"${id}" is not placed in any band and will not render.`, { component: id }));
  }

  for (const region of doc.styles?.regions ?? []) {
    const section = doc.sections.find((s) => s.id === region.section);
    if (!section) {
      out.push(diag("warning", "unknown-region-target", `Region "${region.id}" targets section "${region.section}", which does not exist.`));
      continue;
    }
    for (const b of region.bands ?? []) {
      if (!section.bands.some((band) => band.id === b)) {
        out.push(diag("warning", "unknown-region-target", `Region "${region.id}" targets band "${b}", which is not in section "${section.id}".`));
      }
    }
  }

  return { components, placedAt };
}
