import { describe, expect, it } from "vitest";
import { downgradeDocument, renderLayout } from "../src";
import { defaultTokens } from "../src/schema/tokens";
import { at, doc, engine, lorem, registry, single } from "./helpers";

const codes = (r: ReturnType<typeof engine.layout>) => r.diagnostics.filter((d) => d.severity !== "info").map((d) => d.code);
const html = (d: unknown) => renderLayout(engine.layout(d), registry).html;

describe("chart kinds and options", () => {
  const categorical = { categories: ["Jan", "Fev", "Mar", "Abr"], series: [{ name: "Receita", values: [10, 14, 9, 18] }, { name: "Custo", values: [6, 7, 8, 7] }] };

  it("draws every kind without problems at a normal size", () => {
    for (const kind of ["bar", "line", "area", "pie", "donut"]) {
      const r = engine.layout(single({ id: "c", type: "chart", content: { kind, ...categorical } }, 50, 30));
      expect(codes(r), kind).toEqual([]);
      expect(r.components.c?.facts.kind).toBe(kind);
    }
    const scatter = engine.layout(single({ id: "c", type: "chart", content: { kind: "scatter", series: [{ name: "Clientes", points: [[1, 2], [3, 5], [4, 1]] }] } }, 50, 30));
    expect(codes(scatter)).toEqual([]);
    expect(scatter.components.c?.facts).toMatchObject({ kind: "scatter", points: 3 });
  });

  it("refuses categories on a scatter chart and points on the others", () => {
    const bad = engine.layout(single({ id: "c", type: "chart", content: { kind: "scatter", categories: ["a"], series: [{ name: "s", points: [[1, 2]] }] } }, 50, 30));
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0]?.message).toMatch(/scatter chart has no categories/);
    const bar = engine.layout(single({ id: "c", type: "chart", content: { kind: "bar", categories: ["a"], series: [{ name: "s", points: [[1, 2]] }] } }, 50, 30));
    expect(bar.ok).toBe(false);
  });

  it("stacks, turns bars sideways and puts the legend on the right", () => {
    const names = Array.from({ length: 12 }, (_, i) => `Região administrativa número ${i + 1}`);
    const values = names.map((_, i) => i + 1);
    const r = engine.layout(
      single({ id: "c", type: "chart", content: { kind: "bar", categories: names, series: [{ name: "A", values }, { name: "B", values }] }, props: { orientation: "horizontal", stacked: true, legendPosition: "right" } }, 40),
    );
    expect(r.components.c?.facts).toMatchObject({ orientation: "horizontal", stacked: true });
    // The long names are cut at 40% of the width, and said so.
    expect(codes(r)).toContain("chart-labels-overlap");
    // Twelve categories ask for a taller natural size than a plain chart.
    expect(r.components.c?.natural).toBeGreaterThan(200);
  });

  it("warns about negatives in a stacked chart and values outside axis.min/max", () => {
    const neg = engine.layout(single({ id: "c", type: "chart", content: { kind: "bar", categories: ["a", "b"], series: [{ name: "s", values: [3, -2] }] }, props: { stacked: true } }, 50, 30));
    expect(codes(neg)).toContain("chart-stacked-negative");
    const cut = engine.layout(single({ id: "c", type: "chart", content: { kind: "line", ...categorical }, props: { axis: { min: 0, max: 12, x: "Mês", y: "R$ mil" } } }, 50, 30));
    expect(codes(cut)).toContain("chart-axis-range");
    const out = html(single({ id: "c", type: "chart", content: { kind: "line", ...categorical }, props: { axis: { x: "Mês", y: "R$ mil" } } }, 50, 30));
    expect(out).toContain("Mês");
    expect(out).toContain("rotate(-90");
  });

  it("uses the colors given, and the total in a donut's hole", () => {
    const out = html(single({ id: "c", type: "chart", content: { kind: "donut", categories: ["a", "b"], series: [{ name: "s", values: [30, 70] }] }, props: { colors: ["#123456", "$color.danger"] } }, 50, 30));
    expect(out).toContain('fill="#123456"');
    expect(out).toContain(`fill="${defaultTokens.color.danger}"`);
    expect(out).toContain(">100<");
  });
});

