import { describe, expect, it } from "vitest";
import { doc, engine, example, lorem } from "./helpers";

const codes = (d: { code: string }[]) => d.map((x) => x.code);

describe("layout engine", () => {
  it("lays the example out without errors on both surfaces", () => {
    for (const surfaceId of ["a4", "continua"]) {
      const r = engine.layout(example("relatorio"), surfaceId);
      expect(r.ok).toBe(true);
      expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    }
  });

  it("reports schema problems instead of throwing", () => {
    const r = engine.layout({ format: "docforge/layout", version: 1, surfaces: [], sections: [], components: [] });
    expect(r.ok).toBe(false);
    expect(codes(r.diagnostics)).toContain("schema");
  });

  it("detects overflow with the missing px and suggestions", () => {
    const d = doc({
      bands: [{ id: "b1", span: 4, items: [{ component: "t", colStart: 1, colSpan: 6 }] }],
      components: [{ id: "t", type: "text", content: { paragraphs: [lorem, lorem] } }],
    });
    const r = engine.layout(d);
    const overflow = r.diagnostics.find((x) => x.code === "overflow");
    expect(overflow?.component).toBe("t");
    expect(overflow?.data?.area).toBe(32);
    expect(Number(overflow?.data?.short)).toBeGreaterThan(0);
    expect(overflow?.suggestions?.[0]).toMatch(/span to \d+/);
    expect(r.components.t?.overflow).toBe(overflow?.data?.short);
  });

  it("auto bands grow to the tallest component, rounded to row units", () => {
    const d = doc({
      bands: [
        {
          id: "b1",
          span: "auto",
          items: [
            { component: "a", colStart: 1, colSpan: 6 },
            { component: "b", colStart: 7, colSpan: 6 },
          ],
        },
      ],
      components: [
        { id: "a", type: "text", content: { paragraphs: ["curto"] } },
        { id: "b", type: "text", content: { paragraphs: [lorem, lorem, lorem] } },
      ],
    });
    const r = engine.layout(d);
    const band = r.bands.b1;
    expect(band?.height).toBeGreaterThanOrEqual(r.components.b?.needed ?? 0);
    expect((band?.height ?? 0) % 8).toBe(0);
    expect(r.diagnostics.some((x) => x.code === "overflow")).toBe(false);
  });

  it("reports column overlap, out-of-range columns, unknown and unplaced components", () => {
    const d = doc({
      bands: [
        {
          id: "b1",
          span: "auto",
          items: [
            { component: "a", colStart: 1, colSpan: 7 },
            { component: "b", colStart: 7, colSpan: 8 },
            { component: "ghost", colStart: 1, colSpan: 1 },
          ],
        },
      ],
      components: [
        { id: "a", type: "text", content: { paragraphs: ["a"] } },
        { id: "b", type: "text", content: { paragraphs: ["b"] } },
        { id: "solto", type: "divider" },
      ],
    });
    const r = engine.layout(d);
    expect(codes(r.diagnostics)).toEqual(
      expect.arrayContaining(["column-overlap", "column-out-of-range", "unknown-component", "unplaced-component"]),
    );
  });

  it("splits a long table across pages and repeats the header", () => {
    const rows = Array.from({ length: 80 }, (_, i) => [`Linha ${i + 1}`, `${i * 3}`, `${i % 7}%`]);
    const d = doc({
      bands: [{ id: "b1", span: "auto", items: [{ component: "tab", colStart: 1, colSpan: 12 }] }],
      components: [{ id: "tab", type: "table", content: { columns: ["Nome", "Valor", "Taxa"], rows } }],
    });
    const r = engine.layout(d);
    expect(r.pages.length).toBeGreaterThan(1);
    const pieces = r.pages.flatMap((p) => p.boxes.filter((b) => b.component === "tab"));
    expect(pieces.length).toBe(r.pages.length);
    for (const piece of pieces) expect(piece.html).toContain(">Nome<");
    for (const page of r.pages) for (const b of page.boxes) expect(b.y + b.height).toBeLessThanOrEqual(page.height - 48 + 0.5);
    expect(r.components.tab?.pages.length).toBe(r.pages.length);
  });

  it("moves a band that does not fit to the next page", () => {
    const d = doc({
      bands: [
        { id: "alto", span: 120, items: [{ component: "a", colStart: 1, colSpan: 12 }] },
        {
          id: "seguinte",
          span: 20,
          items: [
            { component: "b", colStart: 1, colSpan: 6 },
            { component: "c", colStart: 7, colSpan: 6 },
          ],
        },
      ],
      components: [
        { id: "a", type: "divider", props: { kind: "space" } },
        { id: "b", type: "divider" },
        { id: "c", type: "divider" },
      ],
    });
    const r = engine.layout(d);
    expect(r.pages.length).toBe(2);
    expect(r.bands.seguinte?.pages).toEqual([1]);
    expect(r.pages[1]?.boxes[0]?.y).toBeCloseTo(48, 5);
  });

  it("reports a non-splittable band taller than the page", () => {
    const d = doc({
      bands: [
        {
          id: "enorme",
          span: 200,
          items: [
            { component: "a", colStart: 1, colSpan: 6 },
            { component: "b", colStart: 7, colSpan: 6 },
          ],
        },
      ],
      components: [
        { id: "a", type: "divider" },
        { id: "b", type: "divider" },
      ],
    });
    expect(codes(engine.layout(d).diagnostics)).toContain("band-too-tall");
  });

  it("continuous surfaces are one page as tall as the content", () => {
    const r = engine.layout(example("relatorio"), "continua");
    expect(r.pages).toHaveLength(1);
    const last = Math.max(...(r.pages[0]?.boxes ?? []).map((b) => b.y + b.height));
    expect(r.pages[0]?.height).toBeCloseTo(last + 48, 5);
  });

  it("applies regions only inside their grid area", () => {
    const d = doc({
      bands: [
        {
          id: "b1",
          span: "auto",
          items: [
            { component: "a", colStart: 1, colSpan: 6 },
            { component: "b", colStart: 7, colSpan: 6 },
          ],
        },
      ],
      components: [
        { id: "a", type: "text", content: { paragraphs: ["a"] } },
        { id: "b", type: "text", content: { paragraphs: ["b"] } },
      ],
      styles: { regions: [{ id: "dir", section: "s1", cols: [7, 12], style: { color: "$color.danger" } }] },
    });
    const r = engine.layout(d);
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
  it("draws columns, bands and component areas only when asked, and never in print", () => {
    const plain = engine.render(example("relatorio"), { surfaceId: "a4" }).rendered;
    expect(plain.html).not.toContain("dfl-grid");
    const withGrid = engine.render(example("relatorio"), { surfaceId: "a4", grid: true }).rendered;
    expect((withGrid.html.match(/class="dfl-grid"/g) ?? []).length).toBe(withGrid.pages);
    expect((withGrid.html.match(/class="dfl-grid-col"/g) ?? []).length).toBe(12 * withGrid.pages);
    expect(withGrid.html).toContain("s-capa · r-kpis · 16 rows · 128px");
    expect(withGrid.html).toMatch(/kpi-receita · 1–4 · [\d.]+×128/);
    expect(withGrid.html).toMatch(/page 793\.7×1122\.5 · content 697\.7×1026\.5 · col [\d.]+ · gap 16 · row 8/);
    expect(withGrid.css).toContain("@media print{.dfl-grid{display:none}");
  });
});
