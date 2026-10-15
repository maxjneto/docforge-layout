import { describe, expect, it } from "vitest";
import { at, doc, engine } from "./helpers";

const base = doc({
  components: [
    { id: "t", type: "text", content: { paragraphs: [{ role: "title-1", text: "Q3" }, "A receita cresceu no T2.", "Fim."] }, at: at(0, 0, 87) },
    {
      id: "tab",
      type: "table",
      content: { columns: ["Região", "Receita"], rows: [["Sul", "R$ 1 mi"], ["Norte", "R$ 2 mi"]] },
      at: at(0, 20, 87),
    },
    { id: "k", type: "kpi", content: { value: "42", label: "Clientes no T2" }, at: at(0, 40, 28, 14) },
  ],
});

const content = (d: unknown, id: string) => (d as { components: { id: string; content: unknown }[] }).components.find((c) => c.id === id)?.content;

describe("edit", () => {
  it("sets one paragraph, one cell and appends an item without touching the rest", () => {
    const r = engine.apply(base, [
      { op: "edit", component: "t", set: { "paragraphs.1": "A receita cresceu 18%." } },
      { op: "edit", component: "tab", set: { "rows.1.1": "R$ 2,5 mi", "rows.2": ["Leste", "R$ 3 mi"] } },
    ]);
    expect(r.ok).toBe(true);
    expect(content(r.doc, "t")).toEqual({ paragraphs: [{ role: "title-1", text: "Q3" }, "A receita cresceu 18%.", "Fim."] });
    expect(content(r.doc, "tab")).toMatchObject({ rows: [["Sul", "R$ 1 mi"], ["Norte", "R$ 2,5 mi"], ["Leste", "R$ 3 mi"]] });
  });

  it("treats .text on a plain-string paragraph as the paragraph", () => {
    const r = engine.apply(base, [{ op: "edit", component: "t", set: { "paragraphs.2.text": "Até logo." } }]);
    expect((content(r.doc, "t") as { paragraphs: unknown[] }).paragraphs[2]).toBe("Até logo.");
  });

  it("removes list items from the end first, so several indexes work together", () => {
    const r = engine.apply(base, [{ op: "edit", component: "t", remove: ["paragraphs.1", "paragraphs.2"] }]);
    expect(content(r.doc, "t")).toEqual({ paragraphs: [{ role: "title-1", text: "Q3" }] });
  });

  it("refuses a path that points nowhere, and saves nothing", () => {
    const r = engine.apply(base, [{ op: "edit", component: "t", set: { "paragraphs.9": "x" } }]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.message).toMatch(/past the end/);
    expect(engine.apply(base, [{ op: "edit", component: "t" }]).ok).toBe(false);
  });
});

describe("replaceText", () => {
  it("replaces in every text, but not in urls or enums", () => {
    const r = engine.apply(base, [{ op: "replaceText", find: "T2", replace: "2º tri" }]);
    expect(r.ok).toBe(true);
    expect((content(r.doc, "t") as { paragraphs: unknown[] }).paragraphs[1]).toBe("A receita cresceu no 2º tri.");
    expect((content(r.doc, "k") as { label: string }).label).toBe("Clientes no 2º tri");
    expect(r.diagnostics.find((d) => d.code === "text-replaced")?.message).toMatch(/2× in t, k/);
  });

  it("can be limited to components and ignore case", () => {
    const r = engine.apply(base, [{ op: "replaceText", find: "t2", replace: "Q2", components: ["k"], matchCase: false }]);
    expect((content(r.doc, "k") as { label: string }).label).toBe("Clientes no Q2");
    expect((content(r.doc, "t") as { paragraphs: unknown[] }).paragraphs[1]).toBe("A receita cresceu no T2.");
  });

  it("refuses when nothing matches", () => {
    const r = engine.apply(base, [{ op: "replaceText", find: "inexistente", replace: "x" }]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.message).toMatch(/not found/);
  });
});

describe("summary", () => {
  it("says what the op changed, what moved on its own and how full the pages are", () => {
    const r = engine.apply(base, [{ op: "place", component: "t", at: { h: 30 } }]);
    expect(r.summary).toMatch(/you changed\n {2}t +p1 x0 y0 w87 h\d+ → h30/);
    expect(r.summary).toMatch(/it moved on its own\n {2}tab +↓\d+ \(pushed by t\)/);
    expect(r.summary).toMatch(/problems: none/);
    expect(r.summary).toMatch(/pages: 1 · p1 \d+ free rows/);
    expect(r.summary.length).toBeLessThan(r.map.length / 3);
  });

  it("names added and removed components and lists problems", () => {
    const r = engine.apply(base, [
      { op: "add", component: { id: "n", type: "kpi", content: { value: "61", label: "NPS" } }, at: { below: "k", w: 20, h: 12 } },
      { op: "remove", component: "tab" },
    ]);
    expect(r.summary).toMatch(/n +added at p1 x0 y\d+ w20 h\d+/);
    expect(r.summary).toMatch(/tab +removed/);
  });
});
