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
  /** The one large sentence of a slide. */
  "text.display": { fontFamily: "$font.heading", fontSize: "$size.display", fontWeight: 700, lineHeight: "$lineHeight.tight" },
  "text.title-1": { fontFamily: "$font.heading", fontSize: "$size.xxl", fontWeight: 700, lineHeight: "$lineHeight.tight" },
  "text.title-2": { fontFamily: "$font.heading", fontSize: "$size.xl", fontWeight: 700, lineHeight: "$lineHeight.tight" },
  "text.title-3": { fontFamily: "$font.heading", fontSize: "$size.l", fontWeight: 600, lineHeight: "$lineHeight.tight" },
  "text.subtitle": { fontSize: "$size.l", color: "$color.muted" },
  "text.quote": { italic: true, color: "$color.muted" },
  "text.caption": { fontSize: "$size.s", color: "$color.muted" },

  list: { gap: "$space.1" },

  /** Space between blocks; a block opening with a title gets twice as much above it. */
  flow: { gap: "$space.3" },

  table: { fontSize: "$size.s", gap: "$space.2" },
  "table.header": { fontWeight: 600, background: "$color.subtle" },
  /** Every other row when `props.zebra` is on: only its background is read. */
  "table.zebra": { background: "$color.subtle" },
  /** The `footer` row (totals). */
  "table.footer": { fontWeight: 600, background: "$color.subtle" },

  code: {
    fontFamily: "$font.mono",
    fontSize: "$size.s",
    background: "$color.subtle",
    padding: "$space.3",
    radius: "$radius.s",
  },

  steps: { gap: "$space.4" },
  "steps.title": { fontWeight: 600 },
  /** The numbered badge: its text color here; its background is the block's accent unless set. */
  "steps.number": { color: "#ffffff" },

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

  /** The bar and icon take the kind's accent (`callout.<kind>`). */
  callout: { background: "$color.subtle", padding: "$space.3", radius: "$radius.s", gap: "$space.2" },
  "callout.title": { fontWeight: 600 },
  "callout.note": { accent: "$color.primary" },
  "callout.tip": { accent: "$color.success" },
  "callout.warning": { accent: "$color.warning" },
  "callout.important": { accent: "$color.danger" },
  "callout.success": { accent: "$color.success" },

  tags: { gap: "$space.1" },
  /** Each tag: its text, and its background when the item gives no color. */
  "tags.tag": { fontSize: "$size.s", background: "$color.subtle" },

  progress: { fontSize: "$size.s", gap: "$space.2" },
  "progress.value": { color: "$color.muted" },

  cover: { padding: "$space.6", gap: "$space.3" },
  "cover.eyebrow": { fontSize: "$size.s", fontWeight: 600, color: "$color.muted" },
  "cover.title": { fontFamily: "$font.heading", fontSize: "$size.display", fontWeight: 700, lineHeight: "$lineHeight.tight" },
  "cover.subtitle": { fontSize: "$size.l", color: "$color.muted" },
  "cover.meta-label": { fontSize: "$size.xs", fontWeight: 600, color: "$color.muted" },
  "cover.meta": { fontSize: "$size.s" },

  toc: { gap: "$space.2" },
  "toc.title": { fontFamily: "$font.heading", fontSize: "$size.xl", fontWeight: 700, lineHeight: "$lineHeight.tight" },
  "toc.entry-1": { fontWeight: 600, gap: "$space.3" },
  "toc.entry-2": { gap: "$space.1" },
  "toc.entry-3": { fontSize: "$size.s", gap: "$space.1" },
  "toc.page": { color: "$color.muted" },

  /** Header and footer text in a page master (its components take this over their own presets). */
  master: { color: "$color.pageChrome", fontSize: "$size.s" },

  /** The line under an image. */
  "image.caption": { fontSize: "$size.s", color: "$color.muted" },
};
