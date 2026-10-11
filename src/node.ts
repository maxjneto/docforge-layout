import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BUNDLED_FONTS } from "./fonts/bundled";
import { FontRegistry, type FontSource } from "./fonts/registry";

/** Node helper: read the bundled fonts from the package's `fonts/` folder. */
export function loadBundledFonts(): FontSource[] {
  const dir = new URL("../fonts/", import.meta.url);
  return BUNDLED_FONTS.map((f) => {
    const fileUrl = new URL(f.file, dir);
    return {
      family: f.family,
      weight: f.weight,
      style: f.style,
      data: new Uint8Array(readFileSync(fileURLToPath(fileUrl))),
    };
  });
}

/** A registry with every bundled font already loaded. */
export function createNodeRegistry(): FontRegistry {
  const registry = new FontRegistry();
  registry.register(loadBundledFonts());
  return registry;
}
