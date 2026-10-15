import { describe, expect, it } from "vitest";
import { at, doc, engine, lorem } from "./helpers";

/**
 * ~44 A4 pages: 100 rows of text + KPI, and a 300-row table that splits across pages.
 * Everything is declared at the top of page 1, so the layout pushes every row down
 * below the previous one: the worst case for collision resolution.
 */
function largeDocument() {
  const components: unknown[] = [];
  for (let i = 0; i < 100; i++) {
    components.push({ id: `t${i}`, type: "text", content: { paragraphs: [{ role: "title-2", text: `Seção ${i}` }, `${lorem} ${lorem}`, lorem] }, at: at(0, 0, 50) });
    components.push({ id: `k${i}`, type: "kpi", content: { value: `R$ ${i},2M`, label: "Receita", delta: "+3%" }, at: at(52, 0, 35) });
  }
  components.push({
    id: "tab",
    type: "table",
    content: { columns: ["Região", "Receita", "Variação"], rows: Array.from({ length: 300 }, (_, i) => [`Região ${i}`, `R$ ${i},${i}M`, `${i % 9}%`]) },
    at: at(0, 0, 87),
  });
  return doc({ components });
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
