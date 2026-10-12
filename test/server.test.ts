import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLayoutServer } from "../src/server";
import { doc, engine } from "./helpers";

const base = () =>
  doc({
    bands: [{ id: "b-1", span: "auto", items: [{ component: "t", colStart: 1, colSpan: 12 }] }],
    components: [{ id: "t", type: "text", content: { paragraphs: ["Hello"] } }],
  });

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
    expect(body.map).toMatch(/b-1/);
  });

  it("applies operations", async () => {
    const { body } = await post("/apply", {
      doc: base(),
      ops: [{ op: "add", component: { id: "k", type: "kpi", content: { value: "42", label: "Answer" } }, at: { section: "s1", band: "b-2", colStart: 1, colSpan: 4, newBand: { span: "auto" } } }],
    });
    expect(body.ok).toBe(true);
    expect(body.map).toMatch(/k kpi 1-4/);
  });

  it("turns a malformed op into an invalid-op diagnostic naming the field", async () => {
    const { status, body } = await post("/apply", { doc: base(), ops: [{ op: "add", component: { id: "x", type: "text", content: { paragraphs: ["x"] } } }] });
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.diagnostics?.[0]?.code).toBe("invalid-op");
    expect(body.diagnostics?.[0]?.message).toContain("at:");
  });

  it("returns maps and rendered pages", async () => {
    expect((await post("/map", { doc: base(), level: 0 })).body.text).toMatch(/sections:/);
    const rendered = await post("/render", { doc: base(), grid: true });
    expect(rendered.body.pages).toBe(1);
    expect(String(rendered.body.page)).toMatch(/^<!doctype html>/);
  });

  it("rejects bad requests", async () => {
    expect((await post("/validate", "not json")).status).toBe(400);
    expect((await post("/validate", {})).status).toBe(400);
    expect((await post("/apply", { doc: base(), ops: [] })).status).toBe(400);
    expect((await post("/map", { doc: base(), level: 7 })).status).toBe(400);
    expect((await post("/nope", {})).status).toBe(404);
    expect((await post("/validate", { doc: { pad: "x".repeat(120_000) } })).status).toBe(413);
  });
});
