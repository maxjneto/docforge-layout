import { describe, expect, it } from "vitest";
import { cssSafe, esc, h, safeHref, safeSrc, styleString } from "../src/render/h";
import { at, doc, engine } from "./helpers";

const text = (paragraphs: unknown[], extra: Record<string, unknown> = {}) =>
  doc({ components: [{ id: "t", type: "text", content: { paragraphs }, at: at(0, 0, 87), ...extra }] });

/** Rendered HTML must never contain an executable link, an event handler or a raw script tag. */
function assertInert(html: string) {
  expect(html).not.toMatch(/href="\s*javascript:/i);
  expect(html).not.toMatch(/href="\s*data:/i);
  // An event handler inside a real tag. Quoted attribute values are dropped first: the
  // builder escapes `"` and `<` in them, so text like `onerror=` inside a value is inert.
  const tags = html.replace(/="[^"]*"/g, '=""');
  expect(tags).not.toMatch(/<[a-z][^<>]*\son[a-z]+\s*=/i);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<iframe/i);
}

describe("URL allowlist", () => {
  it("accepts only http(s), mailto and #id links", () => {
    expect(safeHref("https://doc-forge.dev")).toBe("https://doc-forge.dev");
    expect(safeHref("mailto:a@example.com")).toBe("mailto:a@example.com");
    expect(safeHref("#tabela")).toBe("#dfl-tabela");
    for (const bad of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>", "vbscript:x", "#bad id", "#\"><script>"]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });

  it("accepts images over http(s), relative paths and data:image only", () => {
    expect(safeSrc("https://x.dev/a.png")).not.toBeNull();
    expect(safeSrc("img/a.png")).not.toBeNull();
    expect(safeSrc("data:image/svg+xml;utf8,<svg/>")).not.toBeNull();
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd"]) {
      expect(safeSrc(bad), bad).toBeNull();
    }
  });
});

describe("HTML builder", () => {
  it("escapes attribute values and text", () => {
    expect(h("div", { title: '"><script>alert(1)</script>' }, esc("<b>"))).toBe(
      '<div title="&#34;&#62;&#60;script&#62;alert(1)&#60;/script&#62;">&#60;b&#62;</div>',
    );
  });

  it("refuses event handlers and invalid names", () => {
    expect(() => h("div", { onclick: "x" })).toThrow();
    expect(() => h("div", { "x y": "1" })).toThrow();
    expect(() => h("div><script", {})).toThrow();
  });

  it("strips CSS that could escape a declaration or load a URL", () => {
    expect(cssSafe('red;background:url(https://evil)')).toBe("redbackground:https://evil)");
    expect(styleString({ color: 'red" onmouseover="alert(1)' })).not.toContain('"');
  });
});

describe("documents with hostile content", () => {
  it("rejects javascript: links in runs and in href props at the schema", () => {
    const run = engine.layout(text([[{ text: "x", link: "javascript:alert(1)" }]]));
    expect(run.ok).toBe(false);
    expect(run.diagnostics[0]?.code).toBe("schema");
    const card = engine.layout(
      doc({ components: [{ id: "c", type: "card", content: { title: "x" }, props: { href: "javascript:alert(1)" }, at: at(0, 0, 28) }] }),
    );
    expect(card.ok).toBe(false);
  });

  it("renders a markdown javascript: link as plain text and reports it", () => {
    const r = engine.render(text(["[clique](javascript:alert(document.cookie))"]));
    assertInert(r.page);
    expect(r.page).toContain("clique");
    expect(r.layout.diagnostics.find((d) => d.code === "unsafe-link")?.severity).toBe("error");
  });

  it("rejects colors and font names that are not colors or names", () => {
    for (const style of [
      { color: 'red;" onmouseover="alert(1)' },
      { background: "url(https://evil.example/x.png)" },
      { color: "expression(alert(1))" },
      { fontFamily: "Inter'; } body { display:none" },
    ]) {
      const r = engine.layout(text(["x"], { style }));
      expect(r.ok, JSON.stringify(style)).toBe(false);
    }
    const tokens = engine.layout({ ...text(["x"]), tokens: { color: { primary: 'red" onload="x' } } });
    expect(tokens.ok).toBe(false);
  });

  it("escapes text content everywhere it is drawn", () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const d = doc({
      components: [
        { id: "t", type: "text", content: { paragraphs: [hostile, { role: "quote", text: hostile }] }, at: at(0, 0, 87) },
        { id: "tab", type: "table", content: { columns: [hostile], rows: [[hostile]] }, at: at(0, 20, 87) },
        { id: "ch", type: "chart", content: { kind: "bar", categories: [hostile], series: [{ name: hostile, values: [1] }] }, at: at(0, 40, 87) },
        { id: "k", type: "kpi", content: { value: "1", label: hostile, delta: hostile }, at: at(0, 80, 28) },
        { id: "c", type: "card", content: { eyebrow: hostile, title: hostile, text: hostile, footer: hostile }, at: at(30, 80, 57) },
      ],
    });
    const { page } = engine.render(d, { grid: true });
    assertInert(page);
    expect(page).not.toContain("<img src=x");
  });

  it("an image with a hostile src fails the schema", () => {
    const r = engine.layout(
      doc({ components: [{ id: "i", type: "image", content: { src: "javascript:alert(1)", alt: "x", width: 10, height: 10 }, at: at(0, 0, 43) }] }),
    );
    expect(r.ok).toBe(false);
  });
});
