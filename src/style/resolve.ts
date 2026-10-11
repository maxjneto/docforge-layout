import type { Region } from "../schema/document";
import {
  PROP_TOKEN_GROUP,
  STYLE_PROPS,
  type ResolvedStyle,
  type ResolvedStyleWithOrigin,
  type StyleProp,
  type StyleProps,
} from "../schema/style";
import type { Tokens } from "../schema/tokens";
import { lookupToken, type TokenProblem } from "./tokens";

export interface StyleLayer {
  origin: string;
  props: StyleProps;
}

export interface StyleIssue {
  prop: StyleProp;
  written: unknown;
  origin: string;
  problem: TokenProblem | "invalid-value" | "conflict";
  /** For conflicts: the origins that disagree. */
  origins?: string[];
}

export interface ResolvedResult {
  style: ResolvedStyle;
  withOrigin: ResolvedStyleWithOrigin;
  issues: StyleIssue[];
}

/** Everything the cascade needs to know about one component. */
export interface CascadeInput {
  tokens: Tokens;
  presets: Record<string, StyleProps>;
  document: Record<string, StyleProps>;
  regions: Region[];
  labelStyles: Record<string, StyleProps>;
  componentLabels: string[];
  componentStyle?: StyleProps;
}

/**
 * The layers that apply to `type` (and optionally a `variant` of it), lowest first:
 * preset → document → region → label → component. Within the preset and document
 * layers the type comes before its variant.
 */
export function cascadeLayers(input: CascadeInput, type: string, variant?: string): StyleLayer[] {
  const selectors = variant ? [type, `${type}.${variant}`] : [type];
  const layers: StyleLayer[] = [];
  const star = input.presets["*"];
  if (star) layers.push({ origin: "preset", props: star });
  for (const sel of selectors) {
    const p = input.presets[sel];
    if (p) layers.push({ origin: "preset", props: p });
  }
  for (const sel of selectors) {
    const d = input.document[sel];
    if (d) layers.push({ origin: `document[${sel}]`, props: d });
  }
  for (const region of input.regions) layers.push({ origin: `region:${region.id}`, props: region.style });
  for (const label of input.componentLabels) {
    const l = input.labelStyles[label];
    if (l) layers.push({ origin: `label:${label}`, props: l });
  }
  if (input.componentStyle) layers.push({ origin: "component", props: input.componentStyle });
  return layers;
}

function convert(prop: StyleProp, raw: string | number | boolean): unknown {
  switch (prop) {
    case "fontSize":
    case "lineHeight":
    case "radius":
    case "padding":
    case "gap":
    case "borderWidth":
    case "fontWeight":
      return typeof raw === "number" ? raw : undefined;
    case "italic":
      return typeof raw === "boolean" ? raw : undefined;
    case "background":
      return raw === "none" || raw === "transparent" ? null : raw;
    default:
      return raw;
  }
}

/** Run the cascade and resolve tokens. Invalid references fall back to the layer below. */
export function resolveLayers(layers: StyleLayer[], tokens: Tokens): ResolvedResult {
  const entries: Partial<Record<StyleProp, { value: unknown; written: unknown; origin: string }>> = {};
  const issues: StyleIssue[] = [];
  const writers: Partial<Record<StyleProp, { origin: string; written: unknown }[]>> = {};

  for (const layer of layers) {
    for (const prop of STYLE_PROPS) {
      const written = layer.props[prop];
      if (written === undefined) continue;
      const group = PROP_TOKEN_GROUP[prop];
      let value: unknown;
      if (group === null) {
        value = convert(prop, written);
      } else {
        const looked = lookupToken(written, group, tokens);
        if (looked.problem === "unknown-token" || looked.problem === "wrong-group") {
          issues.push({ prop, written, origin: layer.origin, problem: looked.problem });
          continue;
        }
        if (looked.problem === "raw-value" && layer.origin !== "preset") {
          issues.push({ prop, written, origin: layer.origin, problem: "raw-value" });
        }
        value = convert(prop, looked.value as string | number);
      }
      if (value === undefined && !(prop === "background" && written !== undefined)) {
        issues.push({ prop, written, origin: layer.origin, problem: "invalid-value" });
        continue;
      }
      entries[prop] = { value, written, origin: layer.origin };
      if (layer.origin.startsWith("label:") || layer.origin.startsWith("region:")) {
        (writers[prop] ??= []).push({ origin: layer.origin, written });
      }
    }
  }

  for (const prop of STYLE_PROPS) {
    const list = writers[prop];
    if (!list || list.length < 2) continue;
    const distinct = new Set(list.map((w) => JSON.stringify(w.written)));
    if (distinct.size > 1) {
      const last = list[list.length - 1] as { origin: string; written: unknown };
      issues.push({ prop, written: last.written, origin: last.origin, problem: "conflict", origins: list.map((w) => w.origin) });
    }
  }

  const get = <K extends StyleProp>(prop: K, fallback: unknown) => {
    const e = entries[prop];
    return e ? e : { value: fallback, written: undefined, origin: "default" };
  };

  const withOrigin = {
    fontFamily: get("fontFamily", "Inter"),
    fontSize: get("fontSize", 15),
    fontWeight: get("fontWeight", 400),
    italic: get("italic", false),
    color: get("color", "#000000"),
    lineHeight: get("lineHeight", 1.5),
    align: get("align", "left"),
    background: get("background", null),
    borderColor: get("borderColor", "#d9dce1"),
    borderWidth: get("borderWidth", 0),
    radius: get("radius", 0),
    padding: get("padding", 0),
    gap: get("gap", 8),
    accent: get("accent", "#1f4fd8"),
    muted: get("muted", "#5b6168"),
  } as ResolvedStyleWithOrigin;

  const style = Object.fromEntries(
    Object.entries(withOrigin).map(([k, v]) => [k, (v as { value: unknown }).value]),
  ) as unknown as ResolvedStyle;

  return { style, withOrigin, issues };
}

export function resolveStyle(input: CascadeInput, type: string, variant?: string): ResolvedResult {
  return resolveLayers(cascadeLayers(input, type, variant), input.tokens);
}
