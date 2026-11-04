import { describe, expect, it } from "vitest";
import { renderLayout, type LayoutDocument } from "../src";
import { paragraphOf } from "../src/components/flow";
import { defaultTokens } from "../src/schema/tokens";
import { doc, engine, lorem, registry } from "./helpers";

const flow = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({
  id: "body",
  type: "flow",
  at: { page: 1, x: 0, y: 0, w: 87 },
  content: { blocks },
  ...extra,
});

const table = (rows: number) => ({
  type: "table",
  content: { columns: ["Campo", "Descrição"], rows: Array.from({ length: rows }, (_, i) => [`campo_${i + 1}`, lorem.slice(0, 60)]) },
});

describe("flow", () => {
  it("reads markdown-like prefixes on string blocks", () => {
    expect(paragraphOf("# Título")).toEqual({ role: "title-1", text: "Título" });
    expect(paragraphOf("### Três")).toEqual({ role: "title-3", text: "Três" });
    expect(paragraphOf("> Citação")).toEqual({ role: "quote", text: "Citação" });
    expect(paragraphOf("#hashtag")).toEqual({ role: "body", text: "#hashtag" });
  });

  it("stacks blocks in order with the styles of their own types", () => {
    const d = doc({
      components: [flow(["# Introdução", lorem, { type: "list", content: { items: ["um", "dois"] } }, { type: "code", content: { code: "x = 1" } }])],
      styles: { document: { "text.title-1": { color: "$color.primary" } } },
    });
    const r = engine.layout(d);
    expect(r.diagnostics.filter((x) => x.severity !== "info")).toEqual([]);
    const html = renderLayout(r, registry).html;
    // Title color from the document layer, code background from the code preset.
    expect(html).toContain(`color:${defaultTokens.color.primary}`);
    expect(html).toContain(`background:${defaultTokens.color.subtle}`);
    // Order: title, paragraph, list, code.
    const order = ["Introdução", "O documento", "dois", "x = 1"].map((t) => html.indexOf(t));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Real headings for screen readers.
    expect(html).toContain("<h1>Introdução</h1>");
    expect(r.components.body?.facts).toMatchObject({ blocks: 4, headings: 1 });
  });

  it("splits across pages and repeats a table's header on the next page", () => {
    const r = engine.layout(doc({ components: [flow(["# Referência", table(60)])] }));
    const g = r.components.body;
    expect(g?.pages.length).toBeGreaterThan(1);
    const second = r.pages[1]?.boxes.find((b) => b.component === "body")?.html ?? "";
    expect(second).toContain('data-part="header"');
    expect(second).toContain("Descrição");
  });

  it("starts a new page at a break block", () => {
    const r = engine.layout(doc({ components: [flow(["# Um", "texto curto", { type: "break" }, "# Dois", "mais texto"])] }));
    expect(r.components.body?.pages).toEqual([0, 1]);
    const second = r.pages[1]?.boxes[0]?.html ?? "";
    expect(second).toContain("Dois");
    expect(second).not.toContain("Um");
    // On a continuous surface a break does nothing.
    const cont = engine.layout(
      doc({ surfaces: [{ id: "web", kind: "continuous", width: 800, margin: 24 }], components: [flow(["# Um", { type: "break" }, "# Dois"])] }),
    );
    expect(cont.pages).toHaveLength(1);
  });

  it("gives area blocks their h and keeps boxed blocks whole", () => {
    const chart = { type: "chart", h: 20, content: { kind: "bar", categories: ["a", "b"], series: [{ name: "s", values: [1, 2] }] } };
    const r = engine.layout(doc({ components: [flow([chart])] }));
    // 20 rows of chart, nothing else.
    expect(r.components.body?.box.h).toBe(20);
  });

  it("makes block ids link targets and refuses ids used twice", () => {
    const ok = engine.layout(
      doc({ components: [flow(["Veja o [anexo](#anexo).", { type: "break" }, { id: "anexo", type: "text", content: { paragraphs: ["Anexo"] } }])] }),
    );
    expect(ok.diagnostics.filter((d) => d.code === "unknown-link-target")).toEqual([]);
    expect(renderLayout(ok, registry).html).toContain('id="dfl-anexo"');

    const twice = engine.layout(doc({ components: [flow([{ id: "body", type: "divider" }])] }));
    expect(twice.diagnostics.find((d) => d.code === "duplicate-id")?.severity).toBe("error");
  });

  it("names the block in a block's diagnostics", () => {
    const r = engine.layout(doc({ components: [flow(["ok", { type: "table", content: { columns: ["a", "b"], rows: [["só uma"]] } }])] }));
    const d = r.diagnostics.find((x) => x.code === "table-row-length");
    expect(d?.message).toMatch(/^Block 2 \(table\):/);
    expect(d?.component).toBe("body");
  });

  it("is edited block by block: insert, set and remove by position", () => {
    const base = doc({ components: [flow(["# A", "a", "# C", "c"])] }) as unknown as LayoutDocument;
    const r = engine.apply(base, [{ op: "edit", component: "body", insert: { "blocks.2": ["# B", "b"] }, remove: ["blocks.3"], set: { "blocks.1": "a!" } }]);
    expect(r.ok).toBe(true);
    const blocks = (r.doc?.components[0] as { content: { blocks: unknown[] } }).content.blocks;
    expect(blocks).toEqual(["# A", "a!", "# B", "b", "# C"]);
  });

  it("replaceText leaves block types, ids and props alone", () => {
    const base = doc({ components: [flow(["a table here", { id: "table-1", type: "table", content: { columns: ["table"], rows: [["x"]] }, props: { columnWidths: "auto" } }])] });
    const r = engine.apply(base as unknown as LayoutDocument, [{ op: "replaceText", find: "table", replace: "tabela" }]);
    expect(r.ok).toBe(true);
    const blocks = (r.doc?.components[0] as { content: { blocks: Record<string, unknown>[] } }).content.blocks;
    expect(blocks[0]).toBe("a tabela here");
    expect(blocks[1]).toMatchObject({ id: "table-1", type: "table", content: { columns: ["tabela"] }, props: { columnWidths: "auto" } });
  });

  it("never leaves a title alone at the bottom of a page", () => {
    // Slide the title down a line at a time: wherever the page break falls, it moves on with its text.
    for (let k = 90; k < 120; k++) {
      const blocks = [...Array.from({ length: k }, (_, i) => `linha ${i}`), "## Seção", "primeira linha da seção"];
      const r = engine.layout(doc({ components: [flow(blocks)] }));
      for (const page of r.pages) {
        const box = page.boxes.find((b) => b.component === "body")?.html ?? "";
        const title = box.lastIndexOf('data-part="title-2"');
        if (title >= 0) expect(box.indexOf("primeira linha", title), `k=${k}`).toBeGreaterThan(title);
      }
    }
  });

  it("describes itself in one line for the map", () => {
    const r = engine.map(doc({ components: [flow(["# Intro", "texto", table(2)])] }), { level: 1 });
    expect(r.text).toMatch(/flow 3 blocks \(1 text, 1 table\): "Intro"/);
  });
});
