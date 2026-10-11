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

/** Browser helper: fetch the bundled fonts from `baseUrl` (a URL to the package's `fonts/` folder). */
export async function fetchBundledFonts(baseUrl: string) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return Promise.all(
    BUNDLED_FONTS.map(async (f) => {
      const url = new URL(f.file, new URL(base, globalThis.location?.href)).href;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load font ${url}: ${response.status}`);
      return { family: f.family, weight: f.weight, style: f.style, data: await response.arrayBuffer(), url };
    }),
  );
}
