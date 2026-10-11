import type { Inline, Run } from "../schema/content";

type Marks = Omit<Run, "text">;

/** Parse the inline markdown subset (`**bold**`, `*italic*`, `` `code` ``, `[text](url)`) into runs. */
export function parseInline(source: string): Run[] {
  const runs: Run[] = [];
  parseInto(source, {}, runs);
  return mergeRuns(runs);
}

export function inlineToRuns(inline: Inline): Run[] {
  return typeof inline === "string" ? parseInline(inline) : mergeRuns(inline.map((r) => ({ ...r })));
}

/** Plain text of inline content, for summaries and fit estimates. */
export function inlineText(inline: Inline): string {
  return inlineToRuns(inline)
    .map((r) => r.text)
    .join("");
}

function parseInto(source: string, marks: Marks, out: Run[]): void {
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ text: buffer, ...marks });
    buffer = "";
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;

    if (ch === "\\" && i + 1 < source.length) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      const end = source.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        out.push({ text: source.slice(i + 1, end), ...marks, code: true });
        i = end + 1;
        continue;
      }
    }

    if (source.startsWith("**", i)) {
      const end = findClosing(source, "**", i + 2);
      if (end !== -1) {
        flush();
        parseInto(source.slice(i + 2, end), { ...marks, bold: true }, out);
        i = end + 2;
        continue;
      }
    }

    if (ch === "*") {
      const end = findClosing(source, "*", i + 1);
      if (end !== -1 && end > i + 1) {
        flush();
        parseInto(source.slice(i + 1, end), { ...marks, italic: true }, out);
        i = end + 1;
        continue;
      }
    }

    if (ch === "[") {
      const close = source.indexOf("](", i + 1);
      const urlEnd = close === -1 ? -1 : source.indexOf(")", close + 2);
      if (close !== -1 && urlEnd !== -1) {
        flush();
        parseInto(source.slice(i + 1, close), { ...marks, link: source.slice(close + 2, urlEnd) }, out);
        i = urlEnd + 1;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }
  flush();
}

/** Index of the closing marker, skipping a `**` when looking for a single `*`. */
function findClosing(source: string, marker: string, from: number): number {
  let i = from;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source.startsWith(marker, i)) {
      if (marker === "*" && source.startsWith("**", i)) {
        const inner = findClosing(source, "**", i + 2);
        if (inner === -1) return -1;
        i = inner + 2;
        continue;
      }
      return i;
    }
    i += 1;
  }
  return -1;
}

function sameMarks(a: Run, b: Run): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.code === !!b.code &&
    a.color === b.color &&
    a.highlight === b.highlight &&
    a.link === b.link &&
    a.size === b.size
  );
}

function mergeRuns(runs: Run[]): Run[] {
  const merged: Run[] = [];
  for (const run of runs) {
    if (run.text === "") continue;
    const last = merged[merged.length - 1];
    if (last && sameMarks(last, run)) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}
