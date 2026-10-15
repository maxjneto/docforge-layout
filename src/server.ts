/**
 * An HTTP front for the engine, for callers that are not JavaScript (a Python
 * backend, a Go CLI…) or that want the engine in its own process.
 *
 * Stateless: every request carries the whole document. The caller owns storage,
 * auth and revisions. Bind it to a private network; it has no auth of its own.
 *
 *   GET  /health
 *   POST /validate  { doc, surface? }                                 -> { ok, diagnostics, map, pages }
 *   POST /apply     { doc, ops, surface?, pages?, draw? }             -> { ok, doc, diagnostics, changes, map, summary }
 *   POST /map       { doc, level, components?, pages?, draw?, surface? } -> { level, text }
 *   POST /render    { doc, surface?, grid? }                          -> { ok, page, pages, diagnostics }
 *   POST /measure   { component, doc?, widths?, cols?, surface? }     -> { ok, measurements, diagnostics, text }
 *   POST /find      { doc, query, surface? }                          -> { matches, text }
 *   POST /diff      { before, after, touched?, surface? }             -> { changes }
 *   POST /calibrate { doc, target: {component|label|selector}, variants: [style…], surface? } -> { ok, variants, text }
 *   POST /locate    { doc, anchors: [{component?, rect?}], surface? }  -> { anchors: [{component?, under, text}] }
 *   POST /review    { doc, surface? }                                 -> { findings, text }
 *   POST /render-image { doc, page?, scale?, highlight?, surface? }   -> { page, pages, png (base64) | null, svg?, width?, height? }
 *   POST /upgrade   { doc }                                           -> { ok, doc, notes }
 *
 * `ok` is false only when the document cannot be used (invalid schema, duplicate ids,
 * a malformed op): layout problems are diagnostics, never a refusal.
 *
 * `/apply` never saves anything: it returns what the document would become, so the
 * same route serves a preview and a write (the caller decides what to store).
 *
 * `/render` returns a standalone HTML page whose @font-face rules point at the
 * URLs the registry's fonts were registered with (none, for the Node registry):
 * serve the fonts and register them with URLs if the page will be shown.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createEngine, type Engine } from "./engine";
import { createNodeRegistry } from "./node";
import type { CalibrateTarget } from "./query/calibrate";
import type { Anchor } from "./query/locate";
import { BLOCKING_CODES, type Diagnostic } from "./validate/diagnostics";
import type { FindQuery } from "./query/find";
import { upgradeDocument } from "./upgrade";

export interface LayoutServerOptions {
  /** Defaults to an engine over the bundled fonts. */
  engine?: Engine;
  /** Largest accepted request body. Default 2 MB. */
  maxBodyBytes?: number;
  /** Called with errors that are not the caller's fault. Default: console.error. */
  onError?: (error: unknown) => void;
  /**
   * Turns a page SVG into PNG bytes at `scale` (1 = the page's px size). Without it,
   * `/render-image` answers with the SVG only. `docforge-layout serve` plugs in
   * resvg (`@resvg/resvg-js`) when it is installed: no browser needed.
   */
  rasterize?: (svg: string, scale: number) => Uint8Array;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Body = Record<string, unknown>;

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(json) });
  res.end(json);
}

async function readJson(req: IncomingMessage, limit: number): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, `Request body is larger than ${limit} bytes.`);
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Request body must be a JSON object.");
  return body as Body;
}

function docOf(body: Body): unknown {
  const doc = body.doc;
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) throw new HttpError(400, "`doc` must be a layout document object.");
  return doc;
}

function objectOf(body: Body, key: string, what: string): unknown {
  const value = body[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, `\`${key}\` must be ${what}.`);
  return value;
}

function intList(value: unknown, key: string): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((n) => Number.isInteger(n) && n > 0)) throw new HttpError(400, `\`${key}\` must be an array of positive whole numbers.`);
  return value as number[];
}

