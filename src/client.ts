/**
 * Loading documents from a DocForge server: the published version by its link or
 * token, or any revision by id with an API key (server side only).
 *
 * The JSON is the document. A system that keeps its own copy (fetch once when it is
 * published, store it, render from storage) does not depend on DocForge being up;
 * this module is for getting that copy, or for reading live with a cache that serves
 * the last good copy when the server fails.
 *
 * Every request asks for the format this library reads (`?format=`): a newer server
 * converts the document down and says what was lost (logged as `format_downgraded`).
 */

import { readDocument } from "./format";
import { consoleLogger, type Logger } from "./log";
import { VERSION, type LayoutDocument } from "./schema/document";

export const DEFAULT_BASE_URL = "https://docforge.dev/api";

/** What the server answers, kept as is in the cache. */
export interface DocumentPayload {
  title?: string | null;
  revision: number;
  published_at?: string | null;
  updated_at?: string | null;
  content: unknown;
  /** What the server's conversion down could not keep. */
  notes?: string[];
}

export interface CachedDocument {
  etag: string | null;
  payload: DocumentPayload;
  storedAt: string;
}

/** Where loaded documents are kept: memory (default), localStorage, your database… */
export interface DocumentCache {
  get(key: string): CachedDocument | undefined | Promise<CachedDocument | undefined>;
  set(key: string, value: CachedDocument): void | Promise<void>;
}

export function memoryCache(): DocumentCache {
  const entries = new Map<string, CachedDocument>();
  return { get: (key) => entries.get(key), set: (key, value) => void entries.set(key, value) };
}

const sharedCache = memoryCache();

export interface LoadedDocument {
  doc: LayoutDocument;
  title: string | null;
  revision: number;
  /** When this revision was published (published documents only). */
  publishedAt: string | null;
  /** What the server's conversion down could not keep (empty when nothing was lost). */
  notes: string[];
  /** True when the server failed and this is the last good copy. */
  fromCache: boolean;
}

export type DocForgeErrorCode = "not_found" | "unauthorized" | "http" | "network" | "invalid_document";

export class DocForgeError extends Error {
  constructor(
    readonly code: DocForgeErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DocForgeError";
  }
}

interface LoadOptions {
  /** The API's address, e.g. `https://docforge.dev/api`. A link carries its own. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Default: one in-memory cache shared by the process (or page). `false` turns it off. */
  cache?: DocumentCache | false;
  logger?: Logger;
  signal?: AbortSignal;
}

const inBrowser = () => typeof window !== "undefined" && typeof (window as { document?: unknown }).document !== "undefined";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** `https://host/public/<token>` (the page) or `https://host/api/public/<token>/layout` (the API), or a bare token. */
export function parsePublicSource(source: string, baseUrl = DEFAULT_BASE_URL): { baseUrl: string; token: string } {
  if (!/^https?:\/\//i.test(source)) {
    if (!source || /[/?#\s]/.test(source)) throw new DocForgeError("not_found", `"${source}" is neither a DocForge link nor a token.`);
    return { baseUrl: trimSlash(baseUrl), token: source };
  }
  const url = new URL(source);
  const parts = url.pathname.split("/").filter(Boolean);
  const at = parts.indexOf("public");
  const token = at >= 0 ? parts[at + 1] : undefined;
  if (!token) throw new DocForgeError("not_found", `${source} is not a DocForge public link (…/public/TOKEN).`);
  const prefix = parts.slice(0, at);
  const api = prefix.length ? `/${prefix.join("/")}` : "/api";
  return { baseUrl: `${url.origin}${api}`, token: decodeURIComponent(token) };
}

async function load(
  url: string,
  init: { headers: Record<string, string>; key: string; source: string; notFound: string; immutable?: boolean },
  options: LoadOptions,
): Promise<{ payload: DocumentPayload; fromCache: boolean }> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const cache = options.cache === false ? null : (options.cache ?? sharedCache);
  const log = options.logger ?? consoleLogger;
  const cached = cache ? await cache.get(init.key) : undefined;
  if (cached && init.immutable) return { payload: cached.payload, fromCache: false };

  const headers: Record<string, string> = { Accept: "application/json", ...init.headers };
  // In the browser a custom header would cost a CORS preflight; the browser's own HTTP cache revalidates.
  if (cached?.etag && !inBrowser()) headers["If-None-Match"] = cached.etag;

  const fallback = (why: string) => {
    if (!cached) return null;
    log({ code: "served_from_cache", message: `${init.source}: ${why}; using the copy from ${cached.storedAt}`, data: { stored_at: cached.storedAt } });
    return { payload: cached.payload, fromCache: true };
  };

  let response: Response;
  try {
    response = await doFetch(url, { headers, signal: options.signal });
  } catch (error) {
    const served = fallback(`the server did not answer (${error instanceof Error ? error.message : String(error)})`);
    if (served) return served;
    throw new DocForgeError("network", `${init.source}: the server did not answer.`);
  }

  if (response.status === 304 && cached) return { payload: cached.payload, fromCache: false };
  if (response.status === 404) throw new DocForgeError("not_found", `${init.source}: ${init.notFound}.`, 404);
  if (response.status === 401 || response.status === 403) throw new DocForgeError("unauthorized", `${init.source}: the API key was refused.`, response.status);
  if (!response.ok) {
    const served = response.status >= 500 || response.status === 429 ? fallback(`the server answered ${response.status}`) : null;
    if (served) return served;
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = `: ${body.detail}`;
    } catch {
      /* not JSON */
    }
    throw new DocForgeError("http", `${init.source}: the server answered ${response.status}${detail}.`, response.status);
  }

  const payload = (await response.json()) as DocumentPayload;
  if (cache) await cache.set(init.key, { etag: response.headers.get("ETag"), payload, storedAt: new Date().toISOString() });
  return { payload, fromCache: false };
}

