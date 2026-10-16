# @docforge-lib/layout

The DocForge document format: components placed on a grid, **measured without a browser**, rendered to HTML whose pages print to PDF exactly as they look on screen.

An agent never has to look at the page. It reads a text map of the document, asks to put a component somewhere, and gets back a diagnostic: it fits, or "needs 412px; the area is 320px — 92px short", with suggestions.

## How it works

- **The document is JSON** (`version: 3`). Every component has a position `at: { page, x, y, w, h? }` in **grid units**: square cells of `grid.unit` px (8 by default), counted from the top-left corner of the page's content area. The page size only decides how many units fit (A4 with 40px margins: 89 × 130). `grid.columns` and `grid.gutter` draw **guides** — the editor snaps to them and ops may place by `cols: [1, 7]` — but never limit where a component goes.
- **Content decides the height.** `h` is a minimum: a component whose content needs more grows. Whatever a growing (or overlapping) box **invades** moves down below it, `grid.gap` units apart, in a chain; nothing else moves. Pushes are computed, never stored, so a box returns to its place when what pushed it shrinks.
- **The library paginates.** A box that crosses the bottom of a page splits between lines/rows when it can (text, list, table, code, steps, timeline — tables repeat their header) or moves whole to the next page; either way it pushes what it meets there. `maxPages` on a surface is reported when exceeded, never refused.
- **The library measures text itself.** It reads the same font files the browser renders with (fontkit), decides every line break, and draws each line ready-made (`white-space: pre`). The browser never re-wraps, so a height computed here is the height on screen and in print.
- **Styles cascade with origins.** Tokens (`$color.primary`, `$size.m`…) → presets → `document` → **regions** (rectangles of the grid) → **classes** (`labels`) → the component. Every resolved value knows where it came from, so an agent can change it at the right level.
- **Version 1 documents** (sections → bands) convert with `upgradeDocument(doc, engine)` or `docforge-layout upgrade`.

## Components

| Type | Size decided by | Notes |
| --- | --- | --- |
| `text` | content | Paragraphs with a role (`title-1..3`, `subtitle`, `body`, `quote`, `caption`) and inline `**bold**`, `*italic*`, `` `code` ``, `[link](url)` or explicit runs (color, highlight, size from the scale) |
| `list` | content | Bullet, number or check; nested items |
| `table` | content | Weighted column widths, alignment, zebra, header repeated across pages |
| `code` | content | Keeps indentation; wide lines wrap and are reported |
| `steps` | content | Numbered steps with title and text |
| `timeline` | content | Dated events with title and text |
| `card` | content | Eyebrow, title, optional large value, text and footer, boxed by default; never splits |
| `kpi` | area | Card look by default; value shrinks to fit (down to 18px), centered in its area |
| `chart` | area | Bar, line or pie in SVG; reports a plot too small or labels that do not fit |
| `image` | area | `contain` or `cover`; natural height keeps the aspect ratio |
| `divider` | area | Line or space |

## Links

- Inline, anywhere text goes: `[text](https://…)`, `[text](mailto:…)`, or `[text](#id)` to jump to a component or section.
- `props.href` on a `card` or `kpi` makes the whole box clickable.
- Every component and section gets an anchor, so internal links work on screen and inside the printed PDF; a `#id` that points to nothing is reported (`unknown-link-target`).

## Safety

Documents come from agents and other people, so the library treats them as untrusted:

- **All HTML goes through one builder** (`src/render/h.ts`): text and attribute values are escaped, CSS values sanitized, event-handler attributes refused. A lint rule rejects HTML built by hand anywhere else.
- **Links** are limited to `https:`, `http:`, `mailto:` and `#id`; images to `http(s):`, relative paths and `data:image/…`. The schema rejects anything else; a markdown link with another scheme renders as plain text and is reported (`unsafe-link`).
- **Colors and font names** must be colors and names (hex, `rgb()`/`hsl()`, named colors; letters/digits/spaces/`-`/`_`), so a style value can never close an attribute or load a URL.

## Accessibility

Each component also renders a visually hidden **semantic layer** — real `h1`–`h3`, `p`, `blockquote`, `ul`/`ol`, `table`, `pre`, `time`, and a data table for every chart — while the positioned visual layer is hidden from assistive technology. Screen readers get the structure, copying text takes the visible layer, and Chrome prints a tagged PDF. Images keep their own `alt`.

Numbers the library formats (chart axes and values) follow `meta.locale` (BCP 47, default `en-US`): `"pt-BR"` gives `0,5M`.

## Install

```sh
npm install @docforge-lib/layout
```

Node 20+ or any modern browser. Pin the version you tested with (`~0.5.0`): before 1.0, a minor version may change the API.

## Use

