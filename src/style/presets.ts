import type { StyleProps } from "../schema/style";

/**
 * Built-in presets: the lowest layer of the cascade. `*` applies to every component,
 * `type` to one component type and `type.variant` to a part of it (a text role, a
 * table header, a KPI label…).
 */
export const defaultPresets: Record<string, StyleProps> = {
  "*": {
    fontFamily: "$font.sans",
    fontSize: "$size.m",
    fontWeight: 400,
    italic: false,
    color: "$color.text",
    lineHeight: "$lineHeight.normal",
    align: "left",
    borderColor: "$color.border",
    borderWidth: 0,
    radius: "$radius.none",
    padding: "$space.0",
    gap: "$space.2",
    accent: "$color.primary",
    muted: "$color.muted",
  },

  text: { gap: "$space.3" },
  "text.title-1": { fontFamily: "$font.heading", fontSize: "$size.xxl", fontWeight: 700, lineHeight: "$lineHeight.tight" },
  "text.title-2": { fontFamily: "$font.heading", fontSize: "$size.xl", fontWeight: 700, lineHeight: "$lineHeight.tight" },
  "text.title-3": { fontFamily: "$font.heading", fontSize: "$size.l", fontWeight: 600, lineHeight: "$lineHeight.tight" },
  "text.subtitle": { fontSize: "$size.l", color: "$color.muted" },
  "text.quote": { italic: true, color: "$color.muted" },
  "text.caption": { fontSize: "$size.s", color: "$color.muted" },

  list: { gap: "$space.1" },

  table: { fontSize: "$size.s", gap: "$space.2" },
  "table.header": { fontWeight: 600, background: "$color.subtle" },

  code: {
    fontFamily: "$font.mono",
    fontSize: "$size.s",
    background: "$color.subtle",
    padding: "$space.3",
    radius: "$radius.s",
  },

  steps: { gap: "$space.4" },
  "steps.title": { fontWeight: 600 },

  timeline: { gap: "$space.4" },
  "timeline.date": { fontSize: "$size.s", color: "$color.muted" },
  "timeline.title": { fontWeight: 600 },

  kpi: {
    fontFamily: "$font.heading",
    fontSize: "$size.display",
    fontWeight: 700,
    lineHeight: "$lineHeight.tight",
    background: "$color.subtle",
    radius: "$radius.m",
    padding: "$space.4",
  },
  "kpi.label": { fontFamily: "$font.sans", fontSize: "$size.s", fontWeight: 400, color: "$color.muted", lineHeight: "$lineHeight.normal" },
  "kpi.delta": { fontFamily: "$font.sans", fontSize: "$size.s", fontWeight: 600, lineHeight: "$lineHeight.normal" },

  card: {
    background: "$color.surface",
    borderWidth: 1,
    borderColor: "$color.border",
    radius: "$radius.m",
    padding: "$space.4",
    gap: "$space.2",
  },
  "card.eyebrow": { fontSize: "$size.xs", fontWeight: 600, color: "$color.muted" },
  "card.title": { fontFamily: "$font.heading", fontSize: "$size.l", fontWeight: 600, lineHeight: "$lineHeight.tight" },
  "card.value": { fontFamily: "$font.heading", fontSize: "$size.xxl", fontWeight: 700, lineHeight: "$lineHeight.tight" },
  "card.footer": { fontSize: "$size.s", fontWeight: 600, color: "$color.primary" },

  chart: { fontSize: "$size.xs", color: "$color.muted" },

  divider: { borderWidth: 1 },
};
