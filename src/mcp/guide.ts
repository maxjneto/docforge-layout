/** The guide the stdio MCP server serves as a resource (docforge-layout://guide). */
export const AGENT_GUIDE = `# DocForge layout documents (local files)

A layout document is a JSON file (\`*.docforge.json\`) of **components placed on a grid of square units**.
You never see the page. You read a **text map** (each page drawn in ASCII, plus a table),
**measure** components and **preview** changes for free, and every write tells you what the
layout did on its own.

Tools: \`create_layout_document\`, \`get_layout_map\`, \`find_layout\`, \`measure_component\`,
\`preview_layout\`, \`apply_layout_ops\`, \`review_layout\`, \`calibrate_style\`, \`render_layout\` (HTML to print as PDF),
\`get_layout_document\`, \`upgrade_layout_document\`. Paths are relative to the server's root folder.

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
{"op": "remove", "component": "k1"}
{"op": "setStyle", "layer": "document", "selector": "text.title-1", "style": {...}}
{"op": "setStyle", "layer": "label", "label": "highlight", "style": {...}}
{"op": "setTokens", "tokens": {"color": {"primary": "#0b6e4f"}}}
{"op": "setGrid", "grid": {"unit": 8, "columns": 12, "gutter": 16, "gap": 2}}
{"op": "setSurface", "surface": {"id": "a4", "kind": "page", "size": "A4", "margin": 40, "maxPages": 2}}
{"op": "setMeta", "meta": {"title": "Q3", "locale": "pt-BR"}}
{"op": "compact", "acrossPages": true}
{"op": "fit", "pages": 2, "strategies": ["compact", "heights", "spacing", "type"], "minScale": 0.85}
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
- \`compact\` moves components up into empty space (optionally only some, one page, or across pages).
- \`fit\` makes the document fit a page count with the strategies you allow, mildest first (compact,
  heights — minimum heights down to what content needs —, spacing, type); it changes nothing (and
  says so) when it cannot.

## Components

text (paragraphs with roles title-1/2/3, subtitle, body, quote, caption; inline **bold**, *italic*,
\`code\`, [link](https://… or #id)) · list · table · code · steps · timeline · kpi · card · chart
(bar/line/pie) · image · divider.

## Styles

Cascade: preset → document (by type or type.role) → region → class (labels) → the component.
Prefer tokens: $color.*, $size.xs…display, $space.0-6, $radius.*, $lineHeight.*.
Use \`calibrate_style\` to compare variants (sizes, lines, what moves) before choosing one.
`;