function mapExtras(body: Body): { pages?: number[]; draw?: boolean } {
  const pages = intList(body.pages, "pages");
  if (body.draw !== undefined && typeof body.draw !== "boolean") throw new HttpError(400, "`draw` must be true or false.");
  return { ...(pages ? { pages } : {}), ...(body.draw !== undefined ? { draw: body.draw as boolean } : {}) };
}

const blocked = (diagnostics: Diagnostic[]) => diagnostics.some((d) => BLOCKING_CODES.has(d.code));

function surfaceOf(body: Body): string | undefined {
  if (body.surface === undefined || body.surface === null) return undefined;
  if (typeof body.surface !== "string") throw new HttpError(400, "`surface` must be a surface id.");
  return body.surface;
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return png.byteLength >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : { width: 0, height: 0 };
}

/** A request handler for `http.createServer` (or any framework that hands you Node req/res). */
export function createLayoutHandler(options: LayoutServerOptions = {}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const engine = options.engine ?? createEngine({ registry: createNodeRegistry() });
  const limit = options.maxBodyBytes ?? 2_000_000;
  const onError = options.onError ?? ((error: unknown) => console.error(error));

  const routes: Record<string, (body: Body) => unknown> = {
    "POST /validate": (body) => {
      const doc = docOf(body);
      const surfaceId = surfaceOf(body);
      const layout = engine.layout(doc, surfaceId);
      return {
        ok: layout.ok && !blocked(layout.diagnostics),
        diagnostics: layout.diagnostics,
        map: engine.map(doc, { level: 1, surfaceId }).text,
        pages: layout.pages.length,
      };
    },

    "POST /apply": (body) => {
      const doc = docOf(body);
      if (!Array.isArray(body.ops) || body.ops.length === 0) throw new HttpError(400, "`ops` must be a non-empty array.");
      return engine.apply(doc, body.ops, { surfaceId: surfaceOf(body), map: mapExtras(body) });
    },

    "POST /map": (body) => {
      const doc = docOf(body);
      const level = body.level ?? 1;
      if (level !== 0 && level !== 1 && level !== 2) throw new HttpError(400, "`level` must be 0, 1 or 2.");
      const components = body.components;
      if (components !== undefined && (!Array.isArray(components) || !components.every((c) => typeof c === "string"))) {
        throw new HttpError(400, "`components` must be an array of component ids.");
      }
      return engine.map(doc, { level, components: components as string[] | undefined, surfaceId: surfaceOf(body), ...mapExtras(body) });
    },

    "POST /render": (body) => {
      const doc = docOf(body);
      const result = engine.render(doc, { surfaceId: surfaceOf(body), grid: body.grid === true });
      return {
        ok: result.layout.ok && !blocked(result.layout.diagnostics),
        page: result.page,
        pages: result.rendered.pages,
        diagnostics: result.layout.diagnostics,
      };
    },

    "POST /measure": (body) => {
      const component = objectOf(body, "component", "a component object");
      const doc = body.doc === undefined || body.doc === null ? undefined : docOf(body);
      const widths = intList(body.widths, "widths");
      const cols = body.cols;
      if (
        cols !== undefined &&
        (!Array.isArray(cols) || !cols.every((c) => Array.isArray(c) && c.length === 2 && c.every((n) => Number.isInteger(n) && n > 0)))
      ) {
        throw new HttpError(400, "`cols` must be an array of [first, last] guide column pairs.");
      }
      return engine.measure(component, {
        surfaceId: surfaceOf(body),
        ...(doc !== undefined ? { doc } : {}),
        ...(widths ? { widths } : {}),
        ...(cols ? { cols: cols as [number, number][] } : {}),
      });
    },

    "POST /find": (body) => {
      const doc = docOf(body);
      const query = objectOf(body, "query", "an object of filters") as FindQuery;
      return engine.find(doc, query, { surfaceId: surfaceOf(body) });
    },

    "POST /diff": (body) => {
      const before = objectOf(body, "before", "a layout document object");
      const after = objectOf(body, "after", "a layout document object");
      const touched = body.touched;
      if (touched !== undefined && (!Array.isArray(touched) || !touched.every((t) => typeof t === "string"))) {
        throw new HttpError(400, "`touched` must be an array of component ids.");
      }
      return { changes: engine.diff(before, after, { surfaceId: surfaceOf(body), touched: touched as string[] | undefined }) };
    },

    "POST /calibrate": (body) => {
      const doc = docOf(body);
      const target = objectOf(body, "target", "{component}, {label} or {selector}") as Record<string, unknown>;
      const keys = ["component", "label", "selector"].filter((k) => typeof target[k] === "string" && target[k]);
      if (keys.length !== 1) throw new HttpError(400, "`target` must have exactly one of component, label or selector.");
      const variants = body.variants;
      if (!Array.isArray(variants) || variants.length === 0 || variants.length > 12) throw new HttpError(400, "`variants` must be an array of 1 to 12 style objects.");
      const key = keys[0] as "component" | "label" | "selector";
      return engine.calibrate(doc, { [key]: target[key] } as CalibrateTarget, variants, { surfaceId: surfaceOf(body) });
    },

    "POST /locate": (body) => {
      const doc = docOf(body);
      const anchors = body.anchors;
      if (!Array.isArray(anchors) || !anchors.every((a) => a !== null && typeof a === "object" && !Array.isArray(a))) {
        throw new HttpError(400, "`anchors` must be an array of {component?, rect?} objects.");
      }
      return { anchors: engine.locate(doc, anchors as Anchor[], { surfaceId: surfaceOf(body) }) };
    },
    "POST /review": (body) => engine.review(docOf(body), { surfaceId: surfaceOf(body) }),
    "POST /render-image": (body) => {
      const doc = docOf(body);
      const page = body.page === undefined ? 1 : body.page;
      if (!Number.isInteger(page) || (page as number) < 1) throw new HttpError(400, "`page` must be a page number (1, 2…).");
      const scale = body.scale === undefined ? 1 : body.scale;
      if (typeof scale !== "number" || scale < 0.25 || scale > 2) throw new HttpError(400, "`scale` must be a number from 0.25 to 2.");
      const highlight = body.highlight === undefined ? [] : body.highlight;
      if (!Array.isArray(highlight) || !highlight.every((id) => typeof id === "string")) throw new HttpError(400, "`highlight` must be an array of component ids.");
      const surfaceId = surfaceOf(body);
      const pages = engine.layout(doc, surfaceId).pages.length;
      if ((page as number) > pages) throw new HttpError(400, `The document has ${pages} page${pages === 1 ? "" : "s"}; page ${String(page)} does not exist.`);
      const svg = engine.renderSvg(doc, { page: page as number, surfaceId, highlight: highlight as string[] });
      if (!options.rasterize) return { page, pages, svg, png: null };
      const png = options.rasterize(svg, scale);
      return { page, pages, png: Buffer.from(png).toString("base64"), width: pngSize(png).width, height: pngSize(png).height };
    },

    "POST /upgrade": (body) => upgradeDocument(docOf(body), engine),
  };

  return async function handle(req, res) {
    try {
      const path = new URL(req.url ?? "/", "http://layout").pathname;
      if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true });
      const route = routes[`${req.method} ${path}`];
      if (!route) throw new HttpError(404, `No route for ${req.method} ${path}.`);
      send(res, 200, route(await readJson(req, limit)));
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message });
      onError(error);
      send(res, 500, { error: "Internal error while running the layout engine." });
    }
  };
}

/** An `http.Server` running the layout API. Call `.listen(port, host)` on it. */
export function createLayoutServer(options: LayoutServerOptions = {}): Server {
  return createServer(createLayoutHandler(options));
}
