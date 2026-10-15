import type { Component } from "../schema/components";
import type { LayoutDocument } from "../schema/document";
import { diag, type Diagnostic } from "../validate/diagnostics";

export interface Structure {
  components: Map<string, Component>;
  /** Components with a position, in document order. */
  placed: Component[];
}

/** Ids and placements. Reports problems; never throws. */
export function checkStructure(doc: LayoutDocument, out: Diagnostic[]): Structure {
  const components = new Map<string, Component>();
  const placed: Component[] = [];
  for (const c of doc.components) {
    if (components.has(c.id)) {
      out.push(diag("error", "duplicate-id", `Component id "${c.id}" is used twice.`, { component: c.id }));
      continue;
    }
    components.set(c.id, c);
    if (c.at) placed.push(c);
    else out.push(diag("info", "unplaced-component", `"${c.id}" has no position (at) and will not render.`, { component: c.id }));
  }
  return { components, placed };
}
