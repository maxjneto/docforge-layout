import { BUNDLED_FONTS, FontRegistry } from "@docforge/layout";

// Vite serves the repo's font files; the registry measures with the same bytes the iframe renders with.
const urls = import.meta.glob("../fonts/*.ttf", { query: "?url", import: "default", eager: true }) as Record<string, string>;

export async function loadRegistry(): Promise<FontRegistry> {
  const registry = new FontRegistry();
  const sources = await Promise.all(
    BUNDLED_FONTS.map(async (font) => {
      const relative = urls[`../fonts/${font.file}`];
      if (!relative) throw new Error(`Font file missing: ${font.file}`);
      const url = new URL(relative, window.location.href).href;
      const response = await fetch(url);
      return { family: font.family, weight: font.weight, style: font.style, data: await response.arrayBuffer(), url };
    }),
  );
  registry.register(sources);
  return registry;
}

/** Wait until every bundled face is usable inside `doc` (an iframe document). */
export async function fontsReady(doc: Document): Promise<void> {
  await Promise.all(
    BUNDLED_FONTS.map((f) => doc.fonts.load(`${f.style === "italic" ? "italic " : ""}${f.weight} 16px "DFL ${f.family}"`)),
  );
  await doc.fonts.ready;
}
