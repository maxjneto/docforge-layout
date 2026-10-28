#!/usr/bin/env node
/**
 * docforge-layout <command> — the engine from a terminal, for agents that run code
 * and for scripts. Every command reads JSON files and prints text (or JSON with --json).
 *
 *   serve   [--port 8002] [--host 127.0.0.1] [--max-body-bytes 2000000]   (page images when @resvg/resvg-js is installed)
 *   map     <doc.json> [--level 0|1|2] [--pages 1,2] [--components a,b] [--no-draw]
 *   apply   <doc.json> <ops.json> [--write out.json]        nothing is saved without --write
 *   measure <component.json> [--doc doc.json] [--widths 40,60] [--cols 1-6,1-12]
 *   find    <doc.json> [--text …] [--type …] [--label …] [--page N] [--rect page,x,y,w,h] [--state …]
 *   render  <doc.json> --out page.html [--grid]
 *   upgrade <v1.json> [--write out.json]
 *   mcp     [--root <folder>]                              MCP server on stdio, for *.docforge.json files
 *
 * Every command also takes --surface <id>. PORT, HOST and MAX_BODY_BYTES environment
 * variables are used by `serve` when the flags are absent.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createEngine } from "./engine";
import { bundledFontFiles, createNodeRegistry } from "./node";
import type { FindQuery, FindState } from "./query/find";
import type { ComponentType } from "./schema/components";
import { runStdio } from "./mcp/server";
import { createLayoutServer } from "./server";
import { upgradeDocument } from "./upgrade";

const USAGE = "usage: docforge-layout serve|mcp|map|apply|measure|find|render|upgrade [args] (see the README)";

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readJson(path: string | undefined, what: string): unknown {
  if (!path || path.startsWith("--")) fail(`missing ${what} file\n${USAGE}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read ${what} from ${path}: ${(error as Error).message}`);
  }
}

const ints = (value: string | undefined) => value?.split(",").map((n) => Number(n.trim())).filter((n) => Number.isInteger(n) && n > 0);

/** resvg when `@resvg/resvg-js` is installed next to the lib (optional): page images without a browser. */
async function loadRasterizer(): Promise<((svg: string, scale: number) => Uint8Array) | undefined> {
  const name = "@resvg/resvg-js";
  const mod = (await import(name).catch(() => null)) as { Resvg?: new (svg: string, options: unknown) => { render(): { asPng(): Uint8Array } } } | null;
  if (!mod?.Resvg) return undefined;
  const Resvg = mod.Resvg;
  const fontFiles = bundledFontFiles();
  return (svg, scale) => new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Inter" }, fitTo: { mode: "zoom", value: scale } }).render().asPng();
}

