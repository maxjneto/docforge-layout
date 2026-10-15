import { describe, expect, it } from "vitest";
import type { Op } from "../src/ops/ops";
import type { LayoutDocument } from "../src/schema/document";
import { upgradeDocument } from "../src/upgrade";
import { at, doc, engine, example, lorem } from "./helpers";

const base = doc({ components: [{ id: "t", type: "text", content: { paragraphs: ["olá"] }, at: at(0, 0, 87) }] });
const kpi = (id: string) => ({ id, type: "kpi", content: { value: "42", label: "Resposta" } });

describe("operations", () => {
  it("adds below another component, by guide columns", () => {
    const r = engine.apply(base, [{ op: "add", component: kpi("k"), at: { below: "t", cols: [1, 4] } } as Op]);
    expect(r.ok).toBe(true);
    const t = engine.layout(r.doc).components.t;
    expect(r.doc?.components.find((c) => c.id === "k")?.at).toEqual({ page: 1, x: 0, y: (t?.box.h ?? 0) + 2, w: 28 });
    expect(r.map).toMatch(/\n {2}k +kpi +0 /);
  });

  it("adds at the end of a page and of the document", () => {
    const r = engine.apply(base, [
      { op: "add", component: kpi("a"), at: { end: true, x: 0, w: 20 } },
      { op: "add", component: kpi("b"), at: { end: true, x: 30, w: 20, gap: 0 } },
    ] as Op[]);
    expect(r.ok).toBe(true);
    const layout = engine.layout(r.doc);
    const a = layout.components.a?.box;
    expect(a?.y).toBe((layout.components.t?.box.h ?? 0) + 2);
    expect(layout.components.b?.box.y).toBe((a?.y ?? 0) + (a?.h ?? 0));
  });

  it("place keeps what it is not told to change and can clear h", () => {
    const withH = engine.apply(base, [{ op: "place", component: "t", at: { y: 10, h: 20 } }]);
    expect(withH.doc?.components[0]?.at).toEqual({ page: 1, x: 0, y: 10, w: 87, h: 20 });
    const cleared = engine.apply(withH.doc, [{ op: "place", component: "t", at: { h: null } }]);
    expect(cleared.doc?.components[0]?.at).toEqual({ page: 1, x: 0, y: 10, w: 87 });
  });

  it("setMeta sets and removes the title and the locale", () => {
    const set = engine.apply(base, [{ op: "setMeta", meta: { title: "Q3", locale: "pt-BR" } }]);
    expect(set.doc?.meta).toEqual({ title: "Q3", locale: "pt-BR" });
    const cleared = engine.apply(set.doc, [{ op: "setMeta", meta: { title: null } }]);
    expect(cleared.doc?.meta).toEqual({ locale: "pt-BR" });
    expect(engine.apply(base, [{ op: "setMeta", meta: { locale: "not a locale!" } }]).ok).toBe(false);
  });

  it("update with props null clears them, so props can be replaced", () => {
    const linked = engine.apply(base, [{ op: "add", component: { ...kpi("k"), props: { href: "#t" } }, at: { below: "t", w: 20 } }]);
    const cleared = engine.apply(linked.doc, [{ op: "update", component: "k", props: null }]);
    expect(cleared.doc?.components.find((c) => c.id === "k")).not.toHaveProperty("props");
  });

  it("stores a y past the bottom of a page on the next page", () => {
    const r = engine.apply(base, [{ op: "place", component: "t", at: { y: 130 } }]);
    expect(r.doc?.components[0]?.at).toMatchObject({ page: 2, y: 2 });
  });

  it("never refuses a write for a layout consequence: it reports the changes instead", () => {
    const d = doc({
      components: [
        { id: "a", type: "text", content: { paragraphs: ["curto"] }, at: at(0, 0, 40, 4) },
        { id: "b", type: "text", content: { paragraphs: ["b"] }, at: at(0, 8, 40, 4) },
      ],
    });
    const r = engine.apply(d, [{ op: "update", component: "a", content: { paragraphs: [lorem, lorem, lorem] } }]);
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([expect.objectContaining({ code: "moved", component: "b", severity: "info" })]);
    expect(r.changes[0]?.message).toMatch(/"b" moved down \d+: .* \(pushed by a\)\./);
    // The component the op touched is not reported as a change.
    expect(r.changes.some((c) => c.component === "a")).toBe(false);
  });

  it("reports components that change page and the page count", () => {
    const d = doc({
      components: [
        { id: "a", type: "divider", props: { kind: "space" }, at: at(0, 0, 87, 100) },
        { id: "b", type: "kpi", content: { value: "1", label: "x" }, at: at(0, 102, 30, 16) },
      ],
    });
    const r = engine.apply(d, [{ op: "place", component: "a", at: { h: 115 } }]);
    expect(r.changes.map((c) => c.code)).toEqual(["moved-page", "page-count"]);
    expect(r.changes[0]?.message).toContain("to p2 x0 y0");
  });

  it("moves, updates, restyles and removes", () => {
    let current: unknown = base;
    const step = (ops: Op[]) => {
      const r = engine.apply(current, ops);
      current = r.doc;
      return r;
    };
    step([{ op: "place", component: "t", at: { x: 10, w: 60 } }]);
    const updated = step([{ op: "update", component: "t", content: { paragraphs: [lorem] }, labels: ["x"], style: { align: "center" } }]);
    expect(updated.ok).toBe(true);
    step([{ op: "setStyle", layer: "label", label: "x", style: { color: "$color.primary" } }]);
    const layout = engine.layout(current);
    expect(layout.components.t?.box).toMatchObject({ x: 10, w: 60 });
    expect(layout.components.t?.style.color.origin).toBe("label:x");
    expect(layout.components.t?.style.align.origin).toBe("component");
    const removed = step([{ op: "remove", component: "t" }]);
    expect(removed.doc?.components).toEqual([]);
  });

  it("setGrid with a new unit keeps sizes in px; guides never move anything", () => {
    const r = engine.apply(base, [{ op: "place", component: "t", at: { x: 10, y: 20, w: 40, h: 6 } }, { op: "setGrid", grid: { unit: 4, columns: 6 } }]);
    expect(r.doc?.components[0]?.at).toEqual({ page: 1, x: 20, y: 40, w: 80, h: 12 });
    expect(r.doc?.grid).toMatchObject({ unit: 4, columns: 6 });
    const guidesOnly = engine.apply(r.doc, [{ op: "setGrid", grid: { columns: 4, gutter: 24 } }]);
    expect(guidesOnly.doc?.components[0]?.at).toEqual(r.doc?.components[0]?.at);
  });

  it("setSurface changes the page and the layout follows, with notices", () => {
    const d = doc({ components: [{ id: "a", type: "text", content: { paragraphs: ["a"] }, at: at(60, 120, 27, 4) }] });
    const r = engine.apply(d, [{ op: "setSurface", surface: { id: "a4", kind: "page", size: { width: 600, height: 800 }, margin: 40 } }]);
    expect(r.ok).toBe(true);
    const layout = engine.layout(r.doc);
    expect(layout.components.a?.clamped).toBe(true);
    expect(layout.components.a?.box.page).toBe(2);
    expect(r.changes.map((c) => c.code)).toEqual(expect.arrayContaining(["moved-page", "page-count"]));
    expect(engine.apply(d, [{ op: "removeSurface", surface: "a4" }]).ok).toBe(false);
  });

  it("setSurface with fitWidth keeps positions in proportion to a new page width", () => {
    const d = doc({
      components: [
        { id: "l", type: "text", content: { paragraphs: ["l"] }, at: at(0, 0, 43) },
        { id: "r", type: "text", content: { paragraphs: ["r"] }, at: at(44, 0, 43) },
      ],
    });
    // 48px → 96px margins: 87 → 75 units across.
    const r = engine.apply(d, [{ op: "setSurface", surface: { id: "a4", kind: "page", size: "A4", margin: 96 }, fitWidth: true }]);
    const layout = engine.layout(r.doc);
    expect(layout.units.cols).toBe(75);
    expect(layout.components.l?.box).toMatchObject({ x: 0, y: 0, w: 37 });
    expect(layout.components.r?.box).toMatchObject({ x: 38, y: 0, w: 37 });
    expect(layout.components.r?.clamped).toBe(false);
    // Without it, the right column is pulled back inside and pushed under the left one.
    const plain = engine.layout(engine.apply(d, [{ op: "setSurface", surface: { id: "a4", kind: "page", size: "A4", margin: 96 } }]).doc);
    expect(plain.components.r?.clamped).toBe(true);
  });

  it("returns invalid-op errors and leaves the input untouched", () => {
    const r = engine.apply(base, [{ op: "place", component: "nope", at: { x: 1 } }]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe("invalid-op");
    expect((base as { components: unknown[] }).components).toHaveLength(1);
  });

  it("checks each op's shape and position rules, naming the problem instead of throwing", () => {
    const cases: [unknown, RegExp][] = [
      [{ op: "teleport" }, /"op" must be one of add, place/],
      [{ op: "add", component: { id: "x", type: "text", content: { paragraphs: ["x"] } } }, /op 1 \(add\): invalid fields — at:/],
      [{ op: "add", component: kpi("x"), at: { x: 0, y: 0 } }, /give w \(or cols, or below\)/],
      [{ op: "add", component: kpi("x"), at: { x: 0, w: 4 } }, /give y \(or below, or end\)/],
      [{ op: "place", component: "t", at: { x: -1 } }, /at\.x/],
      [{ op: "place", component: "t", at: { cols: [1, 3], x: 2 } }, /cols or x\/w/],
      [{ op: "place", component: "t", at: { cols: [5, 13] } }, /guide columns 1–12/],
      [{ op: "place", component: "t", at: { below: "nada" } }, /"nada" \(below\) is not a placed component/],
      [{ op: "place", component: "t", at: { below: "t" } }, /below itself/],
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

describe("compact and fit", () => {
  const box = (id: string, y: number, h: number, x = 0, w = 40, page = 1) => ({ id, type: "divider", props: { kind: "space" }, at: at(x, y, w, h, page) });

  it("compact moves components up into the space above them, column by column", () => {
    const d = doc({ components: [box("a", 0, 4), box("b", 20, 4), box("c", 40, 4, 45)] });
    const r = engine.apply(d, [{ op: "compact" }]);
    const placed = (id: string) => r.doc?.components.find((c) => c.id === id)?.at;
    expect(placed("a")?.y).toBe(0);
    expect(placed("b")?.y).toBe(6); // under a, 2 units apart
    expect(placed("c")?.y).toBe(0); // nothing above it in its columns
    // What compact moved was asked for: not a side effect.
    expect(r.changes).toEqual([]);
  });

  it("compact can be limited to some components", () => {
    const d = doc({ components: [box("a", 0, 4), box("b", 20, 4), box("c", 40, 4)] });
    const r = engine.apply(d, [{ op: "compact", components: ["c"] }]);
    expect(r.doc?.components.map((c) => c.at?.y)).toEqual([0, 20, 26]);
    expect(engine.apply(d, [{ op: "compact", components: ["nope"] }]).ok).toBe(false);
  });

  it("compact with acrossPages brings a box back to the previous page when it fits there", () => {
    const d = doc({ components: [box("a", 0, 60), box("b", 100, 40)] });
    expect(engine.layout(d).components.b?.box.page).toBe(2);
    const within = engine.apply(d, [{ op: "compact" }]);
    expect(engine.layout(within.doc).components.b?.box).toMatchObject({ page: 2, y: 0 });
    const across = engine.apply(d, [{ op: "compact", acrossPages: true }]);
    expect(engine.layout(across.doc).components.b?.box).toMatchObject({ page: 1, y: 62 });
  });

  it("compact moves a split component up by its first piece", () => {
    const rows = Array.from({ length: 20 }, (_, i) => [`Linha ${i}`, `${i}`]);
    const d = doc({
      components: [box("a", 0, 10), { id: "tab", type: "table", content: { columns: ["a", "b"], rows }, at: at(0, 110, 87) }],
    });
    expect(engine.layout(d).components.tab?.pieces.length).toBe(2);
    const r = engine.apply(d, [{ op: "compact" }]);
    const tab = engine.layout(r.doc).components.tab;
    expect(tab?.box.y).toBe(12);
    expect(tab?.pieces.length).toBe(1);
  });

  it("fit with compact closes gaps until the document fits", () => {
    const d = doc({ components: [box("a", 0, 60), box("b", 100, 40)] });
    expect(engine.layout(d).pages).toHaveLength(2);
    const r = engine.apply(d, [{ op: "fit", pages: 1, strategies: ["compact"] }]);
    expect(engine.layout(r.doc).pages).toHaveLength(1);
    expect(r.diagnostics.find((x) => x.code === "fit-result")?.message).toMatch(/Now 1 page \(was 2\), with: compact/);
    expect(r.changes.map((c) => c.code)).toEqual(["page-count"]);
  });

  it("fit with type scales text sizes down only as far as needed", () => {
    const paragraphs = Array.from({ length: 22 }, () => lorem);
    const d = doc({ components: [{ id: "t", type: "text", content: { paragraphs }, at: at(0, 0, 87) }] });
    const pages = engine.layout(d).pages.length;
    expect(pages).toBe(2);
    const r = engine.apply(d, [{ op: "fit", pages: 1, strategies: ["type"], minScale: 0.6 }]);
    expect(engine.layout(r.doc).pages).toHaveLength(1);
    expect(r.doc?.tokens?.size?.m).toBeLessThan(15);
    expect(r.diagnostics.find((x) => x.code === "fit-result")?.message).toMatch(/type ×0\.\d\d/);
  });

  it("fit with heights lowers minimum heights to what the content needs, then compacts", () => {
    const d = doc({
      components: [
        { id: "t", type: "text", content: { paragraphs: ["curto"] }, at: at(0, 0, 87, 124) },
        { id: "u", type: "text", content: { paragraphs: ["depois"] }, at: at(0, 126, 87) },
      ],
    });
    expect(engine.layout(d).pages).toHaveLength(2);
    const onlyHeights = engine.apply(d, [{ op: "fit", pages: 1, strategies: ["heights"] }]);
    // Without compact, the freed space stays empty: u keeps its declared y and still spills over.
    expect(onlyHeights.diagnostics.find((x) => x.code === "fit-failed")).toBeDefined();
    const r = engine.apply(d, [{ op: "fit", pages: 1, strategies: ["compact", "heights"] }]);
    expect(engine.layout(r.doc).pages).toHaveLength(1);
    expect(r.doc?.components[0]?.at?.h).toBeLessThan(10);
    expect(r.diagnostics.find((x) => x.code === "fit-result")?.message).toMatch(/heights/);
  });

  it("fit uses the surface's maxPages, and changes nothing when it cannot fit", () => {
    const d = doc({
      surfaces: [{ id: "a4", kind: "page", size: "A4", margin: 48, maxPages: 1 }],
      components: [box("a", 0, 120), box("b", 0, 120, 0, 40, 2)],
    });
    const r = engine.apply(d, [{ op: "fit", strategies: ["compact", "spacing"] }]);
    expect(r.ok).toBe(true);
    expect(r.diagnostics.find((x) => x.code === "fit-failed")?.severity).toBe("warning");
    expect(r.doc).toEqual(engine.layout(d).doc);
    expect(engine.apply(doc({ components: [] }), [{ op: "fit" }]).diagnostics[0]?.message).toMatch(/Give `pages`/);
  });
});

describe("map", () => {
  it("level 0 lists components per page", () => {
    const text = engine.map(example("relatorio"), { level: 0, surfaceId: "a4" }).text;
    expect(text).toContain("components: 12");
    expect(text).toMatch(/page 1: titulo, kpi-receita/);
  });

  it("level 1 has the settings, each page drawn and a table of its components", () => {
    const text = engine.map(example("relatorio"), { level: 1, surfaceId: "a4" }).text;
    expect(text).toMatch(/content 697\.7px wide = 87 units × 128 rows · 1 unit = 8px/);
    expect(text).toMatch(/guides: 12 columns, gutter 16px → 1:0–5 2:7–13/);
    expect(text).toMatch(/classes: destaque \[fontWeight,color\] \(1: riscos\)/);
    expect(text).toContain("page 1/2");
    expect(text).toMatch(/\n +\d+ \+-kpi-receita-+\+ +\+-kpi-margem/);
    expect(text).toContain("(end of page)");
    expect(text).toMatch(/\n {2}kpi-receita +kpi +0 +\d+ +28 +16 /);
    // Interior rows repeat and are left out: a page is a few dozen lines, not 128.
    const page1 = text.split("page 1/2")[1]?.split("page 2/2")[0] ?? "";
    expect(page1.split("\n").length).toBeLessThan(60);
  });

  it("level 1 can show some pages, without the drawing", () => {
    const text = engine.map(example("relatorio"), { level: 1, pages: [2], draw: false }).text;
    expect(text).not.toContain("page 1/2");
    expect(text).toContain("page 2/2");
    expect(text).not.toContain("(end of page)");
  });

  it("level 1 marks moved boxes and explains why", () => {
    const d = doc({
      components: [
        { id: "a", type: "text", content: { paragraphs: [lorem, lorem, lorem] }, at: at(0, 0, 40, 4) },
        { id: "b", type: "text", content: { paragraphs: ["b"] }, at: at(0, 8, 40, 4) },
      ],
    });
    const text = engine.map(d, { level: 1 }).text;
    expect(text).toMatch(/\+-b v-/);
    expect(text).toMatch(/moved ↓\d+ from y8 \(pushed by a\)/);
    expect(text).toMatch(/grew \+\d+ over h 4/);
  });

  it("level 2 shows declared and drawn positions and style origins", () => {
    const text = engine.map(example("relatorio"), { level: 2, components: ["riscos"], surfaceId: "a4" }).text;
    expect(text).toContain("riscos · list");
    expect(text).toMatch(/declared: p\d x0 y\d+ w87/);
    expect(text).toContain("color: #1f4fd8 ($color.primary) ← label:destaque");
    expect(text).toContain("fontSize: 13 ($size.s) ← label:region-proximos-compacto");
  });
});

describe("find", () => {
  const report = example("relatorio");

  it("finds by text ignoring case and accents, with an excerpt", () => {
    const r = engine.find(report, { text: "REGIAO" });
    expect(r.matches.map((m) => m.id)).toContain("tabela-regioes");
    expect(r.text).toContain("found:");
    expect(r.text).toMatch(/\n {2}tabela-regioes: ".*Regi/);
  });

  it("finds by type, class, page, area and state", () => {
    expect(engine.find(report, { type: "kpi" }).matches).toHaveLength(3);
    expect(engine.find(report, { label: "destaque" }).matches.map((m) => m.id)).toEqual(["riscos"]);
    expect(engine.find(report, { page: 2 }).matches.length).toBeGreaterThan(0);
    const corner = engine.find(report, { rect: { page: 1, x: 0, y: 0, w: 10, h: 30 } }).matches.map((m) => m.id);
    expect(corner).toEqual(["titulo", "kpi-receita"]);
    expect(engine.find(report, { state: "error" }).matches).toEqual([]);
  });
});

describe("calibrate", () => {
  it("measures style variants of one component side by side without applying any", () => {
    const d = doc({
      components: [
        { id: "t", type: "text", content: { paragraphs: [lorem, lorem] }, at: at(0, 0, 40) },
        { id: "below", type: "divider", at: at(0, 30, 40, 2) },
      ],
    });
    const r = engine.calibrate(d, { component: "t" }, [{ fontSize: "$size.s" }, { fontSize: "$size.xl", lineHeight: "$lineHeight.normal" }, { fontWeight: 1234 }]);
    const [current, smaller, bigger, invalid] = r.variants;
    expect(r.ok).toBe(false);
    expect(smaller?.components[0]?.h).toBeLessThan(current?.components[0]?.h ?? 0);
    expect(bigger?.components[0]?.h).toBeGreaterThan(current?.components[0]?.h ?? 0);
    expect(bigger?.moved).toContain("below");
    expect(invalid?.ok).toBe(false);
    expect(r.text).toMatch(/calibrating component t/);
    expect(r.text).toMatch(/\n0 +current/);
    expect(d.components[0]).not.toHaveProperty("style");
  });

  it("measures a class or a selector across every component it reaches", () => {
    const d = doc({
      components: [
        { id: "a", type: "text", labels: ["nota"], content: { paragraphs: [lorem] }, at: at(0, 0, 40) },
        { id: "b", type: "text", labels: ["nota"], content: { paragraphs: [lorem] }, at: at(45, 0, 40) },
        { id: "k", type: "kpi", content: { value: "1", label: "x" }, at: at(0, 40, 20, 14) },
      ],
    });
    const byClass = engine.calibrate(d, { label: "nota" }, [{ fontSize: 22 }]);
    expect(byClass.variants[1]?.components.map((c) => c.id)).toEqual(["a", "b"]);
    expect(byClass.text).toMatch(/class nota \(2 components\)/);
    const bySelector = engine.calibrate(d, { selector: "kpi" }, [{ padding: "$space.6" }]);
    expect(bySelector.variants[1]?.components.map((c) => c.id)).toEqual(["k"]);
  });
});

describe("measure", () => {
  it("measures a component at several widths without a document", () => {
    const r = engine.measure({ id: "x", type: "text", content: { paragraphs: [lorem, lorem] } }, { widths: [20, 60], cols: [[1, 12]] });
    expect(r.ok).toBe(true);
    const [narrow, wide, full] = r.measurements;
    expect(narrow?.rows).toBeGreaterThan(wide?.rows ?? 0);
    expect(full?.label).toBe("cols 1–12");
    expect(full?.w).toBe(89);
    expect(r.text).toMatch(/w 20 \(w 20, 160px\): needs \d+px = \d+ rows/);
  });

  it("uses the document's styles", () => {
    const paragraphs = [lorem];
    const plain = engine.measure({ id: "x", type: "text", content: { paragraphs } }, { widths: [40] });
    const big = engine.measure({ id: "x", type: "text", content: { paragraphs } }, { widths: [40], doc: doc({ components: [], styles: { document: { text: { fontSize: 24 } } } }) });
    expect(big.measurements[0]?.rows).toBeGreaterThan(plain.measurements[0]?.rows ?? 0);
  });

  it("reports an invalid component", () => {
    const r = engine.measure({ id: "x", type: "text", content: {} });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe("schema");
  });
});

describe("upgrade", () => {
  it("converts a version 1 document, keeping row heights even and pointing section links at components", () => {
    const v1 = {
      format: "docforge/layout",
      version: 1,
      surfaces: [{ id: "a4", kind: "page", size: "A4", margin: 48 }],
      styles: { regions: [{ id: "r", section: "s2", style: { color: "$color.danger" } }] },
      sections: [
        { id: "s1", bands: [{ id: "b1", span: "auto", items: [{ component: "t", colStart: 1, colSpan: 12 }] }] },
        {
          id: "s2",
          bands: [
            {
              id: "b2",
              span: "auto",
              items: [
                { component: "a", colStart: 1, colSpan: 6 },
                { component: "b", colStart: 7, colSpan: 6 },
              ],
            },
          ],
        },
      ],
      components: [
        { id: "t", type: "text", content: { paragraphs: ["Ver [a seção](#s2)."] } },
        { id: "a", type: "text", content: { paragraphs: [lorem, lorem] } },
        { id: "b", type: "card", content: { title: "b" } },
      ],
    };
    const r = upgradeDocument(v1, engine);
    expect(r.ok).toBe(true);
    const out = r.doc as LayoutDocument;
    const a = out.components.find((c) => c.id === "a")?.at;
    const b = out.components.find((c) => c.id === "b")?.at;
    expect(a?.h).toBeDefined();
    expect(b?.h).toBe(a?.h);
    expect(a?.y).toBe(b?.y);
    expect(JSON.stringify(out.components[0])).toContain("](#a)");
    expect(out.components.find((c) => c.id === "a")?.labels).toEqual(["region-r"]);
    expect(r.notes.join(" ")).toMatch(/region "r" became class "region-r"/);
    expect(engine.layout(out).diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  });

  it("returns version 2 documents unchanged", () => {
    const r = upgradeDocument(example("one-pager"), engine);
    expect(r.ok).toBe(true);
    expect(r.doc).toEqual(example("one-pager"));
  });
});
