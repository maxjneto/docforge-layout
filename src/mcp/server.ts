/**
 * A Model Context Protocol server over stdio, for agents that work on layout
 * documents as local files (`*.docforge.json`) — no DocForge account needed.
 *
 *   npx docforge-layout mcp [--root <folder>]
 *   claude mcp add docforge-layout -- npx docforge-layout mcp --root .
 *
 * The protocol is newline-delimited JSON-RPC 2.0. Only what this server needs is
 * implemented: initialize, ping, tools/list, tools/call, resources/list,
 * resources/read (and an empty prompts/list). Every path is resolved inside the
 * root folder; anything outside is refused. Before a file is overwritten, the
 * previous version is kept in `.docforge-history/` next to it (the last 20).
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import type { Engine } from "../engine";
import type { FindQuery } from "../query/find";
import type { CalibrateTarget } from "../query/calibrate";
import { emptyDocument } from "../schema/document";
import { upgradeDocument } from "../upgrade";
import { LIB_VERSION } from "../version";
import { AGENT_GUIDE } from "./guide";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const GUIDE_URI = "docforge-layout://guide";
const HISTORY_KEEP = 20;

type Json = Record<string, unknown>;
interface Request {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Json;
}
interface Response {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

class ToolError extends Error {}

const text = (value: string, isError = false) => ({ content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });

const obj = (properties: Json, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const PATH = { type: "string", description: "Path of the .docforge.json file, relative to the server root." };
const OPS = { type: "array", items: { type: "object" }, description: "Operations, applied in order (see the guide)." };
const MAP_MODE = { type: "string", enum: ["summary", "pages", "full"], description: "summary (default): what changed, in a few lines. pages: plus the map of `pages`. full: plus the whole map." };
const PAGES = { type: "array", items: { type: "integer", minimum: 1 }, description: "Only these 1-based pages in the map." };

const TOOLS = [
  {
    name: "get_layout_guide",
    description: "How layout documents work: positions, operations, every component's content, and how to build a page in few calls. The same text as the resource docforge-layout://guide.",
    inputSchema: obj({}),
  },
  {
    name: "create_layout_document",
    description:
      "Create a layout document file. Without content it starts empty (one A4 page). First time? Read the guide (get_layout_guide): it shows every component's content and how to build a page in one apply_layout_ops.",
    inputSchema: obj({ path: PATH, title: { type: "string" }, content: { type: "object", description: "A full layout document (current format version)." } }, ["path"]),
  },
  {
    name: "get_layout_map",
    description:
      "Read a layout document as text. Level 0: outline. Level 1: settings, each page drawn in ASCII (one character per unit) and a table of its components. Level 2: components in full, with style origins.",
    inputSchema: obj({ path: PATH, level: { type: "integer", enum: [0, 1, 2] }, pages: PAGES, components: { type: "array", items: { type: "string" } }, draw: { type: "boolean" } }, ["path"]),
  },
  {
    name: "get_layout_document",
    description: "The raw JSON of a layout document (for exact content before an update).",
    inputSchema: obj({ path: PATH }, ["path"]),
  },
  {
    name: "apply_layout_ops",
    description:
      "Change a layout document file with operations and save it. Refused (file untouched) only for a malformed op, an unknown id or an invalid document; layout side effects are applied and reported. The previous version is kept in .docforge-history/.",
    inputSchema: obj({ path: PATH, ops: OPS, map: MAP_MODE, pages: PAGES }, ["path", "ops"]),
  },
  {
    name: "undo_layout_change",
    description:
      "Take back the last change to a layout document file (or the last `steps` changes) from its .docforge-history/. Undoing again goes one more step back; the version you replace is kept in the history as well. Use it instead of deleting and recreating a file.",
    inputSchema: obj({ path: PATH, steps: { type: "integer", minimum: 1, description: "How many changes to take back (default 1)." } }, ["path"]),
  },
  {
    name: "preview_layout",
    description: "What ops would do to a file, or a whole draft document (content), without saving anything. With ops, answers with a short summary unless map is pages or full.",
    inputSchema: obj({ path: PATH, content: { type: "object" }, ops: OPS, map: MAP_MODE, pages: PAGES }),
  },
  {
    name: "measure_component",
    description:
      "How tall components would be at given widths, without placing them. Writes already report every size, so use this only to choose between widths, with all candidates in one call (components). With path, measured with that document's styles.",
    inputSchema: obj(
      {
        component: { type: "object", description: "{id, type, content, props?, style?, labels?}" },
        components: { type: "array", items: { type: "object" }, description: "Several components measured in one call (instead of component)." },
        widths: { type: "array", items: { type: "integer", minimum: 1 } },
        cols: { type: "array", items: { type: "array", items: { type: "integer", minimum: 1 }, minItems: 2, maxItems: 2 } },
        path: PATH,
      },
    ),
  },
  {
    name: "review_layout",
    description:
      "Composition review: boxes much taller than their content, side-by-side boxes with uneven tops or heights, edges just off a guide, a near-empty last page, several main titles. Each finding comes with the ops that fix it (preview them first).",
    inputSchema: obj({ path: PATH }, ["path"]),
  },
  {
    name: "find_layout",
    description: "Find components by text (case and accents ignored), type, class, page, area {page?, x, y, w, h} or state (error, warning, moved, grew, split, clamped, tight).",
    inputSchema: obj(
      {
        path: PATH,
        text: { type: "string" },
        type: { type: "array", items: { type: "string" } },
        label: { type: "string" },
        page: { type: "integer", minimum: 1 },
        rect: { type: "object" },
        state: { type: "string" },
      },
      ["path"],
    ),
  },
  {
    name: "calibrate_style",
    description:
      "Compare style variants for a component, a class or a selector side by side — height, growth, pages, what else would move, problems — without applying any. Then apply the one you choose.",
    inputSchema: obj(
      {
        path: PATH,
        target: { type: "object", description: "Exactly one of {component}, {label} or {selector} (a type, or type.role)." },
        variants: { type: "array", items: { type: "object" }, minItems: 1, maxItems: 12, description: "Style objects (e.g. {fontSize: \"$size.l\"})." },
      },
      ["path", "target", "variants"],
    ),
  },
  {
    name: "render_layout",
    description: "Write the document as a standalone HTML file (open it in a browser and print to PDF). Default: next to the document, .html instead of .docforge.json.",
    inputSchema: obj({ path: PATH, out: { type: "string" }, surface: { type: "string" }, grid: { type: "boolean" } }, ["path"]),
  },
  {
    name: "upgrade_layout_document",
    description: "Convert an older document (version 1: sections and bands; version 2) to the current format in place.",
    inputSchema: obj({ path: PATH }, ["path"]),
  },
];

export interface McpOptions {
  engine: Engine;
  /** Folder every path is resolved in. */
  root: string;
}

