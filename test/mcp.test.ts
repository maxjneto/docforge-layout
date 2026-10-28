import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine";
import { AGENT_GUIDE } from "../src/mcp/guide";
import { createMcpHandler } from "../src/mcp/server";
import { createNodeRegistry } from "../src/node";
import { parseOp } from "../src/ops/schema";
import { ComponentSchema } from "../src/schema/components";
import { LIB_VERSION } from "../src/version";
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

  it("reports the package version and serves the guide as a tool too (clients that cannot read resources)", async () => {
    const { call, tool } = server();
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(LIB_VERSION).toBe(pkg.version);
    const init = await call("initialize", { protocolVersion: "2025-06-18" });
    expect(init.result).toMatchObject({ serverInfo: { version: pkg.version } });
    expect(String(init.result?.instructions)).toMatch(/get_layout_guide/);
    expect((await call("tools/list")).result?.tools?.map((t) => t.name)).toContain("get_layout_guide");
    expect((await tool("get_layout_guide", {})).text).toBe(AGENT_GUIDE);
  });

  it("measures several components in one call", async () => {
    const { tool } = server();
    const kpi = (id: string) => ({ id, type: "kpi", content: { value: "1", label: id } });
    const both = await tool("measure_component", { components: [kpi("a"), kpi("b")], widths: [20] });
    expect(both.isError).toBe(false);
    expect(both.text).toMatch(/^a · kpi/m);
    expect(both.text).toMatch(/^b · kpi/m);
    expect((await tool("measure_component", { widths: [20] })).isError).toBe(true);
  });

  it("every component example in the guide is valid", () => {
    const examples = AGENT_GUIDE.split(/\r?\n/).filter((line) => line.startsWith('{"type"'));
    expect(examples.length).toBeGreaterThanOrEqual(10);
    for (const line of examples) {
      const parsed = ComponentSchema.safeParse({ id: "x", ...JSON.parse(line) });
      expect(parsed.success, `${line} → ${parsed.success ? "" : parsed.error.message}`).toBe(true);
    }
  });

  it("every complete op example in the guide is valid", () => {
    const examples = AGENT_GUIDE.split(/\r?\n/).filter((line) => line.startsWith('{"op"') && !line.includes("...") && !line.includes(" | "));
    expect(examples.some((line) => line.includes('"move"'))).toBe(true);
    for (const line of examples) {
      const parsed = parseOp(JSON.parse(line));
      expect(parsed.ok, `${line} → ${parsed.ok ? "" : parsed.message}`).toBe(true);
    }
  });

  it("builds a page in one apply_layout_ops, the way the guide says", async () => {
    const { tool } = server();
    await tool("create_layout_document", { path: "one.docforge.json", title: "One" });
    const kpi = (id: string, value: string) => ({ id, type: "kpi", content: { value, label: id } });
    const ops = [
      { op: "add", component: { id: "title", type: "text", content: { paragraphs: [{ role: "title-1", text: "Relatório" }] } }, at: { page: 1, y: 0, cols: [1, 12] } },
      { op: "row", below: "title", items: [kpi("k1", "28"), kpi("k2", "5"), kpi("k3", "+125%")] },
      { op: "add", component: { id: "body", type: "text", content: { paragraphs: ["Um parágrafo."] } }, at: { below: "k1", cols: [1, 12] } },
      { op: "add", component: { id: "t", type: "table", content: { columns: ["Área", "Linhas"], rows: [["frontend", "20 323"]] } }, at: { below: "body", cols: [1, 12] } },
    ];
    const applied = await tool("apply_layout_ops", { path: "one.docforge.json", ops });
    expect(applied.text).toMatch(/^Saved/);
    expect(applied.text).toMatch(/problems: none/);

    await tool("create_layout_document", { path: "deck.docforge.json", title: "Deck" });
    const slides = await tool("apply_layout_ops", {
      path: "deck.docforge.json",
      ops: [
        { op: "setSurface", surface: { id: "a4", kind: "page", size: "Slide", margin: 48 } },
        { op: "add", component: { id: "s1", type: "text", content: { paragraphs: [{ role: "title-1", text: "Slide 1" }] } }, at: { page: 1, y: 0, cols: [1, 12] } },
        { op: "add", component: { id: "s2", type: "text", content: { paragraphs: [{ role: "title-1", text: "Slide 2" }] } }, at: { page: 2, y: 0, cols: [1, 12] } },
      ],
    });
    expect(slides.text).toMatch(/^Saved/);
    expect((await tool("get_layout_map", { path: "deck.docforge.json", level: 0 })).text).toMatch(/page 2: s2/);
  });

  it("puts @font-face in rendered HTML only when the registry has file URLs", () => {
    const page = { format: "docforge/layout", version: 3, surfaces: [{ id: "a4", kind: "page", size: "A4", margin: 40 }], components: [{ id: "t", type: "text", content: { paragraphs: ["Olá"] }, at: { page: 1, x: 0, y: 0, w: 40 } }] };
    const local = createEngine({ registry: createNodeRegistry({ fileUrls: true }) }).render(page).page;
    expect(local).toMatch(/@font-face\{font-family:"DFL Inter";src:url\("file:\/\//);
    expect(engine.render(page).page).not.toMatch(/@font-face/);
  });

  it("undoes changes step by step from the history, and an undo can itself be followed by new writes", async () => {
    const { root, tool } = server();
    const path = "u.docforge.json";
    const file = join(root, path);
    const ids = () => (JSON.parse(readFileSync(file, "utf8")) as { components: { id: string }[] }).components.map((c) => c.id);
    const add = (id: string) => ({ op: "add", component: { id, type: "text", content: { paragraphs: [id] } }, at: { page: 1, y: 0, cols: [1, 12] } });
    await tool("create_layout_document", { path });
    await tool("apply_layout_ops", { path, ops: [add("a")] });
    await tool("apply_layout_ops", { path, ops: [add("b")] });
    expect(ids()).toEqual(["a", "b"]);

    const first = await tool("undo_layout_change", { path });
    expect(first.isError).toBe(false);
    expect(first.text).toMatch(/^Undid 1 change: u\.docforge\.json is back/);
    expect(first.text).toMatch(/Gone: b\./);
    expect(ids()).toEqual(["a"]);
    expect((await tool("undo_layout_change", { path })).text).toMatch(/Gone: a\./);
    expect(ids()).toEqual([]);
    expect((await tool("undo_layout_change", { path })).text).toMatch(/Nothing to undo/);
    expect(readdirSync(join(root, ".docforge-history", "u")).filter((n) => n.endsWith(".undone.json"))).toHaveLength(2);

    // A new write after undoing: one undo goes back to where that write started.
    await tool("apply_layout_ops", { path, ops: [add("c")] });
    expect(ids()).toEqual(["c"]);
    await tool("undo_layout_change", { path });
    expect(ids()).toEqual([]);

    await tool("apply_layout_ops", { path, ops: [add("d")] });
    await tool("apply_layout_ops", { path, ops: [add("e")] });
    expect((await tool("undo_layout_change", { path, steps: 2 })).text).toMatch(/^Undid 2 changes/);
    expect(ids()).toEqual([]);
    expect((await tool("undo_layout_change", { path, steps: 50 })).isError).toBe(true);
  });
});
