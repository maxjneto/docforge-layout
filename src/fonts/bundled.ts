import { FontRegistry, type FontSource } from "./registry";

/** The font files shipped in `fonts/`. Every face the default tokens can reach is here. */
export const BUNDLED_FONTS = [
  { family: "Inter", weight: 400, style: "normal", file: "Inter-Regular.ttf" },
  { family: "Inter", weight: 500, style: "normal", file: "Inter-Medium.ttf" },
  { family: "Inter", weight: 600, style: "normal", file: "Inter-SemiBold.ttf" },
  { family: "Inter", weight: 700, style: "normal", file: "Inter-Bold.ttf" },
  { family: "Inter", weight: 400, style: "italic", file: "Inter-Italic.ttf" },
  { family: "Inter", weight: 600, style: "italic", file: "Inter-SemiBoldItalic.ttf" },
  { family: "Inter", weight: 700, style: "italic", file: "Inter-BoldItalic.ttf" },
  { family: "JetBrains Mono", weight: 400, style: "normal", file: "JetBrainsMono-Regular.ttf" },
  { family: "JetBrains Mono", weight: 600, style: "normal", file: "JetBrainsMono-SemiBold.ttf" },
] as const satisfies ReadonlyArray<{ family: string; weight: number; style: "normal" | "italic"; file: string }>;

export type BundledFontFile = (typeof BUNDLED_FONTS)[number]["file"];

/**
 * Where the browser can fetch each bundled font:
 * - a folder URL that serves the package's `fonts/` files under their own names;
 * - a map from file name to URL — what a bundler gives you, since it renames assets
 *   (Vite: `import inter from "@docforge/layout/fonts/Inter-Regular.ttf?url"`);
 * - a function from file name to URL.
 */
export type FontLocation = string | Readonly<Record<BundledFontFile, string>> | ((file: BundledFontFile) => string);

function urlFor(location: FontLocation, file: BundledFontFile): string {
  const base = globalThis.location?.href;
  if (typeof location === "function") return new URL(location(file), base).href;
  if (typeof location === "string") {
    const folder = location.endsWith("/") ? location : `${location}/`;
    return new URL(file, new URL(folder, base)).href;
  }
  const url = location[file];
  if (!url) throw new Error(`No URL given for bundled font ${file}.`);
  return new URL(url, base).href;
}

/** Browser helper: fetch every bundled font. Each source keeps its URL, so the rendered page loads the same bytes. */
export async function fetchBundledFonts(location: FontLocation): Promise<FontSource[]> {
  return Promise.all(
    BUNDLED_FONTS.map(async (f) => {
      const url = urlFor(location, f.file);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load font ${url}: ${response.status}`);
      return { family: f.family, weight: f.weight, style: f.style, data: await response.arrayBuffer(), url };
    }),
  );
}

/** Browser helper: a registry with every bundled font fetched and registered. */
export async function createBrowserRegistry(location: FontLocation): Promise<FontRegistry> {
  const registry = new FontRegistry();
  registry.register(await fetchBundledFonts(location));
  return registry;
}
