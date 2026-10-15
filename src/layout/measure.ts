import { defOf, type ComponentContext } from "../components";
import type { LayoutDocument, Region } from "../schema/document";
import type { Placement } from "../schema/placement";
import type { ResolvedStyle } from "../schema/style";
import type { Tokens } from "../schema/tokens";
import type { FontRegistry } from "../fonts/registry";
import { defaultPresets } from "../style/presets";
import { resolveStyle, type CascadeInput, type ResolvedResult, type StyleIssue } from "../style/resolve";
import { colorValue } from "../style/tokens";
import { diag, type Diagnostic } from "../validate/diagnostics";
import type { Structure } from "./structure";
import type { Frame, Link, Prepared } from "./types";

function issueToDiagnostic(issue: StyleIssue, componentId: string): Diagnostic {
  const where = `${componentId}: ${issue.prop} = ${JSON.stringify(issue.written)} (from ${issue.origin})`;
  const data = { prop: issue.prop, origin: issue.origin };
  switch (issue.problem) {
    case "unknown-token":
      return diag("warning", "unknown-token", `${where} points to a token that does not exist; the layer below wins.`, { component: componentId, data });
    case "wrong-group":
      return diag("warning", "wrong-token-group", `${where} points to the wrong token group; the layer below wins.`, { component: componentId, data });
    case "raw-value":
      return diag("info", "raw-value", `${where} is a raw value; prefer a token so a theme change reaches it.`, { component: componentId, data });
    case "conflict":
      return diag(
        "warning",
        "style-conflict",
        `${componentId}: ${issue.prop} is set differently by ${(issue.origins ?? []).join(", ")}; ${issue.origin} wins (last in order).`,
        { component: componentId, data: { prop: issue.prop, origins: issue.origins } },
      );
    default:
      return diag("warning", "invalid-style-value", `${where} is not a valid value for this property.`, { component: componentId, data });
  }
}

export interface MeasureInput {
  doc: LayoutDocument;
  structure: Structure;
  frame: Frame;
  tokens: Tokens;
  registry: FontRegistry;
  locale: string;
}

/** Regions apply to components whose declared top-left corner falls inside them. */
function regionsFor(regions: Region[], at: Placement): Region[] {
  return regions.filter(
    (r) => (r.page === undefined || r.page === at.page) && at.x >= r.x && at.x < r.x + r.w && at.y >= r.y && at.y < r.y + r.h,
  );
}

/**
 * Fit every placed component into the page width, run the style cascade and lay each
 * one out once at its box width (height still unknown).
 */
export function measureComponents(input: MeasureInput, out: Diagnostic[]): { prepared: Prepared[]; links: Link[] } {
  const { doc, structure, frame, tokens, registry, locale } = input;
  const unit = frame.grid.unit;
  const regions = doc.styles?.regions ?? [];
  const cascadeBase = {
    tokens,
    presets: defaultPresets,
    document: doc.styles?.document ?? {},
    labelStyles: doc.styles?.labels ?? {},
  };
  const runStyle = {
    tokens,
    monoFamily: tokens.font.mono ?? "JetBrains Mono",
    linkColor: colorValue("$color.primary", tokens, "#1f4fd8"),
  };
  const reportedFonts = new Set<string>();
  const links: Link[] = [];
  const prepared: Prepared[] = [];

  structure.placed.forEach((component, order) => {
    const declared = component.at as Placement;
    let { x, w } = declared;
    let clamped = false;
    if (x + w > frame.cols) {
      clamped = true;
      if (w > frame.cols) {
        w = frame.cols;
        x = 0;
      } else x = frame.cols - w;
      out.push(
        diag("warning", "out-of-page", `"${component.id}" spans x ${declared.x}–${declared.x + declared.w}; the page is ${frame.cols} units wide. Drawn at x ${x}, w ${w}.`, {
          component: component.id,
          data: { declared: { x: declared.x, w: declared.w }, drawn: { x, w }, cols: frame.cols },
          suggestions: [`Place it with x + w ≤ ${frame.cols}.`],
        }),
      );
    }

    const cascade: CascadeInput = {
      ...cascadeBase,
      regions: regionsFor(regions, declared),
      componentLabels: component.labels ?? [],
      componentStyle: component.style,
    };
    // One resolution per (component, variant): issues are reported once, origins reused by the map.
    const resolved = new Map<string, ResolvedResult>();
    const resolve = (variant?: string): ResolvedResult => {
      const key = variant ?? "";
      const cached = resolved.get(key);
      if (cached) return cached;
      const result = resolveStyle(cascade, component.type, variant);
      for (const issue of result.issues) out.push(issueToDiagnostic(issue, component.id));
      const family = result.style.fontFamily;
      if (!registry.hasFamily(family) && !reportedFonts.has(family)) {
        reportedFonts.add(family);
        out.push(
          diag("warning", "unknown-font", `Font family "${family}" is not registered; "${registry.families()[0] ?? "?"}" is used instead.`, {
            component: component.id,
            suggestions: [`Use one of: ${registry.families().join(", ")}.`],
          }),
        );
      }
      resolved.set(key, result);
      return result;
    };
    const styleOf = (variant?: string): ResolvedStyle => resolve(variant).style;

    const def = defOf(component.type);
    const base = resolve();
    const inset = def.decorated ? base.style.padding + base.style.borderWidth : 0;
    const areaWidth = w * unit;
    const ctx: ComponentContext = {
      registry,
      tokens,
      style: styleOf,
      runStyle: { ...runStyle, onLink: (href: string) => links.push({ component: component.id, href }) },
      width: Math.max(1, areaWidth - inset * 2),
      height: null,
      locale,
    };
    const laid = def.layout(component as never, ctx);
    const boxHref = (component as { props?: { href?: string } }).props?.href;
    if (boxHref) links.push({ component: component.id, href: boxHref });

    prepared.push({
      component,
      declared,
      x,
      w,
      clamped,
      areaWidth,
      inset,
      decoration: base.style,
      laid,
      ctx,
      styleWithOrigin: base.withOrigin,
      order,
    });
  });
  return { prepared, links };
}
