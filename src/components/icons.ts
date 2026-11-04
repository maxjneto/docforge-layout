import { absStyle, h } from "../render/html";

/**
 * The library's only icons: a closed set drawn in SVG, never loaded from a URL. Each is
 * drawn in a 16×16 box with strokes in one color.
 */
export const ICONS = ["info", "bulb", "warning", "alert", "check"] as const;
export type IconName = (typeof ICONS)[number];

const STROKE = { fill: "none", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round" } as const;

function shapes(name: IconName, color: string): string {
  const s = { ...STROKE, stroke: color };
  switch (name) {
    case "info":
      return h("circle", { cx: 8, cy: 8, r: 6.5, ...s }) + h("line", { x1: 8, y1: 7.2, x2: 8, y2: 11.2, ...s }) + h("circle", { cx: 8, cy: 4.9, r: 0.9, fill: color });
    case "bulb":
      return (
        h("path", { d: "M5.6 10.2C4.5 9.4 3.8 8.1 3.8 6.7a4.2 4.2 0 0 1 8.4 0c0 1.4-.7 2.7-1.8 3.5v1.3H5.6z", ...s }) +
        h("line", { x1: 6.2, y1: 13.6, x2: 9.8, y2: 13.6, ...s })
      );
    case "warning":
      return (
        h("path", { d: "M8 1.8 14.6 13.6H1.4z", ...s }) +
        h("line", { x1: 8, y1: 6.2, x2: 8, y2: 9.4, ...s }) +
        h("circle", { cx: 8, cy: 11.6, r: 0.9, fill: color })
      );
    case "alert":
      return h("circle", { cx: 8, cy: 8, r: 6.5, ...s }) + h("line", { x1: 8, y1: 4.6, x2: 8, y2: 8.6, ...s }) + h("circle", { cx: 8, cy: 11.1, r: 0.9, fill: color });
    case "check":
      return h("circle", { cx: 8, cy: 8, r: 6.5, ...s }) + h("polyline", { points: "5,8.2 7.2,10.4 11,6", ...s });
  }
}

/** An icon at (x, y), `size` px square, hidden from assistive technology (the text says the same). */
export function icon(name: IconName, x: number, y: number, size: number, color: string, part?: string): string {
  return h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      "aria-hidden": "true",
      ...(part ? { "data-part": part } : {}),
      style: absStyle(x, y, size, size, { overflow: "visible" }),
    },
    shapes(name, color),
  );
}
