/**
 * What changed between the document this server wrote and the file as it is now, one line per
 * change, in words an agent can act on: which component, which text, before → after. Used to
 * tell an agent what a person (or another tool) changed since its last write, so it keeps it.
 */

type Json = Record<string, unknown>;

const MAX_TEXT = 80;

const clip = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return JSON.stringify(text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);
};

/** Every leaf that differs between `a` and `b`, by path (`paragraphs.1.text`). */
function leafChanges(a: unknown, b: unknown, path: string, out: [string, unknown, unknown][]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  const bothObjects = a !== null && b !== null && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b);
  if (!bothObjects) {
    out.push([path, a, b]);
    return;
  }
  const keys = new Set([...Object.keys(a as Json), ...Object.keys(b as Json)]);
  for (const key of keys) leafChanges((a as Json)[key], (b as Json)[key], path ? `${path}.${key}` : key, out);
}

export function outsideChanges(written: unknown, current: unknown): string[] {
  const list = (doc: unknown) => new Map((((doc as Json | null)?.components as Json[] | undefined) ?? []).map((c) => [String(c.id), c]));
  const before = list(written);
  const after = list(current);
  const lines: string[] = [];
  for (const [id, c] of after) {
    const old = before.get(id);
    if (!old) {
      lines.push(`${id}  added (${String(c.type)})`);
      continue;
    }
    const changes: [string, unknown, unknown][] = [];
    for (const part of ["content", "props", "style", "labels"]) leafChanges(old[part], c[part], part, changes);
    for (const [path, from, to] of changes) {
      if (from === undefined) lines.push(`${id}  ${path} set to ${clip(to)}`);
      else if (to === undefined) lines.push(`${id}  ${path} removed (was ${clip(from)})`);
      else lines.push(`${id}  ${path}: ${clip(from)} → ${clip(to)}`);
    }
    if (JSON.stringify(old.at) !== JSON.stringify(c.at)) lines.push(`${id}  moved or resized`);
  }
  for (const id of before.keys()) if (!after.has(id)) lines.push(`${id}  removed`);
  const settings = ["tokens", "styles", "surfaces", "grid", "meta"].filter(
    (key) => JSON.stringify((written as Json | null)?.[key]) !== JSON.stringify((current as Json | null)?.[key]),
  );
  if (settings.length) lines.push(`document settings changed: ${settings.join(", ")}`);
  return lines;
}
