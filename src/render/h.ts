/**
 * The only way the library writes HTML. Text and attribute values are always
 * escaped, CSS values are sanitized and URLs go through an allowlist, so content
 * from a document (written by an agent or another person) can never inject markup,
 * event handlers or `javascript:` links.
 */

export type StyleValue = string | number | null | undefined | false;
export type Style = Record<string, StyleValue>;
export type AttrValue = string | number | boolean | null | undefined;
/** Attributes; `style` takes a style object, every other value a primitive. */
export type Attrs = { [name: string]: AttrValue | Style };

const VOID = new Set(["img", "br", "hr", "input", "meta"]);
const SVG_LEAVES = new Set(["rect", "circle", "path", "line", "polyline", "polygon", "ellipse"]);
const TAG = /^[a-z][a-z0-9]*$/;
const ATTR = /^[a-z][a-z0-9:-]*$/i;
/** px is implied for these CSS properties when a number is given. */
const UNITLESS = new Set(["fontWeight", "zIndex", "opacity", "flex", "lineHeightRatio"]);

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Round to 1/100 px so the HTML stays short and stable. */
export function px(n: number): string {
  return `${Math.round(n * 100) / 100}px`;
}

/** Remove anything that could end a declaration, open a block or a function in a CSS value. */
export function cssSafe(value: string): string {
  return value
    .replace(/[;{}<>"\\]/g, "")
    .replace(/url\s*\(|expression\s*\(|@import|javascript:/gi, "");
}

export function styleString(style: Style): string {
  return Object.entries(style)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "")
    .map(([k, v]) => {
      const prop = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const value = typeof v === "number" ? (UNITLESS.has(k) ? String(v) : px(v)) : cssSafe(String(v));
      return `${prop}:${value}`;
    })
    .join(";");
}

/** Build an element. `children` must already be HTML produced by `h`/`text`. */
export function h(tag: string, attrs: Attrs = {}, ...children: string[]): string {
  if (!TAG.test(tag)) throw new Error(`Invalid tag: ${tag}`);
  let out = `<${tag}`;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (!ATTR.test(name) || name.toLowerCase().startsWith("on")) throw new Error(`Invalid attribute: ${name}`);
    if (name === "style") {
      const css = styleString(value as unknown as Style);
      if (css) out += ` style="${esc(css)}"`;
      continue;
    }
    out += value === true ? ` ${name}` : ` ${name}="${esc(String(value))}"`;
  }
  const inner = children.join("");
  if (VOID.has(tag)) return `${out}>`;
  if (SVG_LEAVES.has(tag) && !inner) return `${out}/>`;
  return `${out}>${inner}</${tag}>`;
}

/** Escaped text node. */
export function text(value: string): string {
  return esc(value);
}

/** Absolute box style at (x, y) with size w×h, plus extra rules. */
export function absStyle(x: number, y: number, w: number, hgt: number, extra: Style = {}): Style {
  return { position: "absolute", left: x, top: y, width: w, height: hgt, ...extra };
}

/** Element id of a component's (or section's) anchor. */
export function anchorId(id: string): string {
  return `dfl-${id}`;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Lowercase, without control characters or whitespace: browsers ignore them inside a scheme ("java\tscript:"). */
function normalizeUrl(value: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return value.replace(/[\u0000-\u001f\u007f\s]/g, "").toLowerCase();
}

/**
 * Links a document may contain: `#id` (inside the document), `http(s):` and `mailto:`.
 * Anything else (`javascript:`, `data:`, `vbscript:`…) returns `null`.
 */
export function safeHref(href: string): string | null {
  const value = href.trim();
  if (value.startsWith("#")) return SAFE_ID.test(value.slice(1)) ? `#${anchorId(value.slice(1))}` : null;
  const normalized = normalizeUrl(value);
  if (normalized.startsWith("https://") || normalized.startsWith("http://") || normalized.startsWith("mailto:")) return value;
  return null;
}

export function isSafeHref(href: string): boolean {
  return safeHref(href) !== null;
}

/** Image sources: http(s), relative paths and raster/SVG `data:` images (SVG in <img> runs no script). */
export function safeSrc(src: string): string | null {
  const value = src.trim();
  const normalized = normalizeUrl(value);
  if (normalized.startsWith("https://") || normalized.startsWith("http://")) return value;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/.test(normalized)) return value;
  if (!/^[a-z][a-z0-9+.-]*:/.test(normalized)) return value; // relative path, no scheme
  return null;
}

export function isSafeSrc(src: string): boolean {
  return safeSrc(src) !== null;
}
