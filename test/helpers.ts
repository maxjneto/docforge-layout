import { readFileSync } from "node:fs";
import { createEngine } from "../src/engine";
import { createNodeRegistry } from "../src/node";

export const registry = createNodeRegistry();
export const engine = createEngine({ registry });

export function example(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));
}

/** A position in units (A4 with 48px margins: 87 units wide, 128 rows tall). */
export const at = (x: number, y: number, w: number, h?: number, page = 1) => ({ page, x, y, w, ...(h !== undefined ? { h } : {}) });

/** A minimal valid version 2 document; pass components (with `at`). */
export function doc(parts: { components: unknown[]; styles?: unknown; surfaces?: unknown[]; grid?: unknown }) {
  return {
    format: "docforge/layout",
    version: 2,
    surfaces: parts.surfaces ?? [{ id: "a4", kind: "page", size: "A4", margin: 48 }],
    ...(parts.grid ? { grid: parts.grid } : {}),
    ...(parts.styles ? { styles: parts.styles } : {}),
    components: parts.components,
  };
}

/** One component alone at the top-left corner. */
export function single(component: Record<string, unknown>, w = 87, h?: number) {
  return doc({ components: [{ ...component, at: at(0, 0, w, h) }] });
}

export const lorem =
  "O documento é medido pela própria biblioteca, que decide onde cada linha quebra e desenha as linhas prontas, sem deixar o navegador quebrar o texto de novo.";
