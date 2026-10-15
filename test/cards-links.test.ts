import { describe, expect, it } from "vitest";
import { at, doc, engine, example, single } from "./helpers";

const card = (extra: Record<string, unknown> = {}) => ({
  id: "c",
  type: "card",
  content: { eyebrow: "FORMATO", title: "Componentes numa grade", value: "99,9%", text: "texto do card", footer: "Ver mais →" },
  ...extra,
});

describe("card", () => {
  it("stacks its parts, is boxed by default and never splits", () => {
    const r = engine.layout(single(card(), 28));
    const g = r.components.c;
    expect(g?.facts).toMatchObject({ parts: 5 });
    expect(g?.style.borderWidth.value).toBe(1);
    expect(g?.style.padding.value).toBe(16);
    expect(r.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(r.pages[0]?.boxes[0]?.html).toContain(">FORMATO<");
  });

  it("grows like any content component when its h is too short", () => {
    const r = engine.layout(single(card(), 28, 4));
    expect(r.components.c?.grew).toBeGreaterThan(0);
  });

  it("KPIs look like cards by default", () => {
    const r = engine.layout(single({ id: "k", type: "kpi", content: { value: "42", label: "x" } }, 28));
    expect(r.components.k?.style.background.origin).toBe("preset");
    expect(r.components.k?.style.background.value).not.toBeNull();
  });
});

describe("links", () => {
  it("makes a card with href clickable and points #ids at their anchors", () => {
    const d = doc({
      components: [
        card({ props: { href: "#t" }, at: at(0, 0, 28) }),
        { id: "t", type: "text", content: { paragraphs: ["Veja o [card](#c) ou o [site](https://doc-forge.dev)."] }, at: at(0, 40, 87) },
      ],
    });
    const r = engine.layout(d);
    const html = r.pages.flatMap((p) => p.boxes.map((b) => b.html)).join("");
    expect(html).toContain('class="dfl-box-link" href="#dfl-t"');
    expect(html).toContain('id="dfl-t"');
    expect(html).toContain('id="dfl-c"');
    expect(html).toContain('href="#dfl-c"');
    expect(html).toContain('href="https://doc-forge.dev"');
    expect(r.diagnostics.some((x) => x.code === "unknown-link-target")).toBe(false);
  });

  it("warns about internal links to nothing", () => {
    const d = single({ id: "t", type: "text", content: { paragraphs: ["Ir para [lugar nenhum](#nada)."] } });
    const warning = engine.layout(d).diagnostics.find((x) => x.code === "unknown-link-target");
    expect(warning?.component).toBe("t");
    expect(warning?.message).toContain("#nada");
  });

  it("puts each component anchor only on its first piece when split", () => {
    const rows = Array.from({ length: 80 }, (_, i) => [`Linha ${i}`, `${i}`]);
    const d = single({ id: "tab", type: "table", content: { columns: ["a", "b"], rows } });
    const r = engine.layout(d);
    const html = r.pages.flatMap((p) => p.boxes.map((b) => b.html)).join("");
    expect((html.match(/id="dfl-tab"/g) ?? []).length).toBe(1);
  });

  it("examples link to existing targets", () => {
    for (const name of ["relatorio", "one-pager", "proposta"]) {
      expect(engine.layout(example(name)).diagnostics.filter((d) => d.code === "unknown-link-target")).toEqual([]);
    }
  });
});
