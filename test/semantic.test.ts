import { describe, expect, it } from "vitest";
import { markerLabel } from "../src/components/list";
import { at, doc, engine, example } from "./helpers";

/** Components stacked top to bottom, full width (the layout pushes each below the previous). */
const render = (components: Record<string, unknown>[], locale?: string) => {
  const d = doc({ components: components.map((c) => ({ ...c, at: at(0, 0, 87) })) });
  return engine.render(locale ? { ...d, meta: { locale } } : d).rendered.html;
};

describe("semantic layer", () => {
  it("gives text real headings, paragraphs and quotes, and hides the visual lines", () => {
    const html = render([
      { id: "t", type: "text", content: { paragraphs: [{ role: "title-1", text: "Título" }, "Corpo com **ênfase** e [link](https://doc-forge.dev).", { role: "quote", text: "Citação" }] } },
    ]);
    expect(html).toContain('<div class="dfl-sr"><h1>Título</h1><p>Corpo com <strong>ênfase</strong> e <a href="https://doc-forge.dev">link</a>.</p><blockquote>Citação</blockquote></div>');
    expect(html).toContain('<div aria-hidden="true">');
  });

  it("gives tables, lists, steps and timelines their HTML structure", () => {
    const html = render([
      { id: "tab", type: "table", content: { columns: ["A", "B"], rows: [["1", "2"]] } },
      { id: "l", type: "list", props: { marker: "number" }, content: { items: ["um", { text: "dois", items: ["dois.um"] }] } },
      { id: "s", type: "steps", content: { steps: [{ title: "Passo", text: "texto" }] } },
      { id: "tl", type: "timeline", content: { events: [{ date: "1 out", title: "Evento" }] } },
    ]);
    expect(html).toContain('<table><thead><tr><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
    expect(html).toContain("<ol><li>um</li><li>dois<ol><li>dois.um</li></ol></li></ol>");
    expect(html).toContain("<ol><li><strong>Passo</strong> texto</li></ol>");
    expect(html).toContain("<ol><li><time>1 out</time> <strong>Evento</strong></li></ol>");
  });

  it("describes a chart with a data table in the document's locale", () => {
    const html = render([{ id: "c", type: "chart", content: { kind: "bar", categories: ["Jul"], series: [{ name: "2026", values: [1.25] }] }, props: { unit: "M" } }], "pt-BR");
    expect(html).toContain("<figure><figcaption>bar chart: 2026</figcaption>");
    expect(html).toContain('<th scope="row">Jul</th><td>1,25M</td>');
  });

  it("leaves images to their own alt text", () => {
    const html = render([{ id: "i", type: "image", content: { src: "a.png", alt: "Esboço", width: 10, height: 10 } }]);
    expect(html).toContain('alt="Esboço"');
    expect(html).not.toContain('class="dfl-sr"');
  });

  it("keeps the accessible link in the semantic layer and the clickable layer out of the tab order", () => {
    const html = render([{ id: "c", type: "card", content: { title: "Card" }, props: { href: "https://doc-forge.dev" } }]);
    expect(html).toContain('<section aria-label="Card"><a href="https://doc-forge.dev"><h3>Card</h3></a></section>');
    expect(html).toMatch(/class="dfl-box-link" href="https:\/\/doc-forge.dev" tabindex="-1" aria-hidden="true"/);
  });

  it("puts the semantic copy only on the first piece of a split component", () => {
    const rows = Array.from({ length: 80 }, (_, i) => [`Linha ${i}`]);
    const html = render([{ id: "tab", type: "table", content: { columns: ["A"], rows } }]);
    expect((html.match(/class="dfl-sr"/g) ?? []).length).toBe(1);
  });
});

describe("locale and nested markers", () => {
  it("formats chart axes in the document's locale", () => {
    const pt = engine.render(example("relatorio")).rendered.html;
    expect(pt).toContain(">0,5M<");
    const en = render([{ id: "c", type: "chart", content: { kind: "bar", categories: ["a"], series: [{ name: "x", values: [1.5] }] }, props: { unit: "M" } }]);
    expect(en).toContain(">0.5M<");
  });

  it("numbers nested items 1. → a. → i. and bullets • → –", () => {
    expect([markerLabel("number", 0, 3), markerLabel("number", 1, 2), markerLabel("number", 2, 4), markerLabel("number", 3, 1)]).toEqual(["3.", "b.", "iv.", "1."]);
    expect([markerLabel("bullet", 0, 1), markerLabel("bullet", 1, 1), markerLabel("bullet", 2, 1)]).toEqual(["•", "–", "•"]);
    const html = render([{ id: "l", type: "list", props: { marker: "number" }, content: { items: [{ text: "a", items: ["b", "c"] }] } }]);
    expect(html).toContain(">a.<");
    expect(html).toContain(">b.<");
  });
});
