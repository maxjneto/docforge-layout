import { describe, expect, it } from "vitest";
import { parseInline } from "../src/text/inline";
import { layoutText, styleRuns, type BaseTextStyle } from "../src/text/layout";
import { defaultTokens } from "../src/schema/tokens";
import { registry } from "./helpers";

const base: BaseTextStyle = { family: "Inter", weight: 400, italic: false, size: 15, color: "#000", lineHeight: 1.5 };
const runCtx = { tokens: defaultTokens, monoFamily: "JetBrains Mono", linkColor: "#00f" };
const layout = (text: string, maxWidth: number) =>
  layoutText(styleRuns(parseInline(text), base, runCtx), { maxWidth, lineHeight: 1.5, base, registry });

describe("parseInline", () => {
  it("parses bold, italic, code and links", () => {
    const runs = parseInline("a **b** *c* `d` [e](http://x) f");
    expect(runs).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", italic: true },
      { text: " " },
      { text: "d", code: true },
      { text: " " },
      { text: "e", link: "http://x" },
      { text: " f" },
    ]);
  });

  it("keeps unmatched markers as text and honors escapes", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ text: "2 * 3 = 6" }]);
    expect(parseInline(String.raw`\*literal\*`)).toEqual([{ text: "*literal*" }]);
  });

  it("nests italic inside bold", () => {
    expect(parseInline("**a *b* c**")).toEqual([
      { text: "a ", bold: true },
      { text: "b", bold: true, italic: true },
      { text: " c", bold: true },
    ]);
  });
});

describe("layoutText", () => {
  const text =
    "A receita cresceu doze por cento sobre o trimestre anterior, puxada por contratos anuais na região Sudeste e por três renovações antecipadas.";

  it("never produces a line wider than the box", () => {
    for (const width of [80, 140, 233, 400, 611]) {
      const block = layout(text, width);
      for (const line of block.lines) expect(line.width).toBeLessThanOrEqual(width + 0.01);
    }
  });

  it("is deterministic and height is lines × line height", () => {
    const a = layout(text, 233);
    const b = layout(text, 233);
    expect(a.lines.map((l) => l.width)).toEqual(b.lines.map((l) => l.width));
    expect(a.height).toBeCloseTo(a.lines.length * 15 * 1.5, 6);
  });

  it("keeps every word and drops only the spaces at line breaks", () => {
    const block = layout(text, 150);
    const joined = block.lines.map((l) => l.fragments.map((f) => f.text).join("")).join(" ");
    expect(joined).toBe(text);
  });

  it("does not split a word that spans two runs", () => {
    const block = layout("aaaa **bbbb**cccc dddd", 120);
    const lines = block.lines.map((l) => l.fragments.map((f) => f.text).join(""));
    expect(lines.some((l) => l.includes("bbbbcccc"))).toBe(true);
  });

  it("honors hard breaks and keeps empty lines", () => {
    const block = layout("um\n\ndois", 500);
    expect(block.lines.map((l) => l.fragments.map((f) => f.text).join(""))).toEqual(["um", "", "dois"]);
  });

  it("cuts a word wider than the line and counts it", () => {
    const block = layout("https://example.com/a/very/long/path/that/cannot/fit", 90);
    expect(block.brokenWords).toBe(1);
    expect(block.lines.length).toBeGreaterThan(1);
    for (const line of block.lines) expect(line.width).toBeLessThanOrEqual(90.01);
  });

  it("uses the tallest run for the line height", () => {
    const runs = styleRuns([{ text: "pequeno " }, { text: "grande", size: "xl" }], base, runCtx);
    const block = layoutText(runs, { maxWidth: 500, lineHeight: 1.5, base, registry });
    expect(block.lines[0]?.height).toBeCloseTo(22 * 1.5, 6);
  });

  it("measures bold wider than regular", () => {
    const regular = layout("Margem bruta", 1000).width;
    const bold = layout("**Margem bruta**", 1000).width;
    expect(bold).toBeGreaterThan(regular);
  });
});
