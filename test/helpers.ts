import { readFileSync } from "node:fs";
import { createEngine } from "../src/engine";
import { createNodeRegistry } from "../src/node";

export const registry = createNodeRegistry();
export const engine = createEngine({ registry });

export function example(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));
}

/** A minimal valid document with one section; pass bands and components. */
export function doc(parts: {
  bands: { id: string; span: number | "auto"; items: { component: string; colStart: number; colSpan: number }[] }[];
  components: unknown[];
  styles?: unknown;
  surfaces?: unknown[];
  extraSections?: unknown[];
}) {
  return {
    format: "docforge/layout",
    version: 1,
    surfaces: parts.surfaces ?? [{ id: "a4", kind: "page", size: "A4", margin: 48 }],
    ...(parts.styles ? { styles: parts.styles } : {}),
    sections: [{ id: "s1", bands: parts.bands }, ...(parts.extraSections ?? [])],
    components: parts.components,
  };
}

export const lorem =
  "O documento é medido pela própria biblioteca, que decide onde cada linha quebra e desenha as linhas prontas, sem deixar o navegador quebrar o texto de novo.";
