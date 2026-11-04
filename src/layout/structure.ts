import { flowBlockIds } from "../components/flow";
import type { Component } from "../schema/components";
import type { LayoutDocument } from "../schema/document";
import { diag, type Diagnostic } from "../validate/diagnostics";

export interface Structure {
  components: Map<string, Component>;
  /** Components with a position, in document order. */
  placed: Component[];
  /** Ids of blocks inside flows (link targets), with the flow that holds each. */
  blocks: Map<string, string>;
}

/** Ids and placements. Reports problems; never throws. */
export function checkStructure(doc: LayoutDocument, out: Diagnostic[]): Structure {
  const components = new Map<string, Component>();
  const placed: Component[] = [];
  const blocks = new Map<string, string>();
  for (const c of doc.components) {
    if (components.has(c.id)) {
      out.push(diag("error", "duplicate-id", `Component id "${c.id}" is used twice.`, { component: c.id }));
      continue;
    }
    components.set(c.id, c);
    for (const id of flowBlockIds(c)) {
      if (blocks.has(id)) out.push(diag("error", "duplicate-id", `Block id "${id}" in "${c.id}" is already used by a block.`, { component: c.id }));
      else blocks.set(id, c.id);
    }
    if (c.at) placed.push(c);
    else out.push(diag("info", "unplaced-component", `"${c.id}" has no position (at) and will not render.`, { component: c.id }));
  }
  for (const id of blocks.keys()) {
    if (components.has(id)) out.push(diag("error", "duplicate-id", `Block id "${id}" in "${blocks.get(id)}" is also a component id.`, { component: blocks.get(id) }));
  }
  return { components, placed, blocks };
}