```ts
import { createEngine } from "@docforge-lib/layout";
import { createNodeRegistry } from "@docforge-lib/layout/node";

const engine = createEngine({ registry: createNodeRegistry() });

engine.map(doc, { level: 1 }).text;           // settings, every page drawn in ASCII, a table per page
engine.render(doc, { grid: true });            // the render with units, guides and boxes drawn over it (never printed)
const { page } = engine.render(doc, { surfaceId: "a4" }); // standalone HTML, print-ready

// Nothing below saves anything: compute first, then decide.
engine.measure(component, { widths: [40, 60], cols: [[1, 6]], doc }); // how tall it would be at each width
engine.find(doc, { text: "receita", page: 1, rect: { page: 1, x: 0, y: 0, w: 40, h: 30 } });
engine.calibrate(doc, { component: "kpi-a" }, [{ fontSize: "$size.l" }, { fontSize: "$size.xl" }]); // variants side by side, none applied
const result = engine.apply(doc, [
  { op: "add", component: { id: "nps", type: "kpi", content: { value: "61", label: "NPS" } }, at: { below: "titulo", cols: [1, 3] } },
]);
result.ok;          // false only for a malformed op, an unknown id or an invalid document
result.changes;     // what the layout did on its own: "kpi-margem moved down 4 (pushed by nps)"
result.diagnostics; // problems, with suggestions
result.summary;     // a few lines: what the ops changed, what moved on its own, problems, free rows per page
result.map;         // level-1 map of the result
```

Map levels: **0** outline (components per page), **1** settings + each page drawn (one character per unit across; rows that repeat are left out) + a table per page (id, type, x, y, w, h, classes, content summary, what the layout did), **2** components in full (declared vs drawn position, content, every style property with its origin, diagnostics). Level 1 takes `pages` and `draw: false`.

Operations: `add`, `place`, `update`, `edit` (change parts of the content by path: `paragraphs.1`, `rows.2.0`), `replaceText` (find and replace across text content), `remove`, `setStyle` (document selector or class), `setRegion`, `removeRegion`, `setTokens`, `setGrid` (a new `unit` converts every position; guides never move anything), `setSurface`, `removeSurface`, `setMeta` (title, locale), `compact` (move components up into empty space; `acrossPages` lets one go back to the previous page) and `fit` (make the document fit `pages` with the strategies you allow — `compact`, `heights`, `spacing`, `type` down to `minScale` — compacting again after each when `compact` is allowed, or change nothing and say why). Positions in `add`/`place` are `{page, x, y, w, h?}`, or relative — `cols: [a, b]` for x/w, `below: "id"` (under where that component is drawn now) or `end: true` (under the lowest box of the page) for page/y — resolved when the op runs and stored as absolute. They usually arrive as JSON, so each one is checked against `OpSchema` first: a malformed op is an `invalid-op` diagnostic naming the field, never an exception.

### Documents from DocForge

The JSON is the document: fonts ship with the library and images are links or `data:` URLs, so a stored copy renders with no call to DocForge. Three ways in:

```ts
import { fetchPublished, createClient, readDocument } from "@docforge-lib/layout";

// 1. JSON you already have (your database, a file): rendered as it is.
const { doc } = readDocument(json); // older formats are converted up (with a warning in the log)

// 2. The published version, by its public link or token. Browser or server.
const published = await fetchPublished("https://docforge.dev/public/<token>");

// 3. By id with an API key: server only (createClient refuses to run in a browser).
const docforge = createClient({ apiKey: process.env.DOCFORGE_API_KEY! });
await docforge.get(id, { revision: 42 }); // exactly that revision, cached for good once read
await docforge.get(id);                    // the current one; the log says it was not pinned
```

A link only ever serves what its owner **published**: later edits stay private until they publish again, and unpublishing revokes the link (`not_found`).

**Do not make your readers depend on DocForge.** The recommended pattern is to fetch when the document is published (or when someone presses "update" in your admin), store `doc` in your own database, and render from there. If you read live instead, the default cache (in memory; pass your own `cache` with `get`/`set` for localStorage or a database) serves the last good copy when the server fails, and logs `served_from_cache`. A document that was unpublished is never served from the cache.

### Format versions

Documents carry a format `version` (now 3). It goes up whenever the schema accepts something an older library would refuse, and each release that raises it adds the conversion one step down.

- **Older document, newer library:** read as it is (2 → 3 changed only the number) or converted (`upgradeDocument` for version 1), with a `format_upgraded` warning.
- **Newer document, older library:** refused with `format_unsupported`, naming the version to update to. When you load from DocForge this does not happen: every request says which format this library reads (`?format=3`), the server converts down with `downgradeDocument` and lists what the older format cannot say (a 16:9 slide written as a 1280×720 page, a theme font older libraries do not bundle), and the library logs it as `format_downgraded`.
- `downgradeDocument(doc, 2)` is public too, if you serve documents to older libraries yourself.

