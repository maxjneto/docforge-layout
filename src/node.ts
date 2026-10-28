import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BUNDLED_FONTS } from "./fonts/bundled";
import { FontRegistry, type FontSource } from "./fonts/registry";

export interface NodeFontOptions {
  /**
   * Give every font its file:// URL, so rendered HTML carries @font-face rules a browser on
   * this machine can load (the CLI's `render` and the stdio MCP server write local files).
   * Leave it off for HTML sent elsewhere: a remote browser cannot read these paths, and
   * without @font-face the page names the families and the receiver supplies the fonts.
   */
  fileUrls?: boolean;
}

/** Node helper: read the bundled fonts from the package's `fonts/` folder. */
export function loadBundledFonts(options: NodeFontOptions = {}): FontSource[] {
  const dir = new URL("../fonts/", import.meta.url);
  return BUNDLED_FONTS.map((f) => {
    const fileUrl = new URL(f.file, dir);
    return {
      family: f.family,
      weight: f.weight,
      style: f.style,
      data: new Uint8Array(readFileSync(fileURLToPath(fileUrl))),
      ...(options.fileUrls ? { url: fileUrl.href } : {}),
    };
  });
}

/** Paths of the bundled font files (for rasterizers such as resvg that load fonts themselves). */
export function bundledFontFiles(): string[] {
  const dir = new URL("../fonts/", import.meta.url);
  return BUNDLED_FONTS.map((f) => fileURLToPath(new URL(f.file, dir)));
}

/** A registry with every bundled font already loaded. */
export function createNodeRegistry(options: NodeFontOptions = {}): FontRegistry {
  const registry = new FontRegistry();
  registry.register(loadBundledFonts(options));
  return registry;
}
