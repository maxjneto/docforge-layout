import { describe, expect, it } from "vitest";
import { at, doc, engine, registry } from "./helpers";

const slide = (n: number, id: string) => ({ id, type: "text", content: { paragraphs: [{ role: "title-1", text: `Slide ${n}` }] }, at: at(0, 0, 60, undefined, n) });
const deck = doc({
  surfaces: [{ id: "deck", kind: "page", size: "Slide", margin: 48 }],
  components: [slide(1, "a"), slide(2, "b"), slide(3, "c")],
});
const pageOf = (d: unknown, id: string) => (d as { components: { id: string; at: { page: number } }[] }).components.find((c) => c.id === id)?.at.page;
const ids = (d: unknown) => (d as { components: { id: string }[] }).components.map((c) => c.id);

describe("Slide surface", () => {
  it("is 16:9 at PowerPoint's default size, one slide per page", () => {
    const layout = engine.layout(deck);
    expect(layout.pages).toHaveLength(3);
    expect(layout.pages[0]).toMatchObject({ width: 1280, height: 720 });
  });
});

describe("page op", () => {
  it("inserts an empty page and moves the later ones down", () => {
    const r = engine.apply(deck, [{ op: "page", action: "insert", page: 1 }]);
    expect(r.ok).toBe(true);
    expect([pageOf(r.doc, "a"), pageOf(r.doc, "b"), pageOf(r.doc, "c")]).toEqual([1, 3, 4]);
  });

  it("inserts before the first with page 0", () => {
    const r = engine.apply(deck, [{ op: "page", action: "insert", page: 0 }]);
    expect(pageOf(r.doc, "a")).toBe(2);
  });

  it("duplicates a page right after it, with new ids", () => {
    const r = engine.apply(deck, [{ op: "page", action: "duplicate", page: 2 }]);
    expect(r.ok).toBe(true);
    expect(ids(r.doc)).toContain("b-2");
    expect([pageOf(r.doc, "b"), pageOf(r.doc, "b-2"), pageOf(r.doc, "c")]).toEqual([2, 3, 4]);
    expect(engine.layout(r.doc!).pages).toHaveLength(4);
  });

  it("removes a page and what is on it", () => {
    const r = engine.apply(deck, [{ op: "page", action: "remove", page: 2 }]);
    expect(ids(r.doc)).toEqual(["a", "c"]);
    expect(pageOf(r.doc, "c")).toBe(2);
  });

  it("moves a page forward and back", () => {
    const forward = engine.apply(deck, [{ op: "page", action: "move", page: 1, to: 3 }]);
    expect([pageOf(forward.doc, "a"), pageOf(forward.doc, "b"), pageOf(forward.doc, "c")]).toEqual([3, 1, 2]);
    const back = engine.apply(deck, [{ op: "page", action: "move", page: 3, to: 1 }]);
    expect([pageOf(back.doc, "a"), pageOf(back.doc, "b"), pageOf(back.doc, "c")]).toEqual([2, 3, 1]);
  });

  it("refuses a page that does not exist", () => {
    const r = engine.apply(deck, [{ op: "page", action: "remove", page: 9 }]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.find((d) => d.code === "invalid-op")?.message).toMatch(/page must be 1–3/);
  });
});

describe("themes", () => {
  it("remembers the theme's name with setMeta", () => {
    const r = engine.apply(deck, [{ op: "setMeta", meta: { theme: "Executivo" } }]);
    expect(r.doc?.meta?.theme).toBe("Executivo");
  });

  it("gives titles the heading font, so a theme can change it alone", () => {
    const r = engine.apply(deck, [{ op: "setTokens", tokens: { font: { heading: "Source Serif 4" } } }]);
    const html = engine.render(r.doc!).page;
    expect(html).toContain("Source Serif 4");
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("bundles the theme fonts", () => {
    expect(registry.families()).toEqual(expect.arrayContaining(["Inter", "Source Serif 4", "Space Grotesk", "JetBrains Mono"]));
  });
});

describe("review on slides", () => {
  it("does not flag a title per slide or a short last slide", () => {
    const codes = engine.review(deck).findings.map((f) => f.code);
    expect(codes).not.toContain("title-count");
    expect(codes).not.toContain("page-balance");
  });
});