describe("callout", () => {
  it("grows with a title and takes the kind's color", () => {
    const plain = engine.layout(single({ id: "n", type: "callout", content: { text: lorem } }, 40));
    const titled = engine.layout(single({ id: "n", type: "callout", content: { title: "Atenção", text: lorem }, props: { kind: "warning" } }, 40));
    expect(codes(titled)).toEqual([]);
    expect(titled.components.n?.needed).toBeGreaterThan(plain.components.n?.needed as number);
    const out = renderLayout(titled, registry).html;
    expect(out).toContain(`background:${defaultTokens.color.warning}`);
    expect(out).toContain('<aside role="note"');
    expect(engine.layout(single({ id: "n", type: "callout", content: { text: "x" }, props: { kind: "danger" } })).ok).toBe(false);
  });
});

describe("tags", () => {
  it("wraps into rows and picks a readable text color on a colored tag", () => {
    const items = Array.from({ length: 30 }, (_, i) => `etiqueta ${i + 1}`);
    const r = engine.layout(single({ id: "t", type: "tags", content: { items } }, 24));
    expect((r.components.t?.facts as { rows: number }).rows).toBeGreaterThan(5);
    const out = html(single({ id: "t", type: "tags", content: { items: [{ text: "Pronto", color: "$color.primary" }] } }, 24));
    expect(out).toContain(`background:${defaultTokens.color.primary}`);
    expect(out).toContain(`color:${defaultTokens.color.surface}`);
  });

  it("cuts a tag wider than the component and says so", () => {
    const r = engine.layout(single({ id: "t", type: "tags", content: { items: ["uma etiqueta comprida demais para uma coluna estreita"] } }, 10));
    expect(codes(r)).toContain("tag-too-wide");
  });
});

describe("progress", () => {
  it("draws bars, stars and dots, and checks the range", () => {
    const items = [{ label: "TypeScript", value: 4.5, max: 5 }, { label: "Go", value: 2, max: 5, text: "básico" }];
    for (const kind of ["bar", "stars", "dots"]) {
      const r = engine.layout(single({ id: "p", type: "progress", content: { items }, props: { kind } }, 50));
      expect(codes(r), kind).toEqual([]);
    }
    const stars = html(single({ id: "p", type: "progress", content: { items: [{ label: "x", value: 7, max: 10 }] }, props: { kind: "stars" } }, 60));
    expect((stars.match(/<polygon/g) ?? []).length).toBe(10);
    const bad = engine.layout(single({ id: "p", type: "progress", content: { items: [{ label: "x", value: 120 }] } }, 50));
    expect(codes(bad)).toContain("progress-range");
  });

  it("splits between items across pages", () => {
    const items = Array.from({ length: 90 }, (_, i) => ({ label: `Item ${i}`, value: i }));
    const r = engine.layout(doc({ components: [{ id: "p", type: "progress", content: { items }, at: at(0, 0, 60) }] }));
    expect(r.components.p?.pages.length).toBeGreaterThan(1);
  });
});

describe("text display, image caption and figures, KPI sparkline", () => {
  it("draws the display role at the display size", () => {
    const out = html(single({ id: "d", type: "text", content: { paragraphs: [{ role: "display", text: "Grande" }] } }));
    expect(out).toContain(`font-size:${defaultTokens.size.display}px`);
  });

  it("numbers figures in reading order, not in the order they were written", () => {
    const image = (id: string, y: number) => ({
      id,
      type: "image",
      content: { src: "https://example.com/a.png", alt: id, width: 400, height: 200, caption: `Legenda ${id}` },
      props: { figure: true },
      at: at(0, y, 40),
    });
    const r = engine.layout({ ...doc({ components: [image("baixo", 60), image("cima", 0)] }), meta: { locale: "pt-BR" } });
    const out = renderLayout(r, registry).html;
    expect(out.indexOf("Figura 1: ")).toBeLessThan(out.indexOf("Figura 2: "));
    expect(out.indexOf("Legenda cima")).toBeLessThan(out.indexOf("Legenda baixo"));
    expect(out).not.toContain("Figura 99");
    // The caption counts in the natural height.
    expect(r.components.cima?.natural).toBeGreaterThan(Math.round((40 * 8 * 200) / 400));
  });

  it("numbers figures inside a flow too, and links an image", () => {
    const img = { type: "image", content: { src: "https://example.com/a.png", alt: "a", width: 400, height: 200 }, props: { figure: true, href: "https://example.com" } };
    const r = engine.layout(doc({ components: [{ id: "f", type: "flow", at: at(0, 0, 60), content: { blocks: ["Texto", img, "Mais", img] } }] }));
    const out = renderLayout(r, registry).html;
    expect(out).toContain("Figure 1");
    expect(out).toContain("Figure 2");
    expect(out).toContain('href="https://example.com"');
  });

  it("draws a sparkline when the KPI has room, and says when it does not", () => {
    const kpi = (h?: number) => single({ id: "k", type: "kpi", content: { value: "42", label: "NPS", trend: "up", sparkline: [1, 3, 2, 5, 8] } }, 20, h);
    expect(html(kpi())).toContain('data-part="sparkline"');
    expect(html(kpi())).toContain(`stroke="${defaultTokens.color.success}"`);
    const tight = engine.layout(kpi(10));
    expect(tight.diagnostics.find((d) => d.code === "sparkline-hidden")).toBeDefined();
  });
});

