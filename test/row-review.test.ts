import { describe, expect, it } from "vitest";
import { rowsOf } from "../src/layout/rows";
import { splitColumns } from "../src/ops/ops";
import { at, doc, engine, lorem } from "./helpers";

const title = { id: "t", type: "text", content: { paragraphs: [{ role: "title-1", text: "Q3" }] }, at: at(0, 0, 87) };
const kpi = (id: string) => ({ id, type: "kpi", content: { value: "42", label: id } });
const base = doc({ components: [title] });

describe("splitColumns", () => {
  it("splits whole columns by weight, each at least one", () => {
    expect(splitColumns(12, [1, 1, 1])).toEqual([4, 4, 4]);
    expect(splitColumns(12, [2, 1])).toEqual([8, 4]);
    expect(splitColumns(12, [1, 1, 1, 1, 1])).toEqual([3, 3, 2, 2, 2]);
    expect(splitColumns(3, [10, 1, 1])).toEqual([1, 1, 1]);
  });
});

describe("row", () => {
  it("adds three KPIs on the guides, at one y, with one height", () => {
    const r = engine.apply(base, [{ op: "row", below: "t", h: 14, items: [kpi("a"), kpi("b"), kpi("c")] }]);
    expect(r.ok).toBe(true);
    const layout = engine.layout(r.doc);
    const boxes = ["a", "b", "c"].map((id) => layout.components[id]?.box);
    const guides = layout.guides;
    expect(boxes.map((b) => b?.x)).toEqual([guides[0]?.x, guides[4]?.x, guides[8]?.x]);
    expect(new Set(boxes.map((b) => b?.y)).size).toBe(1);
    expect(new Set(boxes.map((b) => b?.h)).size).toBe(1);
    expect((boxes[2]?.x ?? 0) + (boxes[2]?.w ?? 0)).toBe(87);
    expect(r.summary).toMatch(/a +added at p1/);
  });

  it("moves existing components into a 2:1 split, and stretches them to one height", () => {
    const d = doc({
      components: [
        title,
        { id: "txt", type: "text", content: { paragraphs: [lorem, lorem] }, at: at(0, 30, 40) },
        { id: "k", type: "kpi", content: { value: "1", label: "x" }, at: at(50, 60, 20, 10) },
      ],
    });
    const r = engine.apply(d, [{ op: "row", below: "t", widths: [2, 1], align: "stretch", items: ["txt", "k"] }]);
    expect(r.ok).toBe(true);
    const layout = engine.layout(r.doc);
    const txt = layout.components.txt?.box;
    const k = layout.components.k?.box;
    expect(txt?.y).toBe(k?.y);
    expect(txt?.w).toBeGreaterThan((k?.w ?? 0) * 1.8);
    expect(k?.h).toBe(txt?.h);
  });

  it("refuses rows that cannot be built, naming why", () => {
    const tooMany = engine.apply(base, [{ op: "row", below: "t", cols: [1, 2], items: [kpi("a"), kpi("b"), kpi("c")] }]);
    expect(tooMany.ok).toBe(false);
    expect(tooMany.diagnostics[0]?.message).toMatch(/do not fit in 2 guide columns/);
    expect(engine.apply(base, [{ op: "row", below: "t", items: ["nope"] }]).diagnostics[0]?.message).toMatch(/does not exist/);
    expect(engine.apply(base, [{ op: "row", below: "t", items: ["t"] }]).diagnostics[0]?.message).toMatch(/is in the row/);
    expect(engine.apply(base, [{ op: "row", items: [kpi("a")] }]).ok).toBe(false);
  });
});

describe("rowsOf", () => {
  it("chains boxes that overlap vertically on the same page", () => {
    const r = engine.apply(base, [{ op: "row", below: "t", h: 14, items: [kpi("a"), kpi("b")] }]);
    expect(rowsOf(engine.layout(r.doc)).map((row) => row.ids)).toEqual([["t"], ["a", "b"]]);
  });
});

