/**
 * An HTTP front for the engine, for callers that are not JavaScript (a Python
 * backend, a Go CLI…) or that want the engine in its own process.
 *
 * Stateless: every request carries the whole document. The caller owns storage,
 * auth and revisions. Bind it to a private network; it has no auth of its own.
 *
 *   GET  /health
 *   POST /validate  { doc, surface? }                     -> { ok, diagnostics, map, pages }
 *   POST /apply     { doc, ops, surface? }                -> { ok, doc, diagnostics, map }
 *   POST /map       { doc, level, components?, surface? } -> { level, text }
 *   POST /render    { doc, surface?, grid? }              -> { ok, page, pages, diagnostics }
 *
 * `/render` returns a standalone HTML page whose @font-face rules point at the
 * URLs the registry's fonts were registered with (none, for the Node registry):
 * serve the fonts and register them with URLs if the page will be shown.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createEngine, type Engine } from "./engine";
import { createNodeRegistry } from "./node";

export interface LayoutServerOptions {
  /** Defaults to an engine over the bundled fonts. */
  engine?: Engine;
  /** Largest accepted request body. Default 2 MB. */
  maxBodyBytes?: number;
  /** Called with errors that are not the caller's fault. Default: console.error. */
  onError?: (error: unknown) => void;
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

function surfaceOf(body: Body): string | undefined {
  if (body.surface === undefined || body.surface === null) return undefined;
  if (typeof body.surface !== "string") throw new HttpError(400, "`surface` must be a surface id.");
  return body.surface;
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
        ok: !layout.diagnostics.some((d) => d.severity === "error"),
        diagnostics: layout.diagnostics,
        map: engine.map(doc, { level: 1, surfaceId }).text,
        pages: layout.pages.length,
      };
    },

    "POST /apply": (body) => {
      const doc = docOf(body);
      if (!Array.isArray(body.ops) || body.ops.length === 0) throw new HttpError(400, "`ops` must be a non-empty array.");
      return engine.apply(doc, body.ops, { surfaceId: surfaceOf(body) });
    },

    "POST /map": (body) => {
      const doc = docOf(body);
      const level = body.level ?? 1;
      if (level !== 0 && level !== 1 && level !== 2) throw new HttpError(400, "`level` must be 0, 1 or 2.");
      const components = body.components;
      if (components !== undefined && (!Array.isArray(components) || !components.every((c) => typeof c === "string"))) {
        throw new HttpError(400, "`components` must be an array of component ids.");
      }
      return engine.map(doc, { level, components: components as string[] | undefined, surfaceId: surfaceOf(body) });
    },

    "POST /render": (body) => {
      const doc = docOf(body);
      const result = engine.render(doc, { surfaceId: surfaceOf(body), grid: body.grid === true });
      return {
        ok: !result.layout.diagnostics.some((d) => d.severity === "error"),
        page: result.page,
        pages: result.rendered.pages,
        diagnostics: result.layout.diagnostics,
      };
    },
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
