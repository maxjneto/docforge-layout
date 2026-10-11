import type { Run } from "../schema/content";
import type { Tokens } from "../schema/tokens";
import type { Face, FontRegistry } from "../fonts/registry";
import { colorValue, sizeValue } from "../style/tokens";

export interface TextStyle {
  family: string;
  weight: number;
  italic: boolean;
  size: number;
  color: string;
  background: string | null;
  underline: boolean;
  href: string | null;
}

export interface StyledRun extends TextStyle {
  text: string;
}

export interface Fragment {
  text: string;
  style: TextStyle;
  face: Face;
  width: number;
}

export interface TextLine {
  fragments: Fragment[];
  width: number;
  height: number;
}

export interface TextBlock {
  lines: TextLine[];
  height: number;
  /** Widest line. */
  width: number;
  /** Characters no registered face can draw. */
  missingGlyphs: string[];
  /** Words wider than the line that had to be cut mid-word. */
  brokenWords: number;
}

export interface BaseTextStyle {
  family: string;
  weight: number;
  italic: boolean;
  size: number;
  color: string;
  lineHeight: number;
}

export interface RunStyleContext {
  tokens: Tokens;
  monoFamily: string;
  linkColor: string;
  /** Called when a run asks for a size key the scale does not have. */
  onUnknownSize?: (key: string) => void;
  /** Called for every link, so the engine can check internal targets. */
  onLink?: (href: string) => void;
}

/** Apply run marks over the paragraph's base style. */
export function styleRuns(runs: Run[], base: BaseTextStyle, ctx: RunStyleContext): StyledRun[] {
  return runs.map((run) => {
    if (run.link) ctx.onLink?.(run.link);
    let size = base.size;
    if (run.size) {
      const scaled = sizeValue(run.size, ctx.tokens);
      if (scaled === undefined) ctx.onUnknownSize?.(run.size);
      else size = scaled;
    }
    const highlight =
      run.highlight === true
        ? colorValue("$color.highlight", ctx.tokens, "#fff3b0")
        : typeof run.highlight === "string"
          ? colorValue(run.highlight, ctx.tokens, "#fff3b0")
          : null;
    return {
      text: run.text,
      family: run.code ? ctx.monoFamily : base.family,
      weight: run.bold ? Math.max(base.weight, 700) : base.weight,
      italic: run.italic ? true : base.italic,
      size,
      color: run.link && !run.color ? ctx.linkColor : colorValue(run.color, ctx.tokens, base.color),
      background: run.code && !highlight ? colorValue("$color.subtle", ctx.tokens, "#f3f4f6") : highlight,
      underline: !!run.link,
      href: run.link ?? null,
    };
  });
}

interface Part {
  run: number;
  text: string;
}

type Token = { kind: "word"; parts: Part[] } | { kind: "space"; parts: Part[] } | { kind: "break" };

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Split runs into words, spaces and hard breaks. A word may span several runs (`**cres**ceu`). */
function tokenize(runs: StyledRun[]): Token[] {
  const tokens: Token[] = [];
  let word: Part[] = [];
  const endWord = () => {
    if (word.length) tokens.push({ kind: "word", parts: word });
    word = [];
  };
  runs.forEach((run, index) => {
    const lines = run.text.replace(/\t/g, "  ").split("\n");
    lines.forEach((line, li) => {
      if (li > 0) {
        endWord();
        tokens.push({ kind: "break" });
      }
      for (const piece of line.split(/(\s+)/)) {
        if (piece === "") continue;
        if (/^\s+$/.test(piece)) {
          endWord();
          const last = tokens[tokens.length - 1];
          if (last && last.kind === "space") last.parts.push({ run: index, text: piece });
          else tokens.push({ kind: "space", parts: [{ run: index, text: piece }] });
        } else {
          word.push({ run: index, text: piece });
        }
      }
    });
  });
  endWord();
  return tokens;
}

/**
 * Break styled runs into lines no wider than `maxWidth`. The engine draws exactly
 * these lines (`white-space: pre`), so the browser never re-wraps the text and the
 * height computed here is the height on screen and in print.
 */
export function layoutText(
  runs: StyledRun[],
  options: {
    maxWidth: number;
    lineHeight: number;
    base: BaseTextStyle;
    registry: FontRegistry;
    /** Keep spaces at the start of a line (code indentation). */
    preserveLeadingSpace?: boolean;
  },
): TextBlock {
  const { maxWidth, lineHeight, base, registry } = options;
  const faceOf = (style: TextStyle) => registry.match(style.family, style.weight, style.italic);

  const fragmentsOf = (parts: Part[]): Fragment[] => {
    const fragments: Fragment[] = [];
    for (const part of parts) {
      const last = fragments[fragments.length - 1];
      const style = runs[part.run] as StyledRun;
      if (last && last.style === style) last.text += part.text;
      else fragments.push({ text: part.text, style, face: faceOf(style), width: 0 });
    }
    for (const f of fragments) f.width = registry.measure(f.face, f.style.size, f.text);
    return fragments;
  };
  const widthOf = (parts: Part[]) => fragmentsOf(parts).reduce((sum, f) => sum + f.width, 0);

  const lines: TextLine[] = [];
  let current: Part[] = [];
  let hasWord = false;
  let brokenWords = 0;

  const finish = () => {
    while (current.length && /^\s+$/.test((current[current.length - 1] as Part).text)) current.pop();
    const fragments = fragmentsOf(current);
    const height = fragments.length
      ? Math.max(...fragments.map((f) => f.style.size * lineHeight))
      : base.size * lineHeight;
    lines.push({ fragments, width: fragments.reduce((s, f) => s + f.width, 0), height });
    current = [];
    hasWord = false;
  };

  const placeWord = (parts: Part[]) => {
    let pending = parts;
    let counted = false;
    while (pending.length) {
      const candidate = [...current, ...pending];
      if (widthOf(candidate) <= maxWidth + 0.01) {
        current = candidate;
        hasWord = true;
        return;
      }
      if (hasWord) {
        finish();
        continue;
      }
      // The word alone is wider than the line: cut it at grapheme boundaries.
      if (!counted) brokenWords += 1;
      counted = true;
      const cut: Part[] = [];
      const rest: Part[] = [];
      let full = false;
      for (const part of pending) {
        if (full) {
          rest.push(part);
          continue;
        }
        let taken = "";
        const chars = [...graphemes.segment(part.text)].map((s) => s.segment);
        let index = 0;
        for (; index < chars.length; index++) {
          const next = taken + chars[index];
          if (widthOf([...cut, { run: part.run, text: next }]) > maxWidth + 0.01 && (cut.length || taken)) {
            full = true;
            break;
          }
          taken = next;
        }
        if (taken) cut.push({ run: part.run, text: taken });
        const remaining = chars.slice(index).join("");
        if (remaining) rest.push({ run: part.run, text: remaining });
      }
      current = cut;
      hasWord = true;
      finish();
      pending = rest;
    }
  };

  for (const token of tokenize(runs)) {
    if (token.kind === "break") finish();
    else if (token.kind === "space") {
      if (hasWord || options.preserveLeadingSpace) current.push(...token.parts);
    } else placeWord(token.parts);
  }
  if (current.length || lines.length === 0) finish();

  const missing = new Set<string>();
  for (const line of lines) {
    for (const f of line.fragments) for (const ch of registry.missingGlyphs(f.face, f.text)) missing.add(ch);
  }

  return {
    lines,
    height: lines.reduce((s, l) => s + l.height, 0),
    width: lines.reduce((m, l) => Math.max(m, l.width), 0),
    missingGlyphs: [...missing],
    brokenWords,
  };
}