describe("review", () => {
  it("flags a box much taller than its content, with the op that fixes it", () => {
    const d = doc({ components: [title, { id: "short", type: "text", content: { paragraphs: ["Uma linha."] }, at: at(0, 20, 40, 30) }] });
    const found = engine.review(d).findings.find((f) => f.code === "empty-space");
    expect(found?.components).toEqual(["short"]);
    expect(found?.fixes).toEqual([{ op: "place", component: "short", at: { h: null } }]);
    const fixed = engine.apply(d, found?.fixes ?? []);
    expect(engine.review(fixed.doc).findings.some((f) => f.code === "empty-space")).toBe(false);
  });

  it("flags side-by-side boxes whose tops or heights almost match", () => {
    const d = doc({
      components: [
        title,
        { id: "a", type: "kpi", content: { value: "1", label: "a" }, at: at(0, 20, 28, 12) },
        { id: "b", type: "kpi", content: { value: "2", label: "b" }, at: at(30, 20, 28, 14) },
        { id: "c", type: "kpi", content: { value: "1", label: "x" }, at: at(0, 60, 28, 12) },
        { id: "e", type: "kpi", content: { value: "2", label: "y" }, at: at(30, 62, 28, 12) },
      ],
    });
    const codes = engine.review(d).findings.map((f) => `${f.code}:${f.components.join(",")}`);
    expect(codes).toContain("uneven-row:a,b");
    expect(codes).toContain("uneven-top:c,e");
  });

  it("flags an edge just off a guide and a near-empty last page", () => {
    const d = doc({
      components: [
        { ...title, at: at(0, 0, 86) },
        { id: "tail", type: "text", content: { paragraphs: ["fim"] }, at: at(0, 0, 87, undefined, 2) },
      ],
    });
    const review = engine.review(d);
    expect(review.findings.find((f) => f.code === "off-guide")?.fixes).toEqual([{ op: "place", component: "t", at: { cols: [1, 12] } }]);
    expect(review.findings.find((f) => f.code === "page-balance")?.fixes).toEqual([{ op: "fit", pages: 1 }]);
    expect(review.text).toMatch(/off-guide {2}t/);
  });

  it("says so when there is nothing to fix", () => {
    expect(engine.review(base).text).toBe("No composition problems found.");
  });
});

describe("compare and restore", () => {
  const before = doc({
    components: [
      title,
      { id: "a", type: "text", content: { paragraphs: ["um"] }, at: at(0, 20, 40) },
      { id: "b", type: "text", content: { paragraphs: ["dois"] }, at: at(0, 30, 40) },
      { id: "gone", type: "kpi", content: { value: "1", label: "x" }, at: at(50, 20, 20, 10) },
    ],
  });
  const after = engine.apply(before, [
    { op: "edit", component: "a", set: { "paragraphs.0": `${lorem} ${lorem}` } },
    { op: "remove", component: "gone" },
    { op: "add", component: kpi("new"), at: { page: 1, x: 50, y: 60, w: 20, h: 10 } },
  ]).doc;

  it("lists what was done on purpose and what moved as a consequence", () => {
    const c = engine.compare(before, after);
    expect(c.edits.map((e) => `${e.component}:${e.kinds.join("+")}`).sort()).toEqual(["a:content", "gone:removed", "new:added"]);
    expect(c.effects.map((e) => e.component)).toContain("b");
  });

  it("restores one component and leaves the others", () => {
    const back = engine.apply(after, [...engine.restore(before, after, "a"), ...engine.restore(before, after, "gone")]).doc;
    const ids = back?.components.map((x) => x.id);
    expect(ids).toContain("gone");
    expect(ids).toContain("new");
    expect(back?.components.find((x) => x.id === "a")).toEqual((before.components as { id: string }[]).find((x) => x.id === "a"));
  });
});
