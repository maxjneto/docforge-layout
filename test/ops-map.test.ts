import { describe, expect, it } from "vitest";
import type { Op } from "../src/ops/ops";
import { doc, engine, example, lorem } from "./helpers";

describe("operations", () => {
  const base = doc({
    bands: [{ id: "b1", span: "auto", items: [{ component: "t", colStart: 1, colSpan: 12 }] }],
    components: [{ id: "t", type: "text", content: { paragraphs: ["olá"] } }],
  });
  const addKpi: Op = {
    op: "add",
    component: { id: "k", type: "kpi", content: { value: "42", label: "Resposta" } },
    at: { section: "s1", band: "b2", colStart: 1, colSpan: 4, newBand: { span: 4 } },
  };

  it("adds a component in a new band and reports what it touched", () => {
    const r = engine.apply(base, [addKpi]);
    expect(r.doc?.components.map((c) => c.id)).toEqual(["t", "k"]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.find((d) => d.code === "overflow")?.component).toBe("k");
    expect(r.map).toMatch(/\[k kpi 1-4 · [\d.]+×32 !overflow/);
  });

  it("fixes the overflow by growing the band", () => {
    const added = engine.apply(base, [addKpi]);
    const fixed = engine.apply(added.doc, [{ op: "setBand", band: "b2", span: "auto" }]);
    expect(fixed.ok).toBe(true);
    expect(fixed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("moves, updates, restyles and removes", () => {
    let current: unknown = base;
    const step = (ops: Op[]) => {
      const r = engine.apply(current, ops);
      current = r.doc;
      return r;
    };
    step([{ op: "addBand", section: "s1", band: { id: "b2" } }]);
    step([{ op: "place", component: "t", at: { section: "s1", band: "b2", colStart: 3, colSpan: 8 } }]);
    const updated = step([{ op: "update", component: "t", content: { paragraphs: [lorem] }, labels: ["x"], style: { align: "center" } }]);
    expect(updated.ok).toBe(true);
    step([{ op: "setStyle", layer: "label", label: "x", style: { color: "$color.primary" } }]);
    const layout = engine.layout(current);
    expect(layout.components.t?.band).toBe("b2");
    expect(layout.components.t?.style.color.origin).toBe("label:x");
    expect(layout.components.t?.style.align.origin).toBe("component");
    const removed = step([{ op: "remove", component: "t" }]);
    expect(removed.doc?.components).toEqual([]);
  });

  it("returns invalid-op errors and leaves the input untouched", () => {
    const r = engine.apply(base, [{ op: "place", component: "nope", at: { section: "s1", band: "b1", colStart: 1, colSpan: 1 } }]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe("invalid-op");
    expect((base as { components: unknown[] }).components).toHaveLength(1);
  });

  it("checks each op's shape and names the bad field instead of throwing", () => {
    const cases: [unknown, RegExp][] = [
      [{ op: "teleport" }, /"op" must be one of add, place/],
      [{ op: "add", component: { id: "x", type: "text", content: { paragraphs: ["x"] } } }, /op 1 \(add\): invalid fields — at:/],
      [{ op: "place", component: "t", at: { section: "s1", band: "b1", colStart: 0, colSpan: 2 } }, /at\.colStart/],
      [{ op: "setBand", band: "b1", span: "tall" }, /span/],
      [{ op: "setStyle", layer: "label", selector: "x", style: {} }, /label|selector/],
      [{ op: "remove", component: "t", extra: true }, /extra/],
      ["remove t", /"op" must be one of/],
    ];
    for (const [op, message] of cases) {
      const r = engine.apply(base, [op]);
      expect(r.ok, JSON.stringify(op)).toBe(false);
      expect(r.diagnostics[0]?.code).toBe("invalid-op");
      expect(r.diagnostics[0]?.message).toMatch(message);
    }
  });
});

describe("map", () => {
  it("level 0 summarizes sections and components", () => {
    const text = engine.map(example("relatorio"), { level: 0, surfaceId: "a4" }).text;
    expect(text).toContain("components: 12");
    expect(text).toContain("s-vendas");
  });

  it("level 1 lists bands with columns per page", () => {
    const text = engine.map(example("relatorio"), { level: 1, surfaceId: "a4" }).text;
    expect(text).toContain("page 1");
    expect(text).toMatch(/r-kpis \[16 rows · 128px\]\s+\[kpi-receita kpi 1-4 · \d+(\.\d)?×128\]/);
    expect(text).toMatch(/grid: 12 cols × [\d.]+px, column gap 16px · row unit 8px/);
    expect(text).toMatch(/content area [\d.]+×[\d.]+px/);
  });

  it("level 2 shows area, need and style origins", () => {
    const text = engine.map(example("relatorio"), { level: 2, components: ["riscos"], surfaceId: "a4" }).text;
    expect(text).toContain("riscos · list");
    expect(text).toContain("color: #1f4fd8 ($color.primary) ← label:destaque");
    expect(text).toContain("fontSize: 13 ($size.s) ← region:proximos-compacto");
  });
});
