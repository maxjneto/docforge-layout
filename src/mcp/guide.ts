/** The guide the stdio MCP server serves as a resource (docforge-layout://guide). */
export const AGENT_GUIDE = `# DocForge layout documents (local files)

A layout document is a JSON file (\`*.docforge.json\`) of **components placed on a grid of square units**.
You never see the page. You read a **text map** (each page drawn in ASCII, plus a table), and every
write tells you what the layout did on its own: each component's size, what moved, what overflowed.

Tools: \`create_layout_document\`, \`apply_layout_ops\`, \`get_layout_map\`, \`review_layout\`, \`find_layout\`,
\`measure_component\`, \`preview_layout\`, \`calibrate_style\`, \`render_layout\` (HTML to print as PDF),
\`undo_layout_change\`, \`get_layout_document\`, \`upgrade_layout_document\`, \`get_layout_guide\` (this text).
Paths are relative to the server's root folder.

## Work in few calls

Every tool call is a round trip, and each one costs you the whole conversation again. Build the
way you would write a file: all at once, then fix.

1. \`create_layout_document\` (empty).
2. **One** \`apply_layout_ops\` with every component: \`add\` each one with
   \`at: {below: "previous-id", cols: [1, 12]}\` (or \`page\` + \`y: 0\` for the first on a page), and \`row\`
   for things side by side. Contents are in "Components" below. For slides, the first op is
   \`{"op": "setSurface", "surface": {"id": "a4", "kind": "page", "size": "Slide", "margin": 48}}\`; each
   component's \`at.page\` is its slide, and a slide exists as soon as something is on it.
3. Read the summary it returns: sizes, what moved, problems, free rows per page. Fix it with one more
   \`apply_layout_ops\` (\`edit\`, \`place\`, \`fit\`, \`compact\`), then \`review_layout\` once.

Do not measure or preview components one by one before writing: the write already reports every
size. Use \`measure_component\` only to choose between widths, with every candidate in one call
(\`components: [...]\`), and \`preview_layout\` only for a risky change to a finished page.

## Changing a finished document

Positions stay as they are written, so a change to an existing document is a few ops in one call,
never a new layout. Do not \`place\` or re-\`add\` components that are already fine.

- **Make it fit N pages:** shorten the text with \`edit\` (and \`remove\` what can go), then end the
  same call with \`{"op": "fit", "pages": N}\`. Shortening leaves empty rows under the box; \`fit\`
  moves what is below up into them and trims boxes taller than their content. If it still does not fit,
  the note says what to try next: shorten more first; name \`spacing\` or \`type\` in \`strategies\` only if
  a denser page is acceptable.
- **Reorder sections:** \`{"op": "move", "component": "steps-title", "through": "steps", "before": "what-title"}\`
  moves that block (every component from the first one's top to the last one's, rows included) and
  everything else follows: what was below it moves up, the target and what is below it move down.
  Use \`after\` instead of \`before\` to put it after a component (after its whole row).
- **Add something in the middle:** \`add\` it \`below\` the component it follows; what it runs into
  is pushed down. Use \`fit\` afterwards if the page must not grow.

Any write you regret comes back with \`undo_layout_change\` — never delete the file to start over.

## Positions

Every component has \`at: {page, x, y, w, h?}\`: \`page\` from 1; \`x\`, \`y\`, \`w\`, \`h\` in **units**
(8px by default) from the top-left corner of the page's content area. An A4 page with 40px margins
is 89 units wide and 130 tall; the map's first lines give the exact numbers.

- \`h\` is a minimum. Text, lists, tables, code, steps, timelines and cards grow with their content;
  KPIs, charts, images and dividers fill \`h\` (natural size without it).
- Guide columns (12, gutter 16px) only help alignment: place by \`cols: [first, last]\` instead of x/w.
- Something that grows pushes down only what it runs into, in a chain; the file keeps the position
  you chose, so a pushed box returns when the pusher shrinks. A box crossing the bottom of a page
  splits (text, list, table, code, steps, timeline) or moves to the next page.
- Nothing about layout refuses a write: side effects come back as \`changes\`.

## Operations (\`apply_layout_ops\`, \`preview_layout\`)

\`\`\`json
{"op": "add", "component": {"id": "k1", "type": "kpi", "content": {"value": "42", "label": "NPS"}}, "at": {"below": "title", "cols": [1, 4], "h": 14}}
{"op": "place", "component": "k1", "at": {"x": 45, "w": 44}}
{"op": "update", "component": "k1", "content": {...}, "props": {...} | null, "labels": [...], "style": {...} | null}
{"op": "edit", "component": "body", "set": {"paragraphs.1": "New text", "rows.2.0": "Sul"}, "remove": ["items.3"]}
{"op": "replaceText", "find": "T2", "replace": "Q2", "components": ["body"], "matchCase": false}
{"op": "row", "below": "title", "h": 14, "items": [{"id": "k1", "type": "kpi", "content": {...}}, {"id": "k2", ...}, "existing-id"]}
{"op": "row", "below": "k1", "widths": [2, 1], "align": "top", "items": ["text-a", "chart-a"]}
{"op": "move", "component": "steps-title", "through": "steps", "after": "intro"}
{"op": "remove", "component": "k1"}
{"op": "setStyle", "layer": "document", "selector": "text.title-1", "style": {...}}
{"op": "setStyle", "layer": "label", "label": "highlight", "style": {...}}
{"op": "setTokens", "tokens": {"color": {"primary": "#0b6e4f"}}}
{"op": "setGrid", "grid": {"unit": 8, "columns": 12, "gutter": 16, "gap": 2}}
{"op": "setSurface", "surface": {"id": "a4", "kind": "page", "size": "A4", "margin": 40, "maxPages": 2}}
{"op": "setMeta", "meta": {"title": "Q3", "locale": "pt-BR", "theme": "Executivo"}}
{"op": "page", "action": "insert" | "duplicate" | "remove" | "move", "page": 2, "to": 4}
{"op": "compact", "acrossPages": true}
{"op": "fit", "pages": 2}
{"op": "fit", "pages": 2, "strategies": ["compact", "heights", "spacing", "type"], "minScale": 0.9}
\`\`\`

- \`update\` replaces \`content\` whole; \`edit\` changes parts of it by path (\`paragraphs.1\`, \`rows.2.0\`,
  \`items.0.text\`; one past the end appends), so you never resend a whole table to fix a cell.
  \`replaceText\` changes words everywhere (or in \`components\`); finding nothing is an error.
- Writes and previews answer with a **summary**: what you changed (before → after), what moved on
  its own, problems, free rows per page. Ask \`map: "pages"\` (with \`pages\`) or \`map: "full"\` for the
  drawing, or call \`get_layout_map\`.
- \`row\` puts components side by side across guide columns in one op: objects are added, ids are
  moved; \`widths\` are proportions (\`[2, 1]\` = two thirds and one third) rounded to whole columns;
  \`cols\` limits the row; \`h\` gives all the same minimum height, \`align: "stretch"\` makes them as
  tall as the tallest. The summary shows where each one landed.
- When a page is done, \`review_layout\` points out what a reader would notice (empty boxes, ragged
  rows, edges just off a guide, a near-empty last page), each with the ops that fix it.
- Positions: absolute, or \`below: "id"\` / \`end: true\` for y and \`cols\` for x/w; in \`place\`, what you
  leave out stays.
- Slides: a page surface with \`"size": "Slide"\` (1280 × 720 px, 16:9) is a deck, one slide per page.
  Put every component on its slide (\`at.page\`) and keep each slide self-contained. \`page\` inserts,
  duplicates, removes or reorders whole slides (\`insert\` with page 0 adds one before the first).
- \`move\` takes a block (\`component\`, or \`component\` \`through\` another: every component whose top is
  between theirs on one page) to just \`before\` or \`after\` a component, on any page; what was below the
  block closes the gap and what is below the target makes room. Columns beside the block stay put.
- \`compact\` moves components up into empty space (optionally only some, one page, or across pages).
- \`fit\` makes the document fit a page count, mildest first. Without \`strategies\` it only compacts and
  lowers minimum heights to what content needs, so the page keeps its look. \`spacing\` (down to 75%,
  boxes never touching) and \`type\` (down to \`minScale\`, default 0.9) run only when you name them.
  It changes nothing (and says so, with what to try next) when it cannot.

## Components

Every component is \`{id, type, content, props?, style?, labels?}\`; ids use letters, digits, - and _.
Text anywhere accepts inline **bold**, *italic*, \`code\` and [link](https://… or #id).

\`\`\`json
{"type": "text", "content": {"paragraphs": [{"role": "title-1", "text": "Q3"}, "A plain body paragraph."]}}
{"type": "list", "content": {"items": ["One", {"text": "Two", "items": ["Nested"]}]}, "props": {"marker": "bullet"}}
{"type": "table", "content": {"columns": ["Area", {"header": "Lines", "align": "right"}], "rows": [["frontend", "20 323"]]}}
{"type": "steps", "content": {"steps": [{"title": "Get a key", "text": "In Settings → API."}]}}
{"type": "timeline", "content": {"events": [{"date": "15/10", "title": "Fixed", "text": "Build in 110 s."}]}}
{"type": "kpi", "content": {"value": "28", "label": "Commits", "delta": "+27%", "trend": "up"}}
{"type": "card", "content": {"eyebrow": "Why", "title": "One document", "text": "People and agents edit the same file."}}
{"type": "chart", "content": {"kind": "bar", "categories": ["Aug", "Oct"], "series": [{"name": "Commits", "values": [22, 28]}]}}
{"type": "code", "content": {"code": "npm i @docforge-lib/layout", "language": "sh"}}
{"type": "divider"}
\`\`\`

Paragraph roles: title-1, title-2, title-3, subtitle, body, quote, caption. \`image\` takes
\`{src, alt, width, height}\`.

## Styles

Cascade: preset → document (by type or type.role) → region → class (labels) → the component.
Prefer tokens: $color.*, $size.xs…display, $space.0-6, $radius.*, $lineHeight.*.
Fonts: $font.sans (text), $font.heading (titles, KPI values, card titles), $font.mono. Bundled
families: Inter, Source Serif 4, Space Grotesk, JetBrains Mono. A theme is a set of tokens
(\`setTokens\`); \`$color.surface\` is the page color, so a dark theme sets it with light text.
Use \`calibrate_style\` to compare variants (sizes, lines, what moves) before choosing one.
`;