async function serve(args: string[]): Promise<void> {
  const port = Number(flag(args, "port") ?? process.env.PORT ?? 8002);
  const host = flag(args, "host") ?? process.env.HOST ?? "127.0.0.1";
  const maxBodyBytes = Number(flag(args, "max-body-bytes") ?? process.env.MAX_BODY_BYTES ?? 2_000_000);
  if (!Number.isInteger(port) || port < 0 || !Number.isFinite(maxBodyBytes)) fail(USAGE);
  const rasterize = await loadRasterizer();
  const server = createLayoutServer({ maxBodyBytes, rasterize });
  if (!rasterize) console.log("docforge-layout: @resvg/resvg-js is not installed; /render-image answers with SVG only");
  server.listen(port, host, () => console.log(`docforge-layout listening on http://${host}:${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

function main(argv: string[]): void {
  const [command, ...args] = argv;
  if (command === "serve") return void serve(args);
  // Local tools write HTML that is opened on this machine: fonts load from their files.
  if (command === "mcp") return runStdio({ engine: createEngine({ registry: createNodeRegistry({ fileUrls: true }) }), root: flag(args, "root") ?? process.cwd() });
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }

  const engine = createEngine({ registry: createNodeRegistry({ fileUrls: true }) });
  const surfaceId = flag(args, "surface");
  const json = args.includes("--json");
  const print = (value: unknown, text: string) => console.log(json ? JSON.stringify(value, null, 2) : text);

  switch (command) {
    case "map": {
      const doc = readJson(args[0], "document");
      const level = Number(flag(args, "level") ?? 1);
      if (level !== 0 && level !== 1 && level !== 2) fail("--level must be 0, 1 or 2");
      const components = flag(args, "components")?.split(",");
      const map = engine.map(doc, { level, surfaceId, pages: ints(flag(args, "pages")), components, draw: !args.includes("--no-draw") });
      return print(map, map.text);
    }
    case "apply": {
      const doc = readJson(args[0], "document");
      const ops = readJson(args[1], "ops");
      if (!Array.isArray(ops)) fail("the ops file must hold a JSON array of operations");
      const result = engine.apply(doc, ops, { surfaceId });
      const out = flag(args, "write");
      if (out && result.ok && result.doc) writeFileSync(out, `${JSON.stringify(result.doc, null, 2)}\n`);
      const lines = [
        result.ok ? (out ? `ok — written to ${out}` : "ok — nothing written (pass --write FILE)") : "refused — nothing written",
        ...result.diagnostics.map((d) => `${d.severity === "error" ? "!" : d.severity === "warning" ? "~" : "·"} ${d.code}: ${d.message}`),
        ...result.changes.map((c) => `${c.severity === "warning" ? "~" : "·"} ${c.code}: ${c.message}`),
        "",
        result.map,
      ];
      print(result, lines.join("\n"));
      if (!result.ok) process.exit(2);
      return;
    }
    case "measure": {
      const component = readJson(args[0], "component");
      const docPath = flag(args, "doc");
      const cols = flag(args, "cols")
        ?.split(",")
        .map((pair) => pair.split("-").map(Number) as [number, number]);
      const result = engine.measure(component, {
        surfaceId,
        ...(docPath ? { doc: readJson(docPath, "document") } : {}),
        ...(flag(args, "widths") ? { widths: ints(flag(args, "widths")) } : {}),
        ...(cols ? { cols } : {}),
      });
      print(result, result.text);
      if (!result.ok) process.exit(2);
      return;
    }
    case "find": {
      const doc = readJson(args[0], "document");
      const rect = ints(flag(args, "rect"));
      const query: FindQuery = {
        ...(flag(args, "text") ? { text: flag(args, "text") } : {}),
        ...(flag(args, "type") ? { type: flag(args, "type")?.split(",") as ComponentType[] } : {}),
        ...(flag(args, "label") ? { label: flag(args, "label") } : {}),
        ...(flag(args, "page") ? { page: Number(flag(args, "page")) } : {}),
        ...(flag(args, "state") ? { state: flag(args, "state") as FindState } : {}),
        ...(rect && rect.length === 5 ? { rect: { page: rect[0], x: rect[1] as number, y: rect[2] as number, w: rect[3] as number, h: rect[4] as number } } : {}),
      };
      const result = engine.find(doc, query, { surfaceId });
      return print(result, result.text);
    }
    case "render": {
      const doc = readJson(args[0], "document");
      const out = flag(args, "out") ?? fail("render needs --out <file.html>");
      const result = engine.render(doc, { surfaceId, grid: args.includes("--grid") });
      writeFileSync(out, result.page);
      return print({ pages: result.rendered.pages, out }, `${result.rendered.pages} page(s) written to ${out}`);
    }
    case "upgrade": {
      const doc = readJson(args[0], "document");
      const result = upgradeDocument(doc, engine);
      const out = flag(args, "write");
      if (out && result.ok && result.doc) writeFileSync(out, `${JSON.stringify(result.doc, null, 2)}\n`);
      print(result, [result.ok ? "ok" : "failed", ...result.notes.map((n) => `· ${n}`), ...(out ? [] : ["", JSON.stringify(result.doc, null, 2)])].join("\n"));
      if (!result.ok) process.exit(2);
      return;
    }
    default:
      fail(USAGE);
  }
}

main(process.argv.slice(2));
