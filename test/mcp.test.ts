import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMcpHandler } from "../src/mcp/server";
import { engine } from "./helpers";

function server() {
  const root = mkdtempSync(join(tmpdir(), "dfl-mcp-"));
  const handle = createMcpHandler({ engine, root });
  let id = 0;
  const call = async (method: string, params: Record<string, unknown> = {}) => (await handle({ jsonrpc: "2.0", id: ++id, method, params })) as {
    result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[]; [k: string]: unknown };
    error?: { code: number; message: string };
  };
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await call("tools/call", { name, arguments: args });
    return { text: r.result?.content?.[0]?.text ?? "", isError: r.result?.isError === true };
  };
  return { root, handle, call, tool };
}

describe("stdio MCP server", () => {
  it("initializes, lists its tools and serves the guide", async () => {
    const { call, handle } = server();
    const init = await call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test" } });
    expect(init.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "docforge-layout" } });
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const names = (await call("tools/list")).result?.tools?.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["create_layout_document", "apply_layout_ops", "preview_layout", "measure_component", "calibrate_style", "render_layout"]));
    const guide = await call("resources/read", { uri: "docforge-layout://guide" });
    expect(JSON.stringify(guide.result)).toContain("Positions");
    expect((await call("nope")).error?.code).toBe(-32601);
  });

  it("creates a file, applies ops (keeping history), previews without saving and renders HTML", async () => {
    const { root, tool } = server();
    const created = await tool("create_layout_document", { path: "docs/q3.docforge.json", title: "Q3" });
    expect(created.isError).toBe(false);
    expect(created.text).toMatch(/Created docs\/q3\.docforge\.json/);
    const file = join(root, "docs", "q3.docforge.json");

    const add = { op: "add", component: { id: "t", type: "text", content: { paragraphs: ["Olá"] } }, at: { page: 1, cols: [1, 12], y: 0 } };
    const preview = await tool("preview_layout", { path: "docs/q3.docforge.json", ops: [add] });
    expect(preview.text).toMatch(/Preview \(nothing saved\)/);
    expect(JSON.parse(readFileSync(file, "utf8")).components).toEqual([]);

    const applied = await tool("apply_layout_ops", { path: "docs/q3.docforge.json", ops: [add] });
    expect(applied.text).toMatch(/^Saved docs\/q3\.docforge\.json/);
    expect(applied.text).toMatch(/you changed\n {2}t +added at p1 x0 y0 w\d+/);
    expect(applied.text).not.toMatch(/Map \(level 1\)/);
    const full = await tool("preview_layout", { path: "docs/q3.docforge.json", ops: [{ op: "edit", component: "t", set: { "paragraphs.0": "Oi" } }], map: "full" });
    expect(full.text).toMatch(/Map \(level 1\)/);
    expect(JSON.parse(readFileSync(file, "utf8")).components[0].id).toBe("t");
    expect(readdirSync(join(root, "docs", ".docforge-history", "q3"))).toHaveLength(1);

    const refused = await tool("apply_layout_ops", { path: "docs/q3.docforge.json", ops: [{ op: "remove", component: "nope" }] });
    expect(refused.text).toMatch(/^NOT saved/);

    expect((await tool("get_layout_map", { path: "docs/q3.docforge.json", level: 0 })).text).toMatch(/page 1: t/);
    expect((await tool("find_layout", { path: "docs/q3.docforge.json", text: "ola" })).text).toMatch(/1 match/);
    expect((await tool("calibrate_style", { path: "docs/q3.docforge.json", target: { component: "t" }, variants: [{ fontSize: "$size.xl" }] })).text).toMatch(/calibrating component t/);
    expect((await tool("measure_component", { component: { id: "x", type: "kpi", content: { value: "1", label: "y" } }, widths: [20] })).text).toMatch(/needs \d+px/);

    const rendered = await tool("render_layout", { path: "docs/q3.docforge.json" });
    expect(rendered.text).toMatch(/1 page/);
    expect(existsSync(join(root, "docs", "q3.html"))).toBe(true);
  });

  it("refuses paths outside its root and files that are not .docforge.json", async () => {
    const { tool } = server();
    expect((await tool("create_layout_document", { path: "../escape.docforge.json" })).isError).toBe(true);
    expect((await tool("create_layout_document", { path: "notes.txt" })).text).toMatch(/must end with \.docforge\.json/);
    expect((await tool("get_layout_map", { path: "missing.docforge.json" })).text).toMatch(/does not exist/);
  });
});