describe("format 4 → 3 for the new components", () => {
  it("converts each new type to the closest older one, with notes, into a document version 3 reads", () => {
    const d = doc({
      components: [
        { id: "c", type: "chart", content: { kind: "donut", categories: ["a"], series: [{ name: "s", values: [1] }] }, props: { center: "x" }, at: at(0, 0, 40, 20) },
        { id: "s", type: "chart", content: { kind: "scatter", series: [{ name: "s", points: [[2, 5], [1, 3]] }] }, at: at(0, 30, 40, 20) },
        { id: "n", type: "callout", content: { text: "cuidado" }, props: { kind: "warning" }, at: at(42, 0, 40) },
        { id: "t", type: "tags", content: { items: ["a", { text: "b", color: "#ff0000" }] }, at: at(42, 20, 40) },
        { id: "p", type: "progress", content: { items: [{ label: "x", value: 3, max: 5 }] }, props: { kind: "stars" }, at: at(42, 30, 40) },
        { id: "d", type: "text", content: { paragraphs: [{ role: "display", text: "Oi" }] }, at: at(42, 40, 40) },
        { id: "k", type: "kpi", content: { value: "1", label: "l", sparkline: [1, 2, 3] }, at: at(42, 60, 20, 10) },
        { id: "f", type: "flow", content: { blocks: ["# Título", "texto", { type: "break" }, { id: "nota", type: "callout", content: { text: "x" } }] }, at: at(0, 80, 87) },
      ],
    });
    const r = downgradeDocument(d, 3);
    expect(r.ok).toBe(true);
    const byId = Object.fromEntries((r.doc?.components as { id: string }[]).map((c) => [c.id, c]));
    expect(byId.c).toMatchObject({ type: "chart", content: { kind: "pie" }, props: {} });
    expect(byId.s).toMatchObject({ content: { kind: "bar", categories: ["1", "2"], series: [{ values: [3, 5] }] } });
    expect(byId.n).toMatchObject({ type: "card", content: { eyebrow: "Warning", title: "Warning", text: "cuidado" } });
    expect(byId.t).toMatchObject({ type: "text", content: { paragraphs: ["a · b"] } });
    expect(byId.p).toMatchObject({ type: "table", content: { rows: [["x", "3/5"]] } });
    expect(byId.d).toMatchObject({ content: { paragraphs: [{ role: "title-1", text: "Oi" }] } });
    expect(byId.k).not.toHaveProperty("content.sparkline");
    expect(byId["f-1"]).toMatchObject({ type: "text", content: { paragraphs: [{ role: "title-1", text: "Título" }, { text: "texto" }] }, at: { page: 1, x: 0, y: 80, w: 87 } });
    expect(byId.nota).toMatchObject({ type: "card" });
    expect(r.notes.join("\n")).toMatch(/flow became 2 components stacked at its position; 1 page break/);
    // Read back as version 3: valid, nothing broken.
    const back = engine.layout(r.doc);
    expect(back.ok).toBe(true);
    expect(back.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
  });
});
