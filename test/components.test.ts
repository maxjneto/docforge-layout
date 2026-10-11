import { describe, expect, it } from "vitest";
import { doc, engine } from "./helpers";

const one = (component: unknown, colSpan = 12, span: number | "auto" = "auto") =>
  engine.layout(doc({ bands: [{ id: "b1", span, items: [{ component: "c", colStart: 1, colSpan }] }], components: [component] }));
const codes = (r: { diagnostics: { code: string }[] }) => r.diagnostics.map((d) => d.code);

describe("components", () => {
  it("KPI shrinks the value to fit, then errors when it cannot", () => {
    const shrunk = one({ id: "c", type: "kpi", content: { value: "R$ 1.234.567,89", label: "Receita" } }, 3);
    expect(codes(shrunk)).toContain("kpi-shrunk");
    const tooWide = one({ id: "c", type: "kpi", content: { value: "R$ 1.234.567.890.123,45", label: "Receita" } }, 1);
    expect(codes(tooWide)).toContain("kpi-value-too-wide");
  });

  it("chart reports a plot area that is too small", () => {
    const r = one({ id: "c", type: "chart", content: { kind: "bar", categories: ["a", "b"], series: [{ name: "x", values: [1, 2] }] } }, 4, 6);
    expect(codes(r)).toEqual(expect.arrayContaining(["chart-too-small", "overflow"]));
  });

  it("chart truncates category labels that do not fit their slot", () => {
    const categories = ["Janeiro de 2026", "Fevereiro de 2026", "Março de 2026", "Abril de 2026", "Maio de 2026", "Junho de 2026"];
    const r = one({ id: "c", type: "chart", content: { kind: "line", categories, series: [{ name: "x", values: [1, 2, 3, 4, 5, 6] }] } }, 4);
    expect(codes(r)).toContain("chart-labels-overlap");
  });

  it("chart warns when a series length does not match the categories", () => {
    const r = one({ id: "c", type: "chart", content: { kind: "bar", categories: ["a", "b", "c"], series: [{ name: "x", values: [1] }] } });
    expect(codes(r)).toContain("chart-series-length");
  });

  it("pie chart renders one slice per category", () => {
    const r = one({ id: "c", type: "chart", content: { kind: "pie", categories: ["a", "b", "c"], series: [{ name: "x", values: [1, 2, 3] }] } }, 6);
    const html = r.pages[0]?.boxes[0]?.html ?? "";
    expect((html.match(/<path /g) ?? []).length).toBe(3);
    expect(html).toContain("50%");
  });

  it("code keeps indentation and reports wrapped lines", () => {
    const code = `if (x) {\n    return "${"x".repeat(200)}";\n}`;
    const r = one({ id: "c", type: "code", content: { code } }, 6);
    const wrapped = r.diagnostics.find((d) => d.code === "code-line-wrapped");
    expect(wrapped?.data?.lines).toEqual([2]);
    expect(r.pages[0]?.boxes[0]?.html).toContain(">    return");
  });

  it("table warns about rows with the wrong number of cells", () => {
    const r = one({ id: "c", type: "table", content: { columns: ["a", "b"], rows: [["1"], ["1", "2", "3"]] } });
    expect(r.diagnostics.filter((d) => d.code === "table-row-length")).toHaveLength(2);
  });

  it("list numbers items and indents nested ones", () => {
    const r = one({ id: "c", type: "list", props: { marker: "number" }, content: { items: ["um", { text: "dois", items: ["dois.um"] }, "três"] } });
    const html = r.pages[0]?.boxes[0]?.html ?? "";
    expect(html).toContain(">1.<");
    expect(html).toContain(">3.<");
    expect(r.components.c?.facts).toMatchObject({ items: 4 });
  });

  it("steps and timeline lay out every entry", () => {
    const steps = one({ id: "c", type: "steps", content: { steps: [{ title: "Um", text: "texto" }, { title: "Dois" }] } }, 6);
    expect(steps.components.c?.facts).toMatchObject({ steps: 2 });
    const timeline = one(
      { id: "c", type: "timeline", content: { events: [{ date: "1 out", title: "A" }, { date: "15 out", title: "B", text: "detalhe" }] } },
      6,
    );
    expect(timeline.components.c?.facts).toMatchObject({ events: 2 });
  });

  it("image keeps its aspect ratio in an auto band", () => {
    const r = one({ id: "c", type: "image", content: { src: "x.png", alt: "x", width: 400, height: 200 } }, 6);
    const g = r.components.c;
    expect(g?.natural).toBe(Math.ceil((g?.area.width ?? 0) / 2));
  });

  it("text warns about glyphs the font cannot draw", () => {
    const r = one({ id: "c", type: "text", content: { paragraphs: ["Olá 你好"] } });
    expect(codes(r)).toContain("missing-glyphs");
  });
});
