import { describe, expect, it } from "vitest";
import { resolveStyle } from "../src/style/resolve";
import { defaultPresets } from "../src/style/presets";
import { defaultTokens } from "../src/schema/tokens";

const base = { tokens: defaultTokens, presets: defaultPresets, document: {}, regions: [], labelStyles: {}, componentLabels: [] as string[] };

describe("style cascade", () => {
  it("resolves presets with tokens and records the origin", () => {
    const r = resolveStyle(base, "text", "title-1");
    expect(r.style.fontSize).toBe(28);
    expect(r.withOrigin.fontSize.origin).toBe("preset");
    expect(r.withOrigin.fontSize.written).toBe("$size.xxl");
    expect(r.issues).toEqual([]);
  });

  it("applies document → region → label → component in order", () => {
    const r = resolveStyle(
      {
        ...base,
        document: { text: { color: "$color.muted", fontSize: "$size.s" } },
        regions: [{ id: "r1", section: "s1", style: { color: "$color.danger" } }],
        labelStyles: { forte: { fontWeight: 700, color: "$color.success" } },
        componentLabels: ["forte"],
        componentStyle: { align: "center" },
      },
      "text",
      "body",
    );
    expect(r.withOrigin.fontSize.origin).toBe("document[text]");
    expect(r.withOrigin.color.origin).toBe("label:forte");
    expect(r.style.color).toBe(defaultTokens.color.success);
    expect(r.withOrigin.fontWeight.origin).toBe("label:forte");
    expect(r.withOrigin.align.origin).toBe("component");
  });

  it("falls back to the layer below on an unknown or wrong-group token", () => {
    const r = resolveStyle({ ...base, componentStyle: { fontSize: "$size.huge", color: "$space.2" } }, "text");
    expect(r.style.fontSize).toBe(15);
    expect(r.style.color).toBe(defaultTokens.color.text);
    expect(r.issues.map((i) => i.problem).sort()).toEqual(["unknown-token", "wrong-group"]);
  });

  it("reports raw values outside presets", () => {
    const r = resolveStyle({ ...base, componentStyle: { color: "#ff0000", fontSize: 17 } }, "text");
    expect(r.style.color).toBe("#ff0000");
    expect(r.style.fontSize).toBe(17);
    expect(r.issues.filter((i) => i.problem === "raw-value")).toHaveLength(2);
  });

  it("reports labels that disagree", () => {
    const r = resolveStyle(
      {
        ...base,
        labelStyles: { a: { color: "$color.primary" }, b: { color: "$color.danger" } },
        componentLabels: ["a", "b"],
      },
      "text",
    );
    expect(r.style.color).toBe(defaultTokens.color.danger);
    const conflict = r.issues.find((i) => i.problem === "conflict");
    expect(conflict?.origins).toEqual(["label:a", "label:b"]);
  });

  it("treats background none as no background", () => {
    const r = resolveStyle({ ...base, componentStyle: { background: "none" } }, "code");
    expect(r.style.background).toBeNull();
  });
});
