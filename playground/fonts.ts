import { BUNDLED_FONTS, createBrowserRegistry, type FontRegistry } from "@docforge-lib/layout";

// Vite serves the repo's font files under hashed names; the registry measures with the
// same bytes the iframe renders with.
const urls = import.meta.glob("../fonts/*.ttf", { query: "?url", import: "default", eager: true }) as Record<string, string>;

export function loadRegistry(): Promise<FontRegistry> {
  return createBrowserRegistry((file) => {
    const url = urls[`../fonts/${file}`];
    if (!url) throw new Error(`Font file missing: ${file}`);
    return url;
  });
}

/** Wait until every bundled face is usable inside `doc` (an iframe document). */
export async function fontsReady(doc: Document): Promise<void> {
  await Promise.all(
    BUNDLED_FONTS.map((f) => doc.fonts.load(`${f.style === "italic" ? "italic " : ""}${f.weight} 16px "DFL ${f.family}"`)),
  );
  await doc.fonts.ready;
}
