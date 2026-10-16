import { describe, expect, it } from "vitest";
import { DocumentSchema, downgradeDocument, formatOf, readDocument, upgradeDocument, VERSION, type LogEntry } from "../src";
import { at, doc, engine, example } from "./helpers";

const text = (id: string, page = 1) => ({ id, type: "text", content: { paragraphs: [{ role: "title-1", text: id }] }, at: at(0, 0, 60, undefined, page) });
const deck = doc({ surfaces: [{ id: "deck", kind: "page", size: "Slide", margin: 48 }], components: [text("a")] });
const logs = () => {
  const entries: LogEntry[] = [];
  return { entries, logger: (e: LogEntry) => void entries.push(e) };
};

describe("format version", () => {
  it("is 3, and documents come out in it", () => {
    expect(VERSION).toBe(3);
    expect(engine.layout(deck).doc?.version).toBe(3);
  });

  it("reads version 2 as it is (same shape) and answers in 3", () => {
    const v2 = { ...(example("relatorio") as object), version: 2 };
    const parsed = DocumentSchema.parse(v2);
    expect(parsed.version).toBe(3);
    expect(engine.layout(v2).ok).toBe(true);
    const up = upgradeDocument(v2, engine);
    expect(up.ok).toBe(true);
    expect(up.notes).toEqual(["version 2 → 3: only the number changed"]);
  });

  it("refuses a newer version and says to update the library", () => {
    const r = DocumentSchema.safeParse({ ...deck, version: 4 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/format version 4.*reads up to 3.*update @docforge-lib\/layout/);
  });

  it("formatOf reads the number or says it is not a document", () => {
    expect(formatOf(deck)).toBe(3);
    expect(formatOf({ version: "2" })).toBeNull();
    expect(formatOf(null)).toBeNull();
  });
});

describe("readDocument", () => {
  it("reads the current version silently", () => {
    const { entries, logger } = logs();
    const r = readDocument(deck, { logger });
    expect(r.ok).toBe(true);
    expect(entries).toEqual([]);
  });

  it("converts an older version up and warns", () => {
    const { entries, logger } = logs();
    const r = readDocument({ ...deck, version: 2 }, { logger, source: "anuncio.json" });
    expect(r).toMatchObject({ ok: true, from: 2 });
    expect(r.doc?.version).toBe(3);
    expect(entries.map((e) => e.code)).toEqual(["format_upgraded"]);
    expect(entries[0]?.message).toContain("anuncio.json");
  });

  it("refuses a newer version with a warning", () => {
    const { entries, logger } = logs();
    const r = readDocument({ ...deck, version: 9 }, { logger });
    expect(r).toMatchObject({ ok: false, doc: null, from: 9 });
    expect(entries.map((e) => e.code)).toEqual(["format_unsupported"]);
  });

  it("converts version 1 only with an engine", () => {
    const v1 = {
      format: "docforge/layout",
      version: 1,
      surfaces: [{ id: "a4", kind: "page", size: "A4", margin: 40 }],
      sections: [{ id: "s", bands: [{ id: "b", span: "auto", items: [{ component: "t", colStart: 1, colSpan: 12 }] }] }],
      components: [{ id: "t", type: "text", content: { paragraphs: [{ text: "hi" }] } }],
    };
    expect(readDocument(v1, { logger: () => {} }).ok).toBe(false);
    const { entries, logger } = logs();
    const r = readDocument(v1, { logger, engine });
    expect(r.ok).toBe(true);
    expect(entries.map((e) => e.code)).toEqual(["format_upgraded"]);
  });

  it("says where an invalid document is wrong", () => {
    const r = readDocument({ ...deck, surfaces: [] }, { logger: () => {} });
    expect(r.ok).toBe(false);
    expect(r.notes[0]).toMatch(/^surfaces:/);
  });
});

describe("downgradeDocument", () => {
  it("writes a slide deck as version 2 with the size spelled out", () => {
    const r = downgradeDocument(deck, 2);
    expect(r).toMatchObject({ ok: true, from: 3, to: 2 });
    const out = r.doc as { version: number; surfaces: { size: unknown }[] };
    expect(out.version).toBe(2);
    expect(out.surfaces[0]?.size).toEqual({ width: 1280, height: 720 });
    expect(r.notes.join("\n")).toMatch(/Slide size became 1280×720/);
  });

  it("writes font.heading down when the document refers to it", () => {
    const themed = { ...deck, styles: { labels: { big: { fontFamily: "$font.heading" } } } };
    const r = downgradeDocument(themed, 2);
    expect((r.doc as { tokens: { font: { heading: string } } }).tokens.font.heading).toBe("Inter");
    expect(r.notes.join("\n")).toMatch(/font\.heading written/);
  });

  it("warns about theme fonts older libraries do not bundle", () => {
    const themed = { ...deck, tokens: { font: { sans: "Inter", heading: "Source Serif 4" } } };
    const notes = downgradeDocument(themed, 2).notes.join("\n");
    expect(notes).toMatch(/titles follow font.heading \("Source Serif 4"\) only from 0.4/);
    expect(notes).toMatch(/font "Source Serif 4" is bundled from 0.4/);
  });

  it("loses nothing on a plain document, and round-trips", () => {
    const plain = example("relatorio");
    const r = downgradeDocument(plain, 2);
    expect(r.ok).toBe(true);
    expect(r.notes).toEqual([]);
    const back = engine.layout(r.doc);
    expect(back.ok).toBe(true);
    expect(back.doc?.components).toEqual(engine.layout(plain).doc?.components);
  });

  it("returns the same document for the current version", () => {
    const r = downgradeDocument(deck, 3);
    expect(r).toMatchObject({ ok: true, to: 3, notes: [] });
    expect((r.doc as { surfaces: { size: unknown }[] }).surfaces[0]?.size).toBe("Slide");
  });

  it("does not write version 1 or read an invalid document", () => {
    expect(downgradeDocument(deck, 1).ok).toBe(false);
    expect(downgradeDocument({ nope: true }, 2).ok).toBe(false);
  });
});
