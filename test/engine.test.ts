import { describe, expect, it } from "vitest";
import { at, doc, engine, example, lorem } from "./helpers";

const codes = (d: { code: string }[]) => d.map((x) => x.code);
const text = (id: string, paragraphs: unknown[], position: ReturnType<typeof at>) => ({ id, type: "text", content: { paragraphs }, at: position });

describe("layout engine", () => {
  it("lays the examples out without errors on both surfaces", () => {
    for (const name of ["relatorio", "one-pager", "proposta"]) {
      for (const surfaceId of ["a4", "continua"]) {
        const r = engine.layout(example(name), surfaceId);
        expect(r.ok).toBe(true);
        expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      }
    }
  });

  it("reports schema problems instead of throwing, and points version 1 at upgradeDocument", () => {
    const r = engine.layout({ format: "docforge/layout", version: 1, surfaces: [], sections: [], components: [] });
    expect(r.ok).toBe(false);
    expect(codes(r.diagnostics)).toContain("schema");
    expect(r.diagnostics.some((d) => d.message.includes("upgradeDocument"))).toBe(true);
  });

  it("measures the content area in whole units and snaps guides to units", () => {
    const r = engine.layout(doc({ components: [] }));
    expect(r.units).toEqual({ cols: 87, rows: 128 });
    expect(r.guides).toHaveLength(12);
    expect(r.guides[0]).toMatchObject({ col: 1, x: 0 });
    expect((r.guides[11]?.x ?? 0) + (r.guides[11]?.w ?? 0)).toBe(87);
    for (const g of r.guides) expect(Number.isInteger(g.x) && Number.isInteger(g.w)).toBe(true);
  });

  it("draws a component at its declared position, in px", () => {
    const r = engine.layout(doc({ components: [text("t", ["olá"], at(10, 5, 30))] }));
    const box = r.pages[0]?.boxes[0];
    expect(box).toMatchObject({ component: "t", x: 48 + 80, y: 48 + 40, width: 240 });
    expect(r.components.t?.box).toMatchObject({ page: 1, x: 10, y: 5, w: 30 });
    expect(r.components.t?.shifted).toBe(0);
  });

  it("grows a box past its declared h when the content needs it", () => {
    const r = engine.layout(doc({ components: [text("t", [lorem, lorem], at(0, 0, 40, 4))] }));
    const g = r.components.t;
    expect(g?.grew).toBeGreaterThan(0);
    expect(g?.box.h).toBe(4 + (g?.grew ?? 0));
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("keeps a declared h taller than the content", () => {
    const r = engine.layout(doc({ components: [text("t", ["curto"], at(0, 0, 40, 30))] }));
    expect(r.components.t?.box.h).toBe(30);
    expect(r.components.t?.grew).toBe(0);
  });

  it("pushes only what a growing box invades, in a chain, and leaves the rest alone", () => {
    const r = engine.layout(
      doc({
        components: [
          text("a", [lorem, lorem, lorem], at(0, 0, 40, 4)),
          text("b", ["b"], at(0, 8, 40, 4)), // under a: pushed
          text("c", ["c"], at(0, 14, 40, 4)), // under b: pushed by b
          text("side", ["side"], at(45, 8, 40, 4)), // other columns: stays
        ],
      }),
    );
    const { a, b, c, side } = r.components;
    expect(b?.box.y).toBe((a?.box.y ?? 0) + (a?.box.h ?? 0) + 2);
    expect(b?.pushedBy).toBe("a");
    expect(c?.box.y).toBe((b?.box.y ?? 0) + (b?.box.h ?? 0) + 2);
    expect(c?.pushedBy).toBe("b");
    expect(side?.box.y).toBe(8);
    expect(side?.shifted).toBe(0);
  });

  it("returns a pushed box to its place when what pushed it shrinks (nothing is stored)", () => {
    const tall = doc({ components: [text("a", [lorem, lorem, lorem], at(0, 0, 40, 4)), text("b", ["b"], at(0, 8, 40, 4))] });
    expect(engine.layout(tall).components.b?.shifted).toBeGreaterThan(0);
    const short = doc({ components: [text("a", ["a"], at(0, 0, 40, 4)), text("b", ["b"], at(0, 8, 40, 4))] });
    expect(engine.layout(short).components.b?.box.y).toBe(8);
  });

  it("pushes a box declared on top of another below it", () => {
    const r = engine.layout(doc({ components: [text("a", ["a"], at(0, 0, 40, 10)), text("b", ["b"], at(20, 5, 40, 4))] }));
    expect(r.components.b?.box.y).toBe(12);
    expect(r.components.b?.pushedBy).toBe("a");
  });

  it("splits a long table across pages, repeats the header and pushes what it meets there", () => {
    const rows = Array.from({ length: 80 }, (_, i) => [`Linha ${i + 1}`, `${i * 3}`, `${i % 7}%`]);
    const r = engine.layout(
      doc({
        components: [
          { id: "tab", type: "table", content: { columns: ["Nome", "Valor", "Taxa"], rows }, at: at(0, 0, 87) },
          text("p2", ["na página 2"], at(0, 0, 87, 4, 2)),
        ],
      }),
    );
    const tab = r.components.tab;
    expect(tab?.pieces.length).toBeGreaterThan(1);
    const pieces = r.pages.flatMap((p) => p.boxes.filter((b) => b.component === "tab"));
    for (const piece of pieces) expect(piece.html).toContain(">Nome<");
    for (const page of r.pages) for (const b of page.boxes) expect(b.y + b.height).toBeLessThanOrEqual(page.height - 48 + 0.5);
    // p2 was declared at the top of page 2; the table fills pages 1–2 and part of 3, so p2 lands under its last piece.
    const last = tab?.pieces[tab.pieces.length - 1];
    expect(tab?.pieces.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(r.components.p2?.box).toMatchObject({ page: 3, y: (last?.y ?? 0) + (last?.h ?? 0) + 2 });
    expect(r.components.p2?.pushedBy).toBe("tab");
  });

  it("moves a box that crosses the bottom of the page, whole, to the next page", () => {
    const r = engine.layout(doc({ components: [{ id: "k", type: "kpi", content: { value: "1", label: "x" }, at: at(0, 120, 30, 20) }] }));
    expect(r.pages.length).toBe(2);
    expect(r.components.k?.box).toMatchObject({ page: 2, y: 0 });
    expect(r.components.k?.shifted).toBe(8);
    expect(r.components.k?.pushedBy).toBeUndefined();
  });

  it("reports a box taller than a page and cuts it", () => {
    const r = engine.layout(doc({ components: [{ id: "k", type: "kpi", content: { value: "1", label: "x" }, at: at(0, 0, 30, 200) }] }));
    expect(codes(r.diagnostics)).toContain("too-tall");
  });

  it("clamps a box wider than the page and says so", () => {
    const r = engine.layout(doc({ components: [text("t", ["x"], at(70, 0, 30))] }));
    expect(r.components.t?.box).toMatchObject({ x: 57, w: 30 });
    expect(r.components.t?.clamped).toBe(true);
    expect(codes(r.diagnostics)).toContain("out-of-page");
  });

  it("warns when the document goes past maxPages, without refusing it", () => {
    const r = engine.layout(
      doc({
        surfaces: [{ id: "a4", kind: "page", size: "A4", margin: 48, maxPages: 1 }],
        components: [text("a", ["a"], at(0, 0, 87)), text("b", ["b"], at(0, 0, 87, undefined, 2))],
      }),
    );
    expect(r.ok).toBe(true);
    const limit = r.diagnostics.find((d) => d.code === "page-limit");
    expect(limit?.severity).toBe("warning");
    expect(limit?.data).toMatchObject({ pages: 2, maxPages: 1 });
  });

  it("stacks declared pages on a continuous surface", () => {
    const d = doc({
      surfaces: [
        { id: "a4", kind: "page", size: "A4", margin: 48 },
        { id: "web", kind: "continuous", width: 800, margin: 48 },
      ],
      components: [text("a", ["a"], at(0, 0, 80)), text("b", ["b"], at(0, 0, 80, undefined, 2))],
    });
    const r = engine.layout(d, "web");
    expect(r.pages).toHaveLength(1);
    expect(r.components.b?.box.y).toBe(128);
    const last = Math.max(...(r.pages[0]?.boxes ?? []).map((b) => b.y + b.height));
    expect(r.pages[0]?.height).toBeCloseTo(last + 48, 5);
  });

  it("draws page 2 on page 1 when there is no paged surface, with a warning", () => {
    const r = engine.layout(
      doc({ surfaces: [{ id: "web", kind: "continuous", width: 800, margin: 48 }], components: [text("a", ["a"], at(0, 0, 80, undefined, 2))] }),
    );
    expect(codes(r.diagnostics)).toContain("unknown-page");
    expect(r.components.a?.box.page).toBe(1);
  });

  it("reports duplicate ids and unplaced components", () => {
    const r = engine.layout(doc({ components: [text("a", ["a"], at(0, 0, 10)), text("a", ["b"], at(0, 10, 10)), { id: "solto", type: "divider" }] }));
    expect(codes(r.diagnostics)).toEqual(expect.arrayContaining(["duplicate-id", "unplaced-component"]));
  });

  it("applies regions to components whose declared corner is inside them", () => {
    const r = engine.layout(
      doc({
        components: [text("a", ["a"], at(0, 0, 40)), text("b", ["b"], at(45, 0, 40))],
        styles: { regions: [{ id: "dir", x: 44, y: 0, w: 43, h: 20, style: { color: "$color.danger" } }] },
      }),
    );
    expect(r.components.b?.style.color.origin).toBe("region:dir");
    expect(r.components.a?.style.color.origin).toBe("preset");
  });

  it("renders print CSS and one div per page", () => {
    const { rendered, page } = engine.render(example("relatorio"), { surfaceId: "a4" });
    expect(rendered.css).toContain("@page{size:");
    expect((rendered.html.match(/class="dfl-page"/g) ?? []).length).toBe(rendered.pages);
    expect(page.startsWith("<!doctype html>")).toBe(true);
  });
});

describe("rendered HTML", () => {
  it("keeps every style attribute intact (no stray double quotes)", () => {
    for (const name of ["relatorio", "one-pager", "proposta"]) {
      const { rendered } = engine.render(example(name));
      const attributes = rendered.html.match(/style="[^"]*"/g) ?? [];
      expect(attributes.length).toBeGreaterThan(0);
      // After each closing quote of a style attribute comes a space or the end of the tag.
      expect(rendered.html.match(/style="[^"]*"[^\s>]/g)).toBeNull();
      expect(rendered.html).toContain("font-family:&#39;DFL Inter&#39;");
    }
  });
});

describe("grid overlay", () => {
  it("draws units, guides and component boxes only when asked, and never in print", () => {
    const plain = engine.render(example("relatorio"), { surfaceId: "a4" }).rendered;
    expect(plain.html).not.toContain("dfl-grid");
    const withGrid = engine.render(example("relatorio"), { surfaceId: "a4", grid: true }).rendered;
    expect((withGrid.html.match(/class="dfl-grid"/g) ?? []).length).toBe(withGrid.pages);
    expect((withGrid.html.match(/class="dfl-grid-col"/g) ?? []).length).toBe(12 * withGrid.pages);
    expect(withGrid.html).toMatch(/kpi-receita · x0 y\d+ w28 h16/);
    expect(withGrid.html).toContain("page 1 · 793.7×1122.5 · 87×128 units of 8px · 12 guides");
    expect(withGrid.css).toContain("@media print{.dfl-grid{display:none}");
  });
});