Warnings go to `console.warn` with a stable `code`: `format_upgraded`, `format_downgraded`, `format_unsupported`, `revision_unpinned`, `served_from_cache`. Pass `logger: (entry) => …` to route them into your logs, or `silentLogger`.

### In the browser

Fonts are files, so the browser has to fetch them. `createBrowserRegistry(location)` fetches every bundled font and registers it; the rendered page's `@font-face` rules point at the same URLs, so what was measured is what is drawn. `location` is a folder URL that serves the files under their own names, a map from file name to URL, or a function. Bundlers rename assets, so with one use the map:

```ts
import { createBrowserRegistry, createEngine } from "@docforge-lib/layout";
import interRegular from "@docforge-lib/layout/fonts/Inter-Regular.ttf?url"; // Vite; one import per file in BUNDLED_FONTS
// …
const registry = await createBrowserRegistry({ "Inter-Regular.ttf": interRegular, /* … */ });
const engine = createEngine({ registry });
```

Show the page in an iframe (`srcdoc`). It runs no script, so `sandbox="allow-same-origin allow-modals"` is enough to load the fonts and call `print()`.

### Over HTTP (any language)

```sh
npx docforge-layout serve --port 8002 --host 127.0.0.1
```

`GET /health`, and `POST` with a JSON body: `/validate {doc}`, `/apply {doc, ops, pages?, draw?}`, `/map {doc, level, components?, pages?, draw?}`, `/render {doc, grid?}`, `/measure {component, doc?, widths?, cols?}`, `/find {doc, query}`, `/calibrate {doc, target, variants}`, `/diff {before, after, touched?}`, `/locate {doc, anchors}`, `/upgrade {doc}`, `/downgrade {doc, target}` (every route takes an optional `surface`). It keeps no state and has no auth: run it on a private network next to the service that owns the documents. In Node, `createLayoutServer()` / `createLayoutHandler()` from `@docforge-lib/layout/server` give you the same thing in your own process.

### As an MCP server (local files)

```sh
npx docforge-layout mcp --root .
claude mcp add docforge-layout -- npx docforge-layout mcp --root /path/to/docs
```

Agents get the same loop as in DocForge, on `*.docforge.json` files under the root: `create_layout_document`, `get_layout_map`, `find_layout`, `measure_component`, `preview_layout`, `apply_layout_ops`, `calibrate_style`, `render_layout` (HTML to print as PDF), `get_layout_document`, `upgrade_layout_document`, and the guide as the resource `docforge-layout://guide`. Paths outside the root are refused; before a file is overwritten, the previous version goes to `.docforge-history/` (the last 20). In Node, `createMcpHandler()` from `@docforge-lib/layout/mcp` answers one JSON-RPC message at a time.

### From a terminal

```sh
npx docforge-layout map doc.json --pages 1 --level 1
npx docforge-layout measure component.json --doc doc.json --widths 40,60 --cols 1-6
npx docforge-layout apply doc.json ops.json            # preview; add --write out.json to save
npx docforge-layout find doc.json --text receita --page 1
npx docforge-layout render doc.json --out page.html --grid
npx docforge-layout upgrade v1.json --write v2.json
```

## Develop

```sh
npm install
npm test            # vitest, node
npm run lint        # eslint (incl. the no-hand-built-HTML rule)
npm run typecheck   # library + playground
npm run build       # ESM + .d.ts in dist/
npm run check       # all of the above, as CI runs it
npm run playground  # http://localhost:5310
```

The playground has three examples (`examples/`), a JSON editor, the render with a print button, diagnostics and the map. Its **Conformance** tab renders generated texts (weights, italics, code, sizes, widths, both fonts) and compares the width the library computed for every line with the width the browser draws.

Unattended checks (for scripts): `?auto=conformance&count=1000`, `?auto=examples` and `?print=<example>&surface=<id>[&grid=1]` (the bare document, for `--print-to-pdf` or a screenshot).

The code is organized by stage: `src/layout/` runs schema → `structure` → `measure` → `place` (collisions and pages) → `links`, and `layout/engine.ts` only chains them. `src/map/` writes the text maps, `src/query/` holds `find` and `measure`, `layout/changes.ts` diffs two layouts.

### Measured so far (Chrome, Windows)

| Check | Result |
| --- | --- |
| Conformance, 1,000 generated cases, tolerance 1px | 999 cases (99.9%), 8,756 of 8,757 lines, worst line 1.11px |
| Lines of the three examples, every surface | none overflowing its box; worst line 1.18px |
| Layout of a ~42-page document, every box declared at the top so all 201 are pushed into place (Node) | ~280ms cold, ~65ms warm; level-1 map ~2,300 characters per page |
| Single string, library vs browser | 253.055px vs 253.063px |

## Fonts

Inter and JetBrains Mono ship in `fonts/` under the SIL Open Font License (see the license files there). Only registered fonts are used — never system fonts — because a substituted font would break measurement.

## License

MIT
