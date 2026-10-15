/**
 * Partial edits of a component's content (`edit`, `replaceText`): change one
 * paragraph, cell or item without sending the whole content back.
 */

type Json = unknown;

function parsePath(path: string): (string | number)[] | null {
  const parts = path.split(".");
  if (parts.some((p) => p === "")) return null;
  return parts.map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Walk to the parent of the last segment. Returns the container or an error. */
function parentOf(root: Record<string, Json>, segments: (string | number)[], path: string): { parent: Json; key: string | number } | string {
  let node: Json = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i] as string | number;
    const next: Json = Array.isArray(node) && typeof key === "number" ? node[key] : isObject(node) && typeof key === "string" ? node[key] : undefined;
    if (next === undefined) return `"${path}": nothing at "${segments.slice(0, i + 1).join(".")}".`;
    // A plain-string paragraph or item addressed as an object: `paragraphs.1.text` on "olá".
    if (typeof next === "string" && segments[i + 1] === "text" && i + 1 === segments.length - 1) {
      return { parent: node, key };
    }
    node = next;
  }
  return { parent: node, key: segments[segments.length - 1] as string | number };
}

/** Apply `set` then `remove` to a copy of the content. Returns the new content or a message. */
export function editContent(content: Json, set: Record<string, Json> = {}, remove: string[] = []): { content: Json } | { error: string } {
  const root: Record<string, Json> = isObject(content) ? structuredClone(content) : {};
  for (const [path, value] of Object.entries(set)) {
    const segments = parsePath(path);
    if (!segments) return { error: `"${path}" is not a valid path (use dots: paragraphs.1).` };
    const found = parentOf(root, segments, path);
    if (typeof found === "string") return { error: found };
    const { parent, key } = found;
    if (Array.isArray(parent)) {
      if (typeof key !== "number") return { error: `"${path}": "${key}" is a list; use a position number.` };
      if (key > parent.length) return { error: `"${path}": position ${key} is past the end (the list has ${parent.length}).` };
      parent[key] = structuredClone(value);
    } else if (isObject(parent)) {
      if (typeof key !== "string") return { error: `"${path}": ${key} is a position, but this is not a list.` };
      parent[key] = structuredClone(value);
    } else {
      return { error: `"${path}": cannot set inside a ${typeof parent}.` };
    }
  }
  // Remove deepest/last first, so earlier removals do not shift later paths of the same list.
  const ordered = [...remove].sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  for (const path of ordered) {
    const segments = parsePath(path);
    if (!segments) return { error: `"${path}" is not a valid path (use dots: items.3).` };
    const found = parentOf(root, segments, path);
    if (typeof found === "string") return { error: found };
    const { parent, key } = found;
    if (Array.isArray(parent) && typeof key === "number" && key < parent.length) parent.splice(key, 1);
    else if (isObject(parent) && typeof key === "string" && key in parent) delete parent[key];
    else return { error: `"${path}": nothing to remove there.` };
  }
  return { content: root };
}

/** Keys whose strings are not visible text (urls, enums, colors…). */
const NOT_TEXT = new Set(["src", "kind", "trend", "role", "align", "language", "link", "href", "color", "highlight", "size", "marker", "fit"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace text in every visible string of the content. Returns the new content and how many hits. */
export function replaceInContent(content: Json, find: string, replace: string, matchCase: boolean): { content: Json; count: number } {
  const pattern = new RegExp(escapeRegExp(find), matchCase ? "g" : "gi");
  let count = 0;
  const walk = (node: Json, key: string | null): Json => {
    if (typeof node === "string") {
      if (key !== null && NOT_TEXT.has(key)) return node;
      return node.replace(pattern, () => {
        count++;
        return replace;
      });
    }
    if (Array.isArray(node)) return node.map((item) => walk(item, null));
    if (isObject(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    return node;
  };
  return { content: walk(content, null), count };
}
