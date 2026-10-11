import { defOf } from "../components";
import type { LayoutDocument } from "../schema/document";
import { diag, type Diagnostic } from "../validate/diagnostics";
import type { BandGeometry, ComponentGeometry, Frame, Prepared } from "./types";

/** Items of a band that were measured (skips unknown or twice-placed components). */
export function itemsOf(band: LayoutDocument["sections"][number]["bands"][number], prepared: Map<string, Prepared>): Prepared[] {
  return band.items.map((i) => prepared.get(i.component)).filter((p): p is Prepared => !!p && p.band === band);
}

/**
 * Give every band its height (fixed span, or the tallest component for `auto`),
 * report components that do not fit, and lay area-sized components out again at
 * their final height.
 */
export function sizeBands(
  doc: LayoutDocument,
  prepared: Map<string, Prepared>,
  frame: Frame,
  out: Diagnostic[],
): { bands: Record<string, BandGeometry>; components: Record<string, ComponentGeometry> } {
  const { grid } = frame;
  const bands: Record<string, BandGeometry> = {};
  const components: Record<string, ComponentGeometry> = {};

  for (const section of doc.sections) {
    for (const band of section.bands) {
      const items = itemsOf(band, prepared);
      let height: number;
      if (band.span === "auto") {
        const tallest = Math.max(0, ...items.map((p) => p.laid.natural + p.inset * 2));
        height = Math.max(1, Math.ceil(tallest / grid.rowUnit - 1e-6)) * grid.rowUnit;
      } else height = band.span * grid.rowUnit;
      bands[band.id] = { id: band.id, section: section.id, span: band.span, height, rows: Math.round(height / grid.rowUnit), pages: [] };

      for (const p of items) {
        const def = defOf(p.component.type);
        const needed = p.laid.needed + p.inset * 2;
        const overflow = needed - height;
        if (overflow > 0.5) {
          const rowsNeeded = Math.ceil(needed / grid.rowUnit - 1e-6);
          const suggestions = [`Set band "${band.id}" span to ${rowsNeeded} (or "auto").`];
          if (def.sizing === "content" && p.colSpan < grid.columns) {
            suggestions.push(`Widen "${p.component.id}" (colSpan ${p.colSpan} → more) so it takes fewer lines.`);
          }
          if (def.sizing === "content") suggestions.push(`Shorten the content by about ${Math.ceil((overflow / needed) * 100)}%.`);
          out.push(
            diag(
              "error",
              "overflow",
              `"${p.component.id}" needs ${Math.ceil(needed)}px (${rowsNeeded} rows); its area in band "${band.id}" is ${Math.round(height)}px (${Math.round(height / grid.rowUnit)} rows) — ${Math.ceil(overflow)}px short.`,
              {
                component: p.component.id,
                band: band.id,
                section: section.id,
                data: { needed: Math.ceil(needed), area: Math.round(height), short: Math.ceil(overflow), rowsNeeded },
                suggestions,
              },
            ),
          );
        }
        if (def.sizing === "area") {
          // Area components draw into the final height; their diagnostics come from this pass.
          p.ctx.height = Math.max(0, height - p.inset * 2);
          p.laid = def.layout(p.component as never, p.ctx);
        }
        for (const d of p.laid.diagnostics) out.push({ ...d, component: d.component ?? p.component.id, band: d.band ?? band.id });
        components[p.component.id] = {
          id: p.component.id,
          type: p.component.type,
          sizing: def.sizing,
          section: section.id,
          band: band.id,
          colStart: p.colStart,
          colSpan: p.colSpan,
          area: { width: p.areaWidth, height },
          needed: Math.ceil(needed),
          natural: Math.ceil(p.laid.natural + p.inset * 2),
          overflow: Math.max(0, Math.ceil(overflow)),
          pages: [],
          facts: p.laid.facts ?? {},
          style: p.styleWithOrigin,
        };
      }
    }
  }
  return { bands, components };
}
