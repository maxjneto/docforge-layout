import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLayoutServer } from "../src/server";
import { at, doc, engine } from "./helpers";

const base = () => doc({ components: [{ id: "t", type: "text", content: { paragraphs: ["Hello"] }, at: at(0, 0, 87) }] });

const server = createLayoutServer({ engine, maxBodyBytes: 100_000, onError: () => {} });
let url = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function post(path: string, body: unknown) {
  const res = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { diagnostics?: { code: string; message: string }[] } };
}

describe("HTTP server", () => {
  it("reports health", async () => {
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("validates and returns the level-1 map", async () => {
    const { body } = await post("/validate", { doc: base() });
    expect(body.ok).toBe(true);
    expect(body.pages).toBe(1);
    expect(body.map).toMatch(/\+-t-+\+/);
  });

  it("applies operations", async () => {
    const { body } = await post("/apply", {
      doc: base(),
      ops: [{ op: "add", component: { id: "k", type: "kpi", content: { value: "42", label: "Answer" } }, at: { below: "t", cols: [1, 4] } }],
    });
    expect(body.ok).toBe(true);
    expect(body.map).toMatch(/\n {2}k +kpi +0 +\d+ +28 /);
    expect(body.changes).toEqual([]);
  });

  it("turns a malformed op into an invalid-op diagnostic naming the field", async () => {
    const { status, body } = await post("/apply", { doc: base(), ops: [{ op: "add", component: { id: "x", type: "text", content: { paragraphs: ["x"] } } }] });
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.diagnostics?.[0]?.code).toBe("invalid-op");
    expect(body.diagnostics?.[0]?.message).toContain("at:");
  });

  it("returns maps and rendered pages", async () => {
    expect((await post("/map", { doc: base(), level: 0 })).body.text).toMatch(/page 1: t/);
    const rendered = await post("/render", { doc: base(), grid: true });
    expect(rendered.body.pages).toBe(1);
    expect(String(rendered.body.page)).toMatch(/^<!doctype html>/);
  });

  it("measures a component, finds components and diffs two versions", async () => {
    const measured = await post("/measure", { component: { id: "x", type: "text", content: { paragraphs: ["Hello world"] } }, widths: [10, 40], cols: [[1, 6]] });
    expect(measured.body.ok).toBe(true);
    expect((measured.body.measurements as unknown[]).length).toBe(3);
    expect(String(measured.body.text)).toMatch(/w 10 \(w 10, 80px\): needs \d+px = \d+ rows/);

    const found = await post("/find", { doc: base(), query: { text: "hello" } });
    expect((found.body.matches as { id: string }[]).map((m) => m.id)).toEqual(["t"]);

    const grown = doc({
      components: [
        { id: "t", type: "text", content: { paragraphs: ["Hello", "more", "and more"] }, at: at(0, 0, 87) },
        { id: "u", type: "text", content: { paragraphs: ["below"] }, at: at(0, 4, 87) },
      ],
    });
    const before = doc({ components: [{ id: "t", type: "text", content: { paragraphs: ["Hello"] }, at: at(0, 0, 87) }, { id: "u", type: "text", content: { paragraphs: ["below"] }, at: at(0, 4, 87) }] });
    const diff = await post("/diff", { before, after: grown, touched: ["t"] });
    expect((diff.body.changes as { code: string; component: string }[])[0]).toMatchObject({ code: "moved", component: "u" });
  });

  it("locates anchors and validates without refusing layout problems", async () => {
    const located = await post("/locate", { doc: base(), anchors: [{ component: "t" }, { rect: { page: 1, x: 0, y: 0, w: 5, h: 5 } }, { component: "gone" }] });
    const anchors = located.body.anchors as { text: string; under: string[] }[];
    expect(anchors[0]?.text).toMatch(/^t is at p1 x0 y0 w87 h\d+$/);
    expect(anchors[1]?.under).toEqual(["t"]);
    expect(anchors[2]?.text).toBe("gone is no longer in the document");
    const kpi = doc({ components: [{ id: "k", type: "kpi", content: { value: "R$ 1.234.567.890.123,45", label: "x" }, at: at(0, 0, 3) }] });
    const valid = await post("/validate", { doc: kpi });
    expect(valid.body.ok).toBe(true);
    expect(valid.body.diagnostics?.some((d) => d.code === "kpi-value-too-wide")).toBe(true);
  });

  it("upgrades a version 1 document", async () => {
    const v1 = {
      format: "docforge/layout",
      version: 1,
      surfaces: [{ id: "a4", kind: "page", size: "A4", margin: 48 }],
      sections: [{ id: "s", bands: [{ id: "b", span: "auto", items: [{ component: "t", colStart: 1, colSpan: 6 }] }] }],
      components: [{ id: "t", type: "text", content: { paragraphs: ["Hello"] } }],
    };
    const { body } = await post("/upgrade", { doc: v1 });
    expect(body.ok).toBe(true);
    expect((body.doc as { version: number; components: { at: unknown }[] }).components[0]?.at).toEqual({ page: 1, x: 0, y: 0, w: 43 });
  });

  it("rejects bad requests", async () => {
    expect((await post("/validate", "not json")).status).toBe(400);
    expect((await post("/validate", {})).status).toBe(400);
    expect((await post("/apply", { doc: base(), ops: [] })).status).toBe(400);
    expect((await post("/map", { doc: base(), level: 7 })).status).toBe(400);
    expect((await post("/map", { doc: base(), pages: [0] })).status).toBe(400);
    expect((await post("/measure", { component: "x" })).status).toBe(400);
    expect((await post("/find", { doc: base() })).status).toBe(400);
    expect((await post("/nope", {})).status).toBe(404);
    expect((await post("/validate", { doc: { pad: "x".repeat(120_000) } })).status).toBe(413);
  });
});
