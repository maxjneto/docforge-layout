import { rect } from "./shared";
import { h } from "../render/html";
import type { ComponentDef } from "./types";

const NATURAL = 16;

/** A rule (or plain space) centered vertically in its area. Draws its own line, so no box decoration. */
export const dividerComponent: ComponentDef<"divider"> = {
  type: "divider",
  sizing: "area",
  decorated: false,
  variants: [],

  layout(component, ctx) {
    const style = ctx.style();
    const kind = component.props?.kind ?? "line";
    const thickness = Math.max(1, style.borderWidth);
    const height = ctx.height ?? NATURAL;
    return {
      needed: kind === "line" ? thickness : 0,
      natural: NATURAL,
      splittable: false,
      diagnostics: [],
      chunks: [
        {
          height,
          html: (x, y) =>
            kind === "line" ? rect(x, y + (height - thickness) / 2, ctx.width, thickness, { background: style.borderColor }) : "",
        },
      ],
    };
  },

  semantic(component) {
    return component.props?.kind === "space" ? "" : h("hr", {});
  },

  describe(component) {
    return component.props?.kind === "space" ? "space" : "divider line";
  },
};
