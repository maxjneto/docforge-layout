import { describe, expect, it } from "vitest";
import { downgradeDocument, renderLayout } from "../src";
import { cellNumber } from "../src/components/table";
import { doc, engine, registry, single } from "./helpers";

const reference = {
  id: "ref",
  type: "table",
  content: {
    columns: ["Campo", "Tipo", "Descrição"],
    rows: [
      ["identificador_externo", "string", "Chave que o sistema de origem usa para reconhecer o registro nas sincronizações."],
      ["criado_em", "datetime", "Momento da criação."],
    ],
  },
};

const facts = (r: ReturnType<typeof engine.layout>, id = "ref") => r.components[id]?.facts as Record<string, unknown>;

describe("table column widths", () => {
  it("sizes columns by content when no column has a weight, keeping every word whole", () => {
    const auto = engine.layout(single(reference, 60));
    expect(facts(auto).columnWidths).toBe("auto");
    expect(auto.diagnostics.filter((d) => d.code === "word-broken" || d.code === "table-too-narrow")).toEqual([]);
    const [field, type, description] = facts(auto).columnPx as number[];
    // The long description takes the room; the short columns get what their words need.
    expect(description).toBeGreaterThan(field as number);
    expect(type).toBeLessThan(field as number);

    // Even columns cut the long field name at a narrow width.
    const fixed = engine.layout(single({ ...reference, props: { columnWidths: "fixed" } }, 40));
    const broken = fixed.diagnostics.find((d) => d.code === "word-broken");
    expect(broken?.suggestions?.[0]).toContain('columnWidths: "auto"');
  });

  it("uses weights as soon as one column declares a width", () => {
    const weighted = { ...reference, content: { ...reference.content, columns: [{ header: "Campo", width: 1 }, "Tipo", { header: "Descrição", width: 2 }] } };
    const r = engine.layout(single(weighted, 80));
    expect(facts(r).columnWidths).toBe("fixed");
    const [a, , c] = facts(r).columnPx as number[];
    expect(Math.abs((c as number) - 2 * (a as number))).toBeLessThanOrEqual(1);
  });

  it("says how wide the table must be when even the widest words do not fit", () => {
    const r = engine.layout(single(reference, 14));
    const narrow = r.diagnostics.find((d) => d.code === "table-too-narrow");
    expect(narrow?.severity).toBe("warning");
    const minW = (narrow?.data as { minW: number }).minW;
    expect(minW).toBeGreaterThan(14);
    expect(r.diagnostics.find((d) => d.code === "word-broken")).toBeUndefined();
    // At that width nothing is cut.
    const wide = engine.layout(single(reference, minW));
    expect(wide.diagnostics.find((d) => d.code === "table-too-narrow" || d.code === "word-broken")).toBeUndefined();
  });

  it("measure reports the narrowest width that cuts no word", () => {
    const m = engine.measure(reference, { widths: [14, 60] });
    expect(m.ok).toBe(true);
    const [narrow, wide] = m.measurements;
    expect(narrow?.minW).toBe(wide?.minW);
    expect(m.text).toMatch(/words cut: needs w ≥ \d+/);
    expect(m.text).toMatch(/every word whole: needs w ≥ \d+/);
  });

  it("keeps the even columns of documents written before version 4", () => {
    const old = { ...single(reference, 60), version: 3 };
    const r = engine.layout(old);
    expect(facts(r).columnWidths).toBe("fixed");
    expect((r.doc?.components[0] as { props?: { columnWidths?: string } }).props?.columnWidths).toBe("fixed");
    expect(r.doc?.version).toBe(4);
  });
});

describe("table footer, spanning cells and bars", () => {
  const sales = {
    id: "sales",
    type: "table",
    content: {
      columns: ["Região", { header: "Valor", align: "right" }],
      rows: [["Norte", "R$ 1.200,50"], ["Sul", "R$ 600,25"], [{ text: "Sem região", span: 2, align: "center" }]],
      footer: ["Total", "R$ 1.800,75"],
    },
    props: { bars: "Valor" },
  };

  it("reads numbers in the document's locale", () => {
    expect(cellNumber("R$ 1.200,50", "pt-BR")).toBe(1200.5);
    expect(cellNumber("$1,200.50", "en-US")).toBe(1200.5);
    expect(cellNumber("−3,5%", "pt-BR")).toBe(-3.5);
    expect(cellNumber("n/d", "pt-BR")).toBeNull();
  });

  it("draws the footer with its part, bars behind the numbers and a spanning cell", () => {
    const d = { ...single(sales, 60), meta: { locale: "pt-BR" } };
    const r = engine.layout(d);
    expect(r.diagnostics.filter((x) => x.severity !== "info")).toEqual([]);
    const html = renderLayout(r, registry).html;
    expect(html).toContain('data-part="footer"');
    expect((html.match(/data-part="bar"/g) ?? []).length).toBe(2);
    expect(html).toContain("<tfoot>");
    expect(html).toContain('colspan="2"');
  });

  it("counts spans when checking a row's length, and names a bad bars column", () => {
    const short = { ...sales, content: { ...sales.content, rows: [[{ text: "x", span: 1 }]] }, props: { bars: "Nada" } };
    const r = engine.layout(single(short, 60));
    expect(r.diagnostics.find((d) => d.code === "table-row-length")?.message).toContain("covers 1 columns");
    expect(r.diagnostics.find((d) => d.code === "table-bars-column")).toBeDefined();
  });

  it("keeps the footer with the last row across a page break", () => {
    const rows = Array.from({ length: 70 }, (_, i) => [`Linha ${i + 1}`, String(i)]);
    const long = { ...sales, content: { ...sales.content, rows }, props: {} };
    const r = engine.layout(doc({ components: [{ ...long, at: { page: 1, x: 0, y: 0, w: 60 } }] }));
    expect(r.components.sales?.pages.length).toBeGreaterThan(1);
    const html = renderLayout(r, registry).html;
    // The footer is drawn right after "Linha 70" on the last page.
    const last = html.lastIndexOf("Linha 70");
    expect(html.indexOf('data-part="footer"', last)).toBeGreaterThan(last);
  });

  it("writes footer, spans and bars down to version 3 with notes", () => {
    const r = downgradeDocument(single(sales, 60), 3);
    expect(r.ok).toBe(true);
    const table = (r.doc?.components as { content: { rows: unknown[][] }; props: object }[])[0];
    expect(table?.content.rows.at(-1)).toEqual(["**Total**", "**R$ 1.800,75**"]);
    expect(table?.content.rows[2]).toEqual(["Sem região", ""]);
    expect(table?.props).toEqual({});
    expect(r.notes.join("\n")).toMatch(/footer became a last row in bold/);
    expect(r.notes.join("\n")).toMatch(/bars/);
  });
});
