import { describe, expect, it } from "vitest";
import { engine, lorem } from "./helpers";

/** ~44 A4 pages: 100 bands of text + KPI, and a 300-row table that splits across pages. */
function largeDocument() {
  const bands: unknown[] = [];
  const components: unknown[] = [];
  for (let i = 0; i < 100; i++) {
    bands.push({ id: `b${i}`, span: "auto", items: [{ component: `t${i}`, colStart: 1, colSpan: 7 }, { component: `k${i}`, colStart: 8, colSpan: 5 }] });
    components.push({ id: `t${i}`, type: "text", content: { paragraphs: [{ role: "title-2", text: `Seção ${i}` }, `${lorem} ${lorem}`, lorem] } });
    components.push({ id: `k${i}`, type: "kpi", content: { value: `R$ ${i},2M`, label: "Receita", delta: "+3%" } });
  }
  bands.push({ id: "tab", span: "auto", items: [{ component: "tab", colStart: 1, colSpan: 12 }] });
  components.push({
    id: "tab",
    type: "table",
    content: { columns: ["Região", "Receita", "Variação"], rows: Array.from({ length: 300 }, (_, i) => [`Região ${i}`, `R$ ${i},${i}M`, `${i % 9}%`]) },
  });
  return { format: "docforge/layout", version: 1, surfaces: [{ id: "a4", kind: "page", size: "A4", margin: 48 }], sections: [{ id: "s", bands }], components };
}

describe("performance", () => {
  // Measured ~330ms cold / ~70ms warm on a laptop; the budgets only catch large regressions.
  it("lays out and renders a ~44-page document within budget", () => {
    const d = largeDocument();
    let started = performance.now();
    const first = engine.layout(d);
    const cold = performance.now() - started;
    expect(first.pages.length).toBeGreaterThan(30);
    expect(cold).toBeLessThan(3000);

    started = performance.now();
    engine.render(d);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
