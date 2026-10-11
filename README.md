# @docforge/layout

The DocForge document format: components placed on a grid, **measured without a browser**, rendered to HTML whose pages print to PDF exactly as they look on screen.

An agent never has to look at the page. It reads a text map of the document, asks to put a component somewhere, and gets back a diagnostic: it fits, or "needs 412px; the area is 320px — 92px short", with suggestions.

## How it works

- **The document is JSON.** Sections → bands (rows of the grid, with an id and a height in grid row units, or `auto`) → components placed by column (`colStart`, `colSpan` on a 12-column grid). A component's area is `colSpan × band height`.
- **The library measures text itself.** It reads the same font files the browser renders with (fontkit), decides every line break, and draws each line ready-made (`white-space: pre`). The browser never re-wraps, so a height computed here is the height on screen and in print.
- **The library paginates.** Pages are fixed-size boxes and every component is absolutely positioned; printing to PDF only reproduces them. A band that does not fit moves to the next page; a band holding a single text, list, table, code, steps or timeline component splits between lines/rows (tables repeat their header).
- **Styles cascade with origins.** Tokens (`$color.primary`, `$size.m`…) → presets → `document` → grid **regions** → **labels** → the component. Every resolved value knows where it came from, so an agent can change it at the right level.

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

## Use

```ts
import { createEngine } from "@docforge/layout";
import { createNodeRegistry } from "@docforge/layout/node";

const engine = createEngine({ registry: createNodeRegistry() });

engine.map(doc, { level: 1 }).text;          // grid map for an agent
engine.render(doc, { grid: true });           // same render with the grid drawn over it (never printed)
engine.validate(doc);                         // diagnostics
const { page } = engine.render(doc, { surfaceId: "a4" }); // standalone HTML, print-ready

const result = engine.apply(doc, [
  { op: "place", component: "texto-intro", at: { section: "s2", band: "r-vendas", colStart: 1, colSpan: 7 } },
]);
result.ok;          // false if anything it touched does not fit
result.diagnostics; // what is wrong and how to fix it
result.map;         // level-1 map of the result
```

In the browser, load the bundled fonts with `fetchBundledFonts(urlOfFontsFolder)` and register them in a `FontRegistry`; the rendered CSS includes the matching `@font-face` rules.

Map levels: **0** outline (sections and components), **1** the grid (bands, columns, alerts per page), **2** one component in full (area, need, content, every style property with its origin, diagnostics).

Operations: `add`, `place`, `update`, `remove`, `addSection`, `addBand`, `setBand`, `moveBand`, `removeBand`, `setStyle` (document selector or label), `setRegion`, `removeRegion`, `setTokens`.

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

The code is organized by stage: `src/layout/` runs schema → `structure` → `measure` → `bands` → `paginate` → `links`, and `layout/engine.ts` only chains them.

### Measured so far (Chrome, Windows)

| Check | Result |
| --- | --- |
| Conformance, 1,000 generated cases, tolerance 1px | 999 cases (99.9%), 8,756 of 8,757 lines, worst line 1.11px |
| Lines of the three examples, every surface | none overflowing its box; worst line 1.18px |
| Layout of a ~44-page document (Node) | ~330ms cold, ~70ms warm |
| Single string, library vs browser | 253.055px vs 253.063px |

## Fonts

Inter and JetBrains Mono ship in `fonts/` under the SIL Open Font License (see the license files there). Only registered fonts are used — never system fonts — because a substituted font would break measurement.

## License

MIT
