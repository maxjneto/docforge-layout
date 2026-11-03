import { describe, expect, it } from "vitest";
import { downgradeDocument, renderLayout, resolveStyle, VERSION } from "../src";
import { defaultPresets } from "../src/style/presets";
import { defaultTokens } from "../src/schema/tokens";
import { at, doc, engine, registry, single } from "./helpers";

const base = { tokens: defaultTokens, presets: defaultPresets, document: {}, regions: [], labelStyles: {}, componentLabels: [] as string[] };

const table = {
  id: "t",
  type: "table",
  content: { columns: ["Item", "Dono"], rows: [["a", "b"], ["c", "d"], ["e", "f"]] },
  props: { zebra: true },
};

describe("style per part of a component", () => {
  it("layers the part's own style over the component's, with its own origin", () => {
    const r = resolveStyle({ ...base, componentStyle: { color: "$color.muted", fontWeight: 600 }, componentStyles: { header: { color: "$color.danger" } } }, "table", "header");
    expect(r.style.color).toBe(defaultTokens.color.danger);
    expect(r.withOrigin.color.origin).toBe("component[header]");
    expect(r.withOrigin.fontWeight.origin).toBe("component");
    // Without a variant the part's style plays no role.
    expect(resolveStyle({ ...base, componentStyles: { header: { color: "$color.danger" } } }, "table").style.color).toBe(defaultTokens.color.text);
  });

  it("accepts `styles` on a component and warns about a part the type does not have", () => {
    const ok = engine.layout(single({ ...table, styles: { header: { background: "$color.primary", color: "$color.surface" } } }));
    expect(ok.ok).toBe(true);
    expect(ok.diagnostics.filter((d) => d.code === "unknown-part")).toEqual([]);
    const html = renderLayout(ok, registry).html;
    expect(html).toContain(`background:${defaultTokens.color.primary}`);

    const odd = engine.layout(single({ ...table, styles: { footer: { color: "$color.danger" } } }));
    expect(odd.ok).toBe(true);
    const warning = odd.diagnostics.find((d) => d.code === "unknown-part");
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain('"footer"');
    expect(warning?.suggestions?.[0]).toContain("header, zebra");
  });

  it("colors striped rows from the zebra part, and the steps badge from the number part", () => {
    const plain = renderLayout(engine.layout(single(table)), registry).html;
    expect(plain).toContain(`background:${defaultTokens.color.subtle}`);
    const striped = renderLayout(engine.layout(single({ ...table, styles: { zebra: { background: "$color.highlight" } } })), registry).html;
    expect(striped).toContain(`background:${defaultTokens.color.highlight}`);

    const steps = { id: "s", type: "steps", content: { steps: [{ title: "Um" }, { title: "Dois" }] } };
    const html = renderLayout(engine.layout(single({ ...steps, styles: { number: { background: "$color.danger", color: "$color.text" } } })), registry).html;
    expect(html).toContain(`background:${defaultTokens.color.danger}`);
    expect(html).toContain(`color:${defaultTokens.color.text}`);
  });

  it("marks the parts in the drawing so an editor can find them", () => {
    const d = doc({
      components: [
        { ...table, at: at(0, 0, 60) },
        { id: "k", type: "kpi", content: { value: "12", label: "Leads", delta: "+2" }, at: at(0, 30, 30) },
        { id: "c", type: "card", content: { eyebrow: "Plano", title: "Pro", footer: "Ver" }, at: at(30, 30, 30) },
        { id: "x", type: "text", content: { paragraphs: [{ role: "title-2", text: "Título" }, "Corpo"] }, at: at(0, 60, 60) },
      ],
    });
    const html = renderLayout(engine.layout(d), registry).html;
    for (const part of ["header", "zebra", "label", "delta", "eyebrow", "title", "footer", "title-2", "body"]) expect(html).toContain(`data-part="${part}"`);
  });

  it("merges, removes and clears part styles through the update op", () => {
    const start = single({ ...table, styles: { header: { color: "$color.danger" } } });
    const merged = engine.apply(start, [{ op: "update", component: "t", styles: { header: { fontWeight: 700 }, zebra: { background: "$color.highlight" } } }]);
    expect(merged.ok).toBe(true);
    const t = merged.doc?.components[0] as { styles?: Record<string, unknown> };
    expect(t.styles).toEqual({ header: { color: "$color.danger", fontWeight: 700 }, zebra: { background: "$color.highlight" } });

    const removed = engine.apply(merged.doc, [{ op: "update", component: "t", styles: { zebra: null } }]);
    expect((removed.doc?.components[0] as { styles?: unknown }).styles).toEqual({ header: { color: "$color.danger", fontWeight: 700 } });

    const cleared = engine.apply(removed.doc, [{ op: "update", component: "t", styles: null }]);
    expect((cleared.doc?.components[0] as { styles?: unknown }).styles).toBeUndefined();

    const refused = engine.apply(start, [{ op: "update", component: "t", styles: { header: { shadow: 1 } } }]);
    expect(refused.ok).toBe(false);
  });

  it("writes format 4 and drops part styles when asked for format 3", () => {
    expect(VERSION).toBe(4);
    const d = { ...single({ ...table, styles: { header: { color: "$color.danger" } } }), styles: { document: { "table.zebra": { background: "$color.highlight" }, table: { gap: "$space.1" } } } };
    const down = downgradeDocument(d, 3);
    expect(down.ok).toBe(true);
    expect(down.doc?.version).toBe(3);
    expect((down.doc?.components as { styles?: unknown }[])[0]?.styles).toBeUndefined();
    expect((down.doc?.styles as { document: Record<string, unknown> }).document).toEqual({ table: { gap: "$space.1" } });
    expect(down.notes.join("\n")).toContain("header");
    expect(down.notes.join("\n")).toContain("table.zebra");
  });
});
