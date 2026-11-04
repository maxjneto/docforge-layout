import { describe, expect, it } from "vitest";
import { downgradeDocument, renderLayout, type LayoutDocument } from "../src";
import { defaultTokens } from "../src/schema/tokens";
import { at, doc, engine, lorem, registry } from "./helpers";

const footer = { id: "m-page", type: "text", at: { x: 0, y: 124, w: 87, h: 4 }, style: { align: "right" }, content: { paragraphs: ["{page} / {pages}"] } };
const header = { id: "m-title", type: "text", at: { x: 0, y: 0, w: 60, h: 4 }, content: { paragraphs: ["{title} · {{page}}"] } };
const longText = (id: string, page = 1) => ({ id, type: "text", content: { paragraphs: Array.from({ length: 40 }, () => lorem) }, at: at(0, 0, 87, undefined, page) });

const withMaster = (master: Record<string, unknown>, components: unknown[], meta: Record<string, unknown> = { title: "Relatório" }) => ({
  ...doc({ components, surfaces: [{ id: "a4", kind: "page", size: "A4", margin: 48, master }] }),
  meta,
});

describe("page master", () => {
  it("takes its reserve from the body and draws on every page with the page numbers", () => {
    const plain = engine.layout(doc({ components: [longText("t")] }));
    const r = engine.layout(withMaster({ reserve: { top: 6, bottom: 5 }, components: [header, footer] }, [longText("t")]));
    expect(r.units.rows).toBe((plain.units.rows as number) - 11);
    // The body starts below the top reserve.
    expect(r.pages[0]?.content.y).toBe(48 + 6 * 8);
    expect(r.pages.length).toBeGreaterThan(plain.pages.length - 1);
    const out = renderLayout(r, registry).html;
    const n = r.pages.length;
    for (let p = 1; p <= n; p++) expect(out).toContain(`${p} / ${n}`);
    // {{page}} is written as {page}; {title} comes from meta.
    expect(out).toContain("Relatório · {page}");
    expect(r.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  });

  it("keeps the master out of the reading order and off the map's boxes", () => {
    const r = engine.layout(withMaster({ reserve: { bottom: 5 }, components: [footer] }, [longText("t")]));
    const box = r.pages[0]?.boxes.find((b) => b.layer === "master");
    expect(box?.html).toContain('aria-hidden="true"');
    expect(box?.html).not.toContain('id="dfl-m-page"');
    const map = engine.map(withMaster({ reserve: { bottom: 5 }, components: [footer] }, [longText("t")]), { level: 1 });
    expect(map.text).toMatch(/master: 1 component\(s\) on every page · reserve 0 rows at the top, 5 at the bottom/);
    expect(map.text).not.toMatch(/page 1\/\d+ · 2 boxes/);
  });

  it("applies to the pages asked for", () => {
    const pages = (master: Record<string, unknown>) =>
      engine.layout(withMaster(master, [longText("t")])).pages.map((p) => p.boxes.some((b) => b.layer === "master"));
    expect(pages({ pages: "except-first", components: [footer] })[0]).toBe(false);
    expect(pages({ pages: "except-first", components: [footer] })[1]).toBe(true);
    expect(pages({ pages: [2], components: [footer] })).toEqual(pages({ pages: [2], components: [footer] }).map((_, i) => i === 1));
  });

  it("cuts what does not fit its h, and warns about placeholders in the body", () => {
    const tall = { ...footer, at: { x: 0, y: 120, w: 10, h: 2 }, content: { paragraphs: [lorem] } };
    const r = engine.layout(withMaster({ components: [tall] }, [{ id: "b", type: "text", content: { paragraphs: ["Página {page}"] }, at: at(0, 0, 40) }]));
    expect(r.diagnostics.find((d) => d.code === "master-overflow")?.component).toBe("m-page");
    expect(r.diagnostics.find((d) => d.code === "placeholder-outside-master")?.component).toBe("b");
  });

  it("is changed by setMaster / removeMaster, edit and update; place refuses it", () => {
    const base = doc({ components: [longText("t")] }) as unknown as LayoutDocument;
    const set = engine.apply(base, [{ op: "setMaster", master: { reserve: { bottom: 5 }, components: [footer] } }]);
    expect(set.ok).toBe(true);
    const edited = engine.apply(set.doc, [{ op: "edit", component: "m-page", set: { "paragraphs.0": "p. {page}" } }]);
    expect(edited.ok).toBe(true);
    expect(renderLayout(engine.layout(edited.doc), registry).html).toContain("p. 1");
    const placed = engine.apply(set.doc, [{ op: "place", component: "m-page", at: { y: 3 } }]);
    expect(placed.diagnostics[0]?.message).toMatch(/page master, which has no free position/);
    // A new page size keeps the master, and the footer follows the bottom of the page.
    const resized = engine.apply(set.doc, [{ op: "setSurface", surface: { id: "a4", kind: "page", size: "Letter", margin: 48 } }]);
    const kept = (resized.doc?.surfaces[0] as { master: { components: { at: { y: number; w: number } }[] } }).master;
    const letter = engine.layout(resized.doc);
    const fullRows = (letter.units.rows as number) + 5;
    expect(kept.components[0]?.at.y).toBe(fullRows - (128 - 124));
    expect(kept.components[0]?.at.w).toBe(letter.units.cols);
    expect(letter.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const removed = engine.apply(set.doc, [{ op: "removeMaster" }]);
    expect((removed.doc?.surfaces[0] as { master?: unknown }).master).toBeUndefined();
    const clash = engine.apply(base, [{ op: "setMaster", master: { components: [{ ...footer, id: "t" }] } }]);
    expect(clash.ok).toBe(false);
  });

  it("gives header and footer text the pageChrome color, which follows muted", () => {
    const out = renderLayout(engine.layout(withMaster({ components: [footer] }, [])), registry).html;
    expect(out).toContain(`color:${defaultTokens.color.pageChrome}`);
    const themed = { ...withMaster({ components: [footer] }, []), tokens: { color: { muted: "#445566" } } };
    expect(renderLayout(engine.layout(themed), registry).html).toContain("color:#445566");
  });
});

describe("cover", () => {
  const cover = (props: Record<string, unknown>, h = 120) => ({
    id: "capa",
    type: "cover",
    content: { eyebrow: "Proposta", title: "Plataforma de dados", subtitle: "Para a Acme", meta: [{ label: "Validade", value: "30 dias" }] },
    props,
    at: at(0, 0, 87, h),
  });

  it("paints a full-bleed background to the page's edges with light text on it", () => {
    const r = engine.layout(doc({ components: [cover({ background: "$color.primary", fullBleed: true })] }));
    const bleed = r.pages[0]?.boxes.find((b) => b.layer === "bleed");
    expect(bleed).toMatchObject({ x: 0, y: 0, width: r.pages[0]?.width, height: r.pages[0]?.height });
    const out = renderLayout(r, registry).html;
    expect(out).toContain(`background:${defaultTokens.color.primary}`);
    expect(out).toContain(`color:${defaultTokens.color.surface}`);
    expect(out).toContain("<h1>Plataforma de dados</h1>");
  });

  it("fills the whole page where the master is not drawn, reserve included", () => {
    const d = withMaster({ pages: "except-first", reserve: { top: 6, bottom: 5 }, components: [footer] }, [cover({ background: "#112233" }, 128), longText("t", 2)]);
    const r = engine.layout(d);
    // h 128 is the page without the reserve: no too-tall, and the box runs from margin to margin.
    expect(r.diagnostics.filter((x) => x.code === "too-tall")).toEqual([]);
    const box = r.pages[0]?.boxes.find((b) => b.component === "capa" && !b.layer);
    expect(box).toMatchObject({ y: 48, height: 128 * 8 });
    // On a page with the master, the body keeps its reserve.
    const body = r.pages[1]?.boxes.find((b) => b.component === "t");
    expect(body?.y).toBe(48 + 6 * 8);
  });

  it("says when its text does not fit", () => {
    const r = engine.layout(doc({ components: [cover({}, 8)] }));
    expect(r.diagnostics.find((d) => d.code === "cover-overflow")).toBeDefined();
  });
});

describe("table of contents", () => {
  const sections = [
    { id: "s1", type: "text", content: { paragraphs: [{ role: "title-1", text: "Introdução" }, lorem] }, at: at(0, 0, 87, undefined, 2) },
    { id: "s2", type: "flow", content: { blocks: ["## Detalhes", lorem, { type: "break" }, "# Conclusão", "fim"] }, at: at(0, 20, 87, undefined, 2) },
  ];

  it("lists the titles after it with the page each one lands on, linked", () => {
    const r = engine.layout(doc({ components: [{ id: "toc", type: "toc", at: at(0, 0, 87) }, ...sections] }));
    expect(r.components.toc?.facts).toMatchObject({ entries: 3 });
    const out = renderLayout(r, registry).html;
    expect(out).toContain("Contents");
    expect(out).toContain('href="#dfl-s1--h0"');
    expect(out).toContain('id="dfl-s1--h0"');
    // Conclusão comes after a break: page 3. The semantic list carries the page too.
    expect(out).toMatch(/<a href="#dfl-s2--b3--h0">Conclusão, 3<\/a>/);
    expect(out).toMatch(/<a href="#dfl-s2--b0--h0">Detalhes, 2<\/a>/);
  });

  it("follows props.levels and from, and says when it is empty", () => {
    const only1 = engine.layout(doc({ components: [{ id: "toc", type: "toc", props: { levels: ["title-1"] }, at: at(0, 0, 87) }, ...sections] }));
    expect(only1.components.toc?.facts).toMatchObject({ entries: 2 });
    const empty = engine.layout(doc({ components: [{ id: "toc", type: "toc", props: { from: 5 }, at: at(0, 0, 87) }, ...sections] }));
    expect(empty.diagnostics.find((d) => d.code === "toc-empty")).toBeDefined();
  });
});

describe("format 4 → 3 for page structure", () => {
  it("drops the master, turns the cover into a card and the toc into a list", () => {
    const d = withMaster({ reserve: { bottom: 5 }, components: [footer] }, [
      { id: "capa", type: "cover", content: { title: "T", meta: [{ label: "A", value: "B" }] }, props: { background: "#112233" }, at: at(0, 0, 87, 100) },
      { id: "toc", type: "toc", at: at(0, 0, 87, undefined, 2) },
      { id: "s", type: "text", content: { paragraphs: [{ role: "title-1", text: "Um" }] }, at: at(0, 0, 87, undefined, 3) },
    ]);
    const r = downgradeDocument(d, 3);
    expect(r.ok).toBe(true);
    expect((r.doc?.surfaces as object[])[0]).not.toHaveProperty("master");
    const byId = Object.fromEntries((r.doc?.components as { id: string }[]).map((c) => [c.id, c]));
    expect(byId.capa).toMatchObject({ type: "card", content: { title: "T", text: "**A:** B" }, style: { background: "#112233" } });
    expect(byId.toc).toMatchObject({ type: "list", content: { items: ["Um"] }, props: { marker: "number" } });
    expect(r.notes.join("\n")).toMatch(/master \(m-page\) was dropped/);
    expect(engine.layout(r.doc).ok).toBe(true);
  });
});
