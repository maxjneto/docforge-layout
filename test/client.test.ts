import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, DocForgeError, fetchPublished, memoryCache, parsePublicSource, type LogEntry } from "../src";
import { doc, at } from "./helpers";

const body = doc({ components: [{ id: "t", type: "text", content: { paragraphs: [{ text: "Olá" }] }, at: at(0, 0, 40) }] });
const payload = (extra: Record<string, unknown> = {}) => ({ title: "Anúncio", revision: 7, published_at: "2026-10-16T10:00:00Z", content: body, notes: [], ...extra });

function server(...answers: (Response | Error)[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
const logs = () => {
  const entries: LogEntry[] = [];
  return { entries, logger: (e: LogEntry) => void entries.push(e) };
};

afterEach(() => vi.unstubAllGlobals());

describe("parsePublicSource", () => {
  it("reads the page link, the API link and a bare token", () => {
    expect(parsePublicSource("https://doc-forge.dev/public/abc123")).toEqual({ baseUrl: "https://doc-forge.dev/api", token: "abc123" });
    expect(parsePublicSource("https://x.dev/api/public/abc123/layout")).toEqual({ baseUrl: "https://x.dev/api", token: "abc123" });
    expect(parsePublicSource("abc123", "http://localhost:8000/api/")).toEqual({ baseUrl: "http://localhost:8000/api", token: "abc123" });
    // An explicit address wins over the link's (frontend and API on different hosts).
    expect(parsePublicSource("http://localhost:5173/public/abc123", "http://localhost:8000/api")).toEqual({ baseUrl: "http://localhost:8000/api", token: "abc123" });
  });

  it("refuses something that is neither", () => {
    expect(() => parsePublicSource("https://doc-forge.dev/document/abc")).toThrow(DocForgeError);
    expect(() => parsePublicSource("a/b")).toThrow(DocForgeError);
  });
});

describe("fetchPublished", () => {
  it("asks for this library's format and returns the document", async () => {
    const s = server(json(payload()));
    const r = await fetchPublished("https://doc-forge.dev/public/tok", { fetch: s.fetch, cache: false });
    expect(s.calls[0]?.url).toBe("https://doc-forge.dev/api/public/tok/layout?format=3");
    expect(r).toMatchObject({ title: "Anúncio", revision: 7, publishedAt: "2026-10-16T10:00:00Z", fromCache: false, notes: [] });
    expect(r.doc.components[0]?.id).toBe("t");
  });

  it("logs what the server's conversion down lost", async () => {
    const s = server(json(payload({ notes: ["page \"deck\": the Slide size became 1280×720"] })));
    const { entries, logger } = logs();
    const r = await fetchPublished("tok", { fetch: s.fetch, cache: false, logger });
    expect(r.notes).toHaveLength(1);
    expect(entries.map((e) => e.code)).toEqual(["format_downgraded"]);
  });

  it("serves the last good copy when the server fails, and says so", async () => {
    const cache = memoryCache();
    const s = server(json(payload(), 200, { ETag: '"r7"' }), new Response("boom", { status: 502 }), new TypeError("fetch failed"));
    const { entries, logger } = logs();
    await fetchPublished("tok", { fetch: s.fetch, cache, logger });
    const second = await fetchPublished("tok", { fetch: s.fetch, cache, logger });
    const third = await fetchPublished("tok", { fetch: s.fetch, cache, logger });
    expect([second.fromCache, third.fromCache]).toEqual([true, true]);
    expect(entries.map((e) => e.code)).toEqual(["served_from_cache", "served_from_cache"]);
    expect(s.calls[1]?.headers["If-None-Match"]).toBe('"r7"');
  });

  it("uses the cached copy on 304", async () => {
    const cache = memoryCache();
    const s = server(json(payload(), 200, { ETag: '"r7"' }), new Response(null, { status: 304 }));
    await fetchPublished("tok", { fetch: s.fetch, cache });
    const again = await fetchPublished("tok", { fetch: s.fetch, cache });
    expect(again).toMatchObject({ revision: 7, fromCache: false });
  });

  it("does not hide an unpublished document behind the cache", async () => {
    const cache = memoryCache();
    const s = server(json(payload()), new Response(null, { status: 404 }));
    await fetchPublished("tok", { fetch: s.fetch, cache });
    await expect(fetchPublished("tok", { fetch: s.fetch, cache })).rejects.toMatchObject({ code: "not_found" });
  });

  it("fails without a copy when the server is down", async () => {
    const s = server(new TypeError("fetch failed"));
    await expect(fetchPublished("tok", { fetch: s.fetch, cache: false })).rejects.toMatchObject({ code: "network" });
  });

  it("refuses a document in a newer format", async () => {
    const s = server(json(payload({ content: { ...body, version: 9 } })));
    const { entries, logger } = logs();
    await expect(fetchPublished("tok", { fetch: s.fetch, cache: false, logger })).rejects.toMatchObject({ code: "invalid_document" });
    expect(entries.map((e) => e.code)).toEqual(["format_unsupported"]);
  });
});

describe("createClient", () => {
  it("refuses to run in a browser", () => {
    vi.stubGlobal("window", { document: {} });
    expect(() => createClient({ apiKey: "k" })).toThrow(/runs on a server/);
  });

  it("sends the key and the revision, and caches a pinned revision for good", async () => {
    const s = server(json(payload({ published_at: null })));
    const client = createClient({ apiKey: "df_key", baseUrl: "http://localhost:8000/api", fetch: s.fetch, cache: memoryCache(), logger: () => {} });
    const r = await client.get("doc-1", { revision: 7 });
    const again = await client.get("doc-1", { revision: 7 });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]?.url).toBe("http://localhost:8000/api/documents/doc-1/layout?format=3&revision=7");
    expect(s.calls[0]?.headers["X-API-Key"]).toBe("df_key");
    expect([r.revision, again.revision]).toEqual([7, 7]);
  });

  it("without a revision gets the current one and warns", async () => {
    const s = server(json(payload({ revision: 12 })));
    const { entries, logger } = logs();
    const r = await createClient({ apiKey: "k", fetch: s.fetch, cache: false, logger }).get("doc-1");
    expect(r.revision).toBe(12);
    expect(entries.map((e) => e.code)).toEqual(["revision_unpinned"]);
    expect(entries[0]?.message).toContain("{ revision: 12 }");
  });

  it("reports a refused key", async () => {
    const s = server(new Response(null, { status: 401 }));
    await expect(createClient({ apiKey: "bad", fetch: s.fetch, cache: false }).get("d", { revision: 1 })).rejects.toMatchObject({ code: "unauthorized" });
  });
});