function finish(payload: DocumentPayload, fromCache: boolean, source: string, log: Logger): LoadedDocument {
  const notes = payload.notes ?? [];
  if (notes.length && !fromCache) {
    log({
      code: "format_downgraded",
      message: `${source} was converted to format ${VERSION} for this library: ${notes.join("; ")}`,
      data: { to: VERSION, notes },
    });
  }
  const read = readDocument(payload.content, { logger: log, source });
  if (!read.ok || !read.doc) throw new DocForgeError("invalid_document", `${source}: ${read.notes.join("; ") || "not a layout document"}`);
  return {
    doc: read.doc,
    title: payload.title ?? read.doc.meta?.title ?? null,
    revision: payload.revision,
    publishedAt: payload.published_at ?? null,
    notes,
    fromCache,
  };
}

/**
 * The published version of a document, by its public link or token. Works in the
 * browser and on a server. Only what the owner published is ever served: drafts and
 * edits after the last "Publish" stay private.
 */
export async function fetchPublished(source: string, options: LoadOptions = {}): Promise<LoadedDocument> {
  const { baseUrl, token } = parsePublicSource(source, options.baseUrl);
  const url = `${baseUrl}/public/${encodeURIComponent(token)}/layout?format=${VERSION}`;
  const label = `published document ${token.slice(0, 6)}…`;
  const { payload, fromCache } = await load(url, { headers: {}, key: `public|${baseUrl}|${token}|${VERSION}`, source: label, notFound: "not found (not published, unpublished, or the link was revoked)" }, options);
  return finish(payload, fromCache, label, options.logger ?? consoleLogger);
}

export interface DocForgeClient {
  /**
   * A document by id. Pin `revision` to get exactly that one (cached for good once
   * read); without it you get the current state, whatever was last saved, and the
   * log says so (`revision_unpinned`).
   */
  get(id: string, options?: { revision?: number; signal?: AbortSignal }): Promise<LoadedDocument>;
}

/**
 * A client that reads documents by id with an API key. Server side only: a key in a
 * web page can be read by anyone who opens it, so this refuses to run in a browser.
 */
export function createClient(options: LoadOptions & { apiKey: string }): DocForgeClient {
  if (inBrowser()) {
    throw new Error("createClient runs on a server: an API key in a web page is readable by anyone. In the browser, use fetchPublished with a public link.");
  }
  if (!options.apiKey) throw new Error("createClient needs an apiKey (DocForge → MCP → API keys).");
  const baseUrl = trimSlash(options.baseUrl ?? DEFAULT_BASE_URL);
  const log = options.logger ?? consoleLogger;

  return {
    async get(id, getOptions = {}) {
      const { revision } = getOptions;
      if (revision !== undefined && (!Number.isInteger(revision) || revision < 1)) throw new Error("`revision` must be a revision number (1, 2…).");
      const query = `format=${VERSION}${revision !== undefined ? `&revision=${revision}` : ""}`;
      const url = `${baseUrl}/documents/${encodeURIComponent(id)}/layout?${query}`;
      const label = `document ${id}${revision !== undefined ? ` at revision ${revision}` : ""}`;
      const { payload, fromCache } = await load(
        url,
        {
          headers: { "X-API-Key": options.apiKey },
          key: `id|${baseUrl}|${id}|${revision ?? "current"}|${VERSION}`,
          source: label,
          notFound: "not found (no such document or revision, or the key cannot read it)",
          immutable: revision !== undefined,
        },
        { ...options, signal: getOptions.signal ?? options.signal },
      );
      if (revision === undefined) {
        log({
          code: "revision_unpinned",
          message: `${label}: no revision given, got the current one (${payload.revision}). Pin { revision: ${payload.revision} } to always get this exact version.`,
          data: { id, revision: payload.revision },
        });
      }
      return finish(payload, fromCache, label, log);
    },
  };
}
