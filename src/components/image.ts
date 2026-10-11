import { absStyle, h, safeSrc } from "../render/html";
import type { ComponentDef } from "./types";

const MIN_HEIGHT = 24;

/** Natural height keeps the image's aspect ratio at the area width; `fit` decides how it fills a fixed area. */
export const imageComponent: ComponentDef<"image"> = {
  type: "image",
  sizing: "area",
  decorated: true,
  variants: [],

  layout(component, ctx) {
    const { src, alt, width, height: intrinsicHeight } = component.content;
    const fit = component.props?.fit ?? "contain";
    const natural = (ctx.width * intrinsicHeight) / width;
    const height = ctx.height ?? natural;
    const radius = ctx.style().radius;
    return {
      needed: MIN_HEIGHT,
      natural,
      splittable: false,
      diagnostics: [],
      facts: { natural: Math.round(natural), fit },
      chunks: [
        {
          height,
          html: (x, y) =>
            h("img", {
              src: safeSrc(src) ?? "",
              alt,
              style: absStyle(x, y, ctx.width, height, { objectFit: fit, borderRadius: radius || null, display: "block" }),
            }),
        },
      ],
    };
  },

  describe(component) {
    return `image ${component.content.width}×${component.content.height} "${component.content.alt}"`;
  },
};
