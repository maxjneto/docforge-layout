import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLayoutServer } from "../src/server";
import { at, doc, engine, example } from "./helpers";

const d = doc({
  components: [
    { id: "t", type: "text", content: { paragraphs: [{ role: "title-1", text: "Relatório **Q3**" }, "Com <b>tags</b> & aspas \"duplas\"."] }, at: at(0, 0, 87) },
    { id: "k", type: "kpi", content: { value: "42", label: "Clientes" }, at: at(0, 20, 28, 14) },
    { id: "s", type: "steps", content: { steps: [{ title: "Primeiro" }] }, at: at(30, 20, 40) },
  ],
});

describe("page SVG", () => {
  const svg = engine.renderSvg(d, { page: 1 });

  it("draws every visible text with the real font family, escaped", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('font-family="Inter"');
    expect(svg).toMatch(/>Relatório\s*<\/text>/);
    expect(svg).toContain("&#60;b&#62;tags&#60;/b&#62;");
    expect(svg).not.toContain("<b>");
    expect(svg).not.toContain("DFL ");
    // A step's number is plain text in a div; it must be drawn too.
    expect(svg).toMatch(/>1<\/text>/);
  });

  it("draws the KPI box and leaves the accessible layer out", () => {
    expect(svg).toMatch(/<rect [^>]*rx="\d/);
    expect(svg).not.toContain("<h1");
  });

  it("outlines highlighted components and refuses a page that does not exist", () => {
    expect(engine.renderSvg(d, { page: 1, highlight: ["k"] })).toContain('stroke-dasharray="6 4"');
    expect(() => engine.renderSvg(d, { page: 3 })).toThrow(/page 3 does not exist/);
  });

  it("embeds the charts of a real document", () => {
    expect(engine.renderSvg(example("relatorio"), { page: 1 })).toMatch(/<g transform="translate\([\d.]+ [\d.]+\)"><svg/);
  });
});

describe("POST /render-image", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 3, 25, 0, 0, 4, 98]);
  const seen: { svg: string; scale: number }[] = [];
  const withRaster = createLayoutServer({ engine, onError: () => {}, rasterize: (svg, scale) => (seen.push({ svg, scale }), png) });
  const svgOnly = createLayoutServer({ engine, onError: () => {} });
  const urls: string[] = [];
  beforeAll(async () => {
    for (const s of [withRaster, svgOnly]) {
      await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
      urls.push(`http://127.0.0.1:${(s.address() as AddressInfo).port}`);
    }
  });
  afterAll(async () => {
    for (const s of [withRaster, svgOnly]) await new Promise<void>((resolve) => s.close(() => resolve()));
  });
  const post = async (url: string, body: unknown) => {
    const res = await fetch(`${url}/render-image`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("answers with a PNG and its size when a rasterizer is plugged in", async () => {
    const { status, body } = await post(urls[0] as string, { doc: d, page: 1, scale: 0.5, highlight: ["k"] });
    expect(status).toBe(200);
    expect(body).toMatchObject({ page: 1, pages: 1, width: 793, height: 1122 });
    expect(Buffer.from(String(body.png), "base64")).toEqual(Buffer.from(png));
    expect(seen[0]?.scale).toBe(0.5);
    expect(seen[0]?.svg).toContain("stroke-dasharray");
  });

  it("answers with the SVG alone without one, and checks its input", async () => {
    const { body } = await post(urls[1] as string, { doc: d });
    expect(body.png).toBeNull();
    expect(String(body.svg)).toMatch(/^<svg/);
    expect((await post(urls[1] as string, { doc: d, page: 2 })).status).toBe(400);
    expect((await post(urls[1] as string, { doc: d, scale: 9 })).status).toBe(400);
  });
});