/** Handle one JSON-RPC message; resolves to the response, or null for a notification. */
export function createMcpHandler(options: McpOptions): (message: unknown) => Promise<Response | null> {
  const { engine } = options;
  const root = resolve(options.root);

  const inRoot = (path: unknown, suffix = ".docforge.json"): string => {
    if (typeof path !== "string" || !path) throw new ToolError("`path` is required.");
    const full = resolve(root, path);
    if (full !== root && !full.startsWith(root + sep)) throw new ToolError(`"${path}" is outside the server root (${root}).`);
    if (!full.endsWith(suffix)) throw new ToolError(`"${path}" must end with ${suffix}.`);
    return full;
  };
  const read = (path: unknown): unknown => {
    const full = inRoot(path);
    if (!existsSync(full)) throw new ToolError(`"${String(path)}" does not exist. Create it with create_layout_document.`);
    try {
      return JSON.parse(readFileSync(full, "utf8"));
    } catch (error) {
      throw new ToolError(`"${String(path)}" is not valid JSON: ${(error as Error).message}`);
    }
  };
  const historyDir = (full: string) => join(dirname(full), ".docforge-history", basename(full, ".docforge.json"));
  // History names are timestamps; two writes in the same millisecond must not share one.
  let lastStamp = 0;
  /** Save `doc`, keeping the previous file in the history; `tag` marks that copy (an undo keeps the version it replaced as `.undone`). */
  const write = (full: string, doc: unknown, tag?: string) => {
    if (existsSync(full)) {
      const history = historyDir(full);
      mkdirSync(history, { recursive: true });
      lastStamp = Math.max(Date.now(), lastStamp + 1);
      copyFileSync(full, join(history, `${new Date(lastStamp).toISOString().replace(/[:.]/g, "-")}${tag ? `.${tag}` : ""}.json`));
      const old = readdirSync(history).sort();
      for (const name of old.slice(0, Math.max(0, old.length - HISTORY_KEEP))) rmSync(join(history, name));
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, `${JSON.stringify(doc, null, 2)}\n`);
  };
  const diagnosticsText = (list: { severity: string; code: string; message: string; component?: string; suggestions?: string[] }[]) =>
    list.length
      ? list.map((d) => `- [${d.severity}] ${d.code}${d.component ? ` (${d.component})` : ""}: ${d.message}${(d.suggestions ?? []).map((s) => `\n    try: ${s}`).join("")}`).join("\n")
      : "No problems.";
  const pagesOf = (value: unknown) => (Array.isArray(value) ? (value as number[]) : undefined);
  /** The summary by default; the level-1 map only when asked for (`pages` for some pages, `full` for all). */
  const writeReport = (head: string, result: ReturnType<Engine["apply"]>, args: Json) => {
    if (!result.ok) return [head, `Diagnostics:\n${diagnosticsText(result.diagnostics)}`].join("\n\n");
    const mode = args.map === "full" || args.map === "pages" ? args.map : "summary";
    const parts = [head, result.summary];
    if (mode !== "summary") parts.push(`Map (level 1):\n${result.map}`);
    else parts.push('(full map: get_layout_map, or map: "pages" with pages: [n])');
    return parts.join("\n\n");
  };

  const tools: Record<string, (args: Json) => string> = {
    get_layout_guide() {
      return AGENT_GUIDE;
    },
    create_layout_document(args) {
      const full = inRoot(args.path);
      if (existsSync(full)) throw new ToolError(`"${String(args.path)}" already exists.`);
      const doc = args.content ?? emptyDocument(typeof args.title === "string" ? args.title : undefined);
      const check = engine.validate(doc);
      const blocking = check.filter((d) => d.code === "schema" || d.code === "duplicate-id");
      if (blocking.length) throw new ToolError(`Not created:\n${diagnosticsText(blocking)}`);
      write(full, doc);
      return `Created ${String(args.path)}.\n\n${engine.map(doc, { level: 1 }).text}`;
    },
    get_layout_map(args) {
      const level = (args.level ?? 1) as 0 | 1 | 2;
      return engine.map(read(args.path), {
        level,
        pages: pagesOf(args.pages),
        components: Array.isArray(args.components) ? (args.components as string[]) : undefined,
        draw: args.draw !== false,
      }).text;
    },
    get_layout_document(args) {
      return JSON.stringify(read(args.path), null, 2);
    },
    apply_layout_ops(args) {
      const full = inRoot(args.path);
      if (!Array.isArray(args.ops) || !args.ops.length) throw new ToolError("`ops` must be a non-empty array.");
      const result = engine.apply(read(args.path), args.ops, { map: { pages: pagesOf(args.pages) } });
      if (result.ok && result.doc) write(full, result.doc);
      return writeReport(result.ok ? `Saved ${String(args.path)}.` : "NOT saved: the file is unchanged. Fix the errors and send the ops again.", result, args);
    },
    undo_layout_change(args) {
      const full = inRoot(args.path);
      const current = read(args.path);
      const steps = typeof args.steps === "number" && Number.isInteger(args.steps) && args.steps >= 1 ? args.steps : 1;
      const dir = historyDir(full);
      // Versions saved by writes, oldest first; copies an undo set aside (.undone) are not steps back.
      const saved = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json") && !n.endsWith(".undone.json")).sort() : [];
      const load = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));
      const same = JSON.stringify(current);
      // Where the file stands now: on a saved version (after an undo) or past the newest one.
      let position = saved.length;
      for (let i = saved.length - 1; i >= 0; i--) {
        if (JSON.stringify(load(saved[i] as string)) === same) {
          position = i;
          break;
        }
      }
      const index = position - steps;
      if (index < 0) {
        throw new ToolError(
          position === 0 ? "Nothing to undo: this is the oldest version kept in .docforge-history/." : `Only ${position} earlier version${position === 1 ? "" : "s"} kept; ask for fewer steps.`,
        );
      }
      const name = saved[index] as string;
      const target = load(name);
      write(full, target, "undone");
      const ids = (doc: unknown) => new Set(((doc as { components?: { id: string }[] }).components ?? []).map((c) => c.id));
      const before = ids(current);
      const after = ids(target);
      const back = [...after].filter((id) => !before.has(id));
      const gone = [...before].filter((id) => !after.has(id));
      const when = name.slice(11, 19).replace(/-/g, ":");
      return [
        `Undid ${steps} change${steps === 1 ? "" : "s"}: ${String(args.path)} is back to the version saved at ${when} UTC.`,
        ...(back.length ? [`Back: ${back.join(", ")}.`] : []),
        ...(gone.length ? [`Gone: ${gone.join(", ")}.`] : []),
        engine.map(target, { level: 0 }).text,
        "Undo again to go one more step back.",
      ].join("\n");
    },
    preview_layout(args) {
      const doc = args.content ?? read(args.path);
      if (Array.isArray(args.ops) && args.ops.length) {
        const result = engine.apply(doc, args.ops, { map: { pages: pagesOf(args.pages) } });
        return writeReport(result.ok ? "Preview (nothing saved)." : "Preview: these ops would be REFUSED.", result, args);
      }
      return [`Preview (nothing saved).`, `Diagnostics:\n${diagnosticsText(engine.validate(doc).filter((d) => d.severity !== "info"))}`, engine.map(doc, { level: 1, pages: pagesOf(args.pages) }).text].join(
        "\n\n",
      );
    },
    measure_component(args) {
      const list = Array.isArray(args.components) ? args.components : args.component !== undefined ? [args.component] : [];
      if (!list.length) throw new ToolError("Give `component`, or `components` to measure several in one call.");
      const measureOptions = {
        ...(args.path ? { doc: read(args.path) } : {}),
        ...(Array.isArray(args.widths) ? { widths: args.widths as number[] } : {}),
        ...(Array.isArray(args.cols) ? { cols: args.cols as [number, number][] } : {}),
      };
      return list.map((component) => engine.measure(component, measureOptions).text).join("\n\n");
    },
    review_layout(args) {
      return engine.review(read(args.path)).text;
    },
    find_layout(args) {
      const { path: _path, ...query } = args;
      return engine.find(read(args.path), query as FindQuery).text;
    },
    calibrate_style(args) {
      const target = (args.target ?? {}) as Json;
      const keys = ["component", "label", "selector"].filter((k) => typeof target[k] === "string" && target[k]);
      if (keys.length !== 1) throw new ToolError("`target` must have exactly one of component, label or selector.");
      if (!Array.isArray(args.variants) || !args.variants.length) throw new ToolError("`variants` must be a non-empty array of style objects.");
      const key = keys[0] as string;
      return engine.calibrate(read(args.path), { [key]: target[key] } as CalibrateTarget, args.variants).text;
    },
    render_layout(args) {
      const full = inRoot(args.path);
      const out = args.out ? inRoot(args.out, ".html") : full.replace(/\.docforge\.json$/, ".html");
      const result = engine.render(read(args.path), { surfaceId: typeof args.surface === "string" ? args.surface : undefined, grid: args.grid === true });
      writeFileSync(out, result.page);
      return `Wrote ${out} (${result.rendered.pages} page${result.rendered.pages === 1 ? "" : "s"}). Open it in a browser and print to PDF.`;
    },
    upgrade_layout_document(args) {
      const full = inRoot(args.path);
      const result = upgradeDocument(read(args.path), engine);
      if (!result.ok || !result.doc) throw new ToolError(`Could not upgrade: ${result.notes.join("; ")}`);
      write(full, result.doc);
      return [`Upgraded ${String(args.path)} to the current format.`, ...result.notes.map((n) => `· ${n}`)].join("\n");
    },
  };

  return async (message) => {
    const req = message as Request;
    if (!req || typeof req !== "object" || typeof req.method !== "string") {
      return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } };
    }
    if (req.id === undefined || req.id === null) return null; // notification
    const reply = (result: unknown): Response => ({ jsonrpc: "2.0", id: req.id as number | string, result });
    const fail = (code: number, msg: string): Response => ({ jsonrpc: "2.0", id: req.id as number | string, error: { code, message: msg } });
    const params = req.params ?? {};

    switch (req.method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "docforge-layout", version: LIB_VERSION },
          instructions: `Layout documents as local .docforge.json files under ${root}: components placed on a unit grid, measured without a browser. Read the guide (get_layout_guide, or ${GUIDE_URI}) before the first one. Build a page with one apply_layout_ops holding every component and read the summary it returns; it reports sizes and problems, so measure or preview only to choose between options. To change an existing document, send only what changes (edit, then fit to stay within N pages; move to reorder sections), never rebuild the layout.`,
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS });
      case "tools/call": {
        const name = params.name;
        const tool = typeof name === "string" ? tools[name] : undefined;
        if (!tool) return fail(-32602, `Unknown tool: ${String(name)}`);
        try {
          return reply(text(tool((params.arguments ?? {}) as Json)));
        } catch (error) {
          return reply(text(error instanceof ToolError ? error.message : `Error: ${(error as Error).message}`, true));
        }
      }
      case "resources/list":
        return reply({ resources: [{ uri: GUIDE_URI, name: "Layout documents guide", mimeType: "text/markdown" }] });
      case "resources/read":
        if (params.uri !== GUIDE_URI) return fail(-32602, `Unknown resource: ${String(params.uri)}`);
        return reply({ contents: [{ uri: GUIDE_URI, mimeType: "text/markdown", text: AGENT_GUIDE }] });
      case "prompts/list":
        return reply({ prompts: [] });
      default:
        return fail(-32601, `Method not found: ${req.method}`);
    }
  };
}

/** Serve on stdin/stdout until stdin closes. Logs go to stderr (stdout is the protocol). */
export function runStdio(options: McpOptions): void {
  const handle = createMcpHandler(options);
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } })}\n`);
      return;
    }
    void handle(message).then((response) => {
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    });
  });
  process.stderr.write(`docforge-layout MCP server on stdio (root ${resolve(options.root)})\n`);
}
