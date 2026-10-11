import { defOf, type ComponentContext } from "../components";
import type { LayoutDocument } from "../schema/document";
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

/**
 * Check every placement against the grid, run the style cascade and lay each placed
 * component out once at its area width (height still unknown).
 */
export function measureComponents(input: MeasureInput, out: Diagnostic[]): { prepared: Map<string, Prepared>; links: Link[] } {
  const { doc, structure, frame, tokens, registry, locale } = input;
  const { grid } = frame;
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
  const prepared = new Map<string, Prepared>();

  for (const section of doc.sections) {
    for (const band of section.bands) {
      const ranges: { id: string; start: number; end: number }[] = [];
      for (const item of band.items) {
        const component = structure.components.get(item.component);
        if (!component || structure.placedAt.get(item.component) !== band.id) continue;

        let { colStart, colSpan } = item;
        if (colStart + colSpan - 1 > grid.columns) {
          out.push(
            diag("error", "column-out-of-range", `"${component.id}" spans columns ${colStart}–${colStart + colSpan - 1}; the grid has ${grid.columns}.`, {
              component: component.id,
              band: band.id,
              suggestions: [`Use colStart + colSpan - 1 ≤ ${grid.columns}.`],
            }),
          );
          colStart = Math.min(colStart, grid.columns);
          colSpan = grid.columns - colStart + 1;
        }
        const end = colStart + colSpan - 1;
        for (const other of ranges) {
          if (colStart <= other.end && end >= other.start) {
            out.push(
              diag("error", "column-overlap", `"${component.id}" (cols ${colStart}–${end}) overlaps "${other.id}" (cols ${other.start}–${other.end}) in band "${band.id}".`, {
                component: component.id,
                band: band.id,
              }),
            );
          }
        }
        ranges.push({ id: component.id, start: colStart, end });

        const cascade: CascadeInput = {
          ...cascadeBase,
          regions: regions.filter(
            (r) => r.section === section.id && (!r.bands || r.bands.includes(band.id)) && (!r.cols || (colStart <= r.cols[1] && end >= r.cols[0])),
          ),
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
        const areaWidth = frame.areaWidthOf(colSpan);
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

        prepared.set(component.id, {
          component,
          section,
          band,
          colStart,
          colSpan,
          areaWidth,
          inset,
          decoration: base.style,
          laid,
          ctx,
          styleWithOrigin: base.withOrigin,
        });
      }
    }
  }
  return { prepared, links };
}
