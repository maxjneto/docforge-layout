import * as fontkit from "fontkit";

export interface FontSource {
  family: string;
  weight: number;
  style: "normal" | "italic";
  data: Uint8Array | ArrayBuffer;
  /** URL the browser can load the same bytes from; used to emit @font-face rules. */
  url?: string;
}

export interface Face {
  key: string;
  family: string;
  weight: number;
  style: "normal" | "italic";
  url?: string;
  font: fontkit.Font;
  unitsPerEm: number;
  ascent: number;
  descent: number;
}

/** Escape a value for a double-quoted CSS string (and keep it from closing a <style> element). */
function cssString(value: string): string {
  return value.replace(/["\\\n<>]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

/** CSS family name the renderer emits, namespaced so a system or webfont "Inter" never stands in. */
export function cssFamily(family: string): string {
  return `DFL ${family}`;
}

/** The family as a CSS value, single-quoted so it can sit inside a double-quoted style attribute. */
export function cssFamilyValue(family: string): string {
  return `'${cssFamily(family)}'`;
}

/**
 * The fonts the layout engine is allowed to use. Measurement and rendering read the
 * same font files, so a width computed here is the width the browser draws.
 */
export class FontRegistry {
  private faces: Face[] = [];
  private widthCache = new Map<string, Map<string, number>>();

  register(sources: FontSource | FontSource[]): void {
    for (const source of Array.isArray(sources) ? sources : [sources]) {
      const bytes = source.data instanceof Uint8Array ? source.data : new Uint8Array(source.data);
      // fontkit's typings ask for a Node Buffer; it only reads through a DataView, so bytes work everywhere.
      const created = fontkit.create(bytes as unknown as Buffer);
      if (!("layout" in created)) throw new Error(`Font collections are not supported (${source.family}).`);
      const font = created as fontkit.Font;
      const key = `${source.family}|${source.weight}|${source.style}`;
      this.faces = this.faces.filter((f) => f.key !== key);
      this.faces.push({
        key,
        family: source.family,
        weight: source.weight,
        style: source.style,
        url: source.url,
        font,
        unitsPerEm: font.unitsPerEm,
        ascent: font.ascent,
        descent: font.descent,
      });
      this.widthCache.delete(key);
    }
  }

  families(): string[] {
    return [...new Set(this.faces.map((f) => f.family))];
  }

  hasFamily(family: string): boolean {
    return this.faces.some((f) => f.family === family);
  }

  /** CSS-like matching inside one family: style first, then the nearest weight. */
  match(family: string, weight: number, italic: boolean): Face {
    let candidates = this.faces.filter((f) => f.family === family);
    if (candidates.length === 0) {
      const fallback = this.faces[0];
      if (!fallback) throw new Error("No fonts registered. Call registry.register() before measuring.");
      candidates = this.faces.filter((f) => f.family === fallback.family);
    }
    const wanted = italic ? "italic" : "normal";
    const sameStyle = candidates.filter((f) => f.style === wanted);
    const pool = sameStyle.length > 0 ? sameStyle : candidates;
    let best = pool[0] as Face;
    for (const face of pool) {
      if (Math.abs(face.weight - weight) < Math.abs(best.weight - weight)) best = face;
    }
    return best;
  }

  /** Advance width of `text` set in `face` at `size` px. */
  measure(face: Face, size: number, text: string): number {
    if (text.length === 0) return 0;
    let cache = this.widthCache.get(face.key);
    if (!cache) {
      cache = new Map();
      this.widthCache.set(face.key, cache);
    }
    let units = cache.get(text);
    if (units === undefined) {
      units = face.font.layout(text).advanceWidth;
      cache.set(text, units);
    }
    return (units * size) / face.unitsPerEm;
  }

  /** Characters of `text` the face has no glyph for (rendering would fall back to another font). */
  missingGlyphs(face: Face, text: string): string[] {
    const missing = new Set<string>();
    for (const char of text) {
      if (/\s/.test(char)) continue;
      const cp = char.codePointAt(0);
      if (cp !== undefined && !face.font.hasGlyphForCodePoint(cp)) missing.add(char);
    }
    return [...missing];
  }

  /** @font-face rules for every face that has a URL. */
  fontFaceCss(): string {
    return this.faces
      .filter((f) => f.url)
      .map(
        (f) =>
          `@font-face{font-family:"${cssFamily(f.family)}";src:url("${cssString(f.url ?? "")}");font-weight:${f.weight};font-style:${f.style};font-display:block;}`,
      )
      .join("\n");
  }
}
