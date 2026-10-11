import { defOf, type Chunk } from "../components";
import type { LayoutDocument } from "../schema/document";
import { diag, type Diagnostic } from "../validate/diagnostics";
import { itemsOf } from "./bands";
import { renderBox } from "./box";
import type { BandGeometry, ComponentGeometry, Frame, PageLayout, Prepared } from "./types";

/**
 * Flow the bands into pages. A band that does not fit moves to the next page; a band
 * holding one splittable component (text, list, table, code, steps, timeline) splits
 * between its chunks, repeating the table header. Continuous surfaces are one page.
 */
export function paginate(
  doc: LayoutDocument,
  prepared: Map<string, Prepared>,
  bands: Record<string, BandGeometry>,
  components: Record<string, ComponentGeometry>,
  frame: Frame,
  out: Diagnostic[],
): PageLayout[] {
  const { grid, margin } = frame;
  const paged = frame.height !== null;
  const pages: PageLayout[] = [];
  const newPage = (): PageLayout => {
    const page: PageLayout = {
      index: pages.length,
      width: frame.width,
      height: frame.height ?? 0,
      boxes: [],
      bands: [],
      content: {
        x: margin.left,
        y: margin.top,
        width: frame.contentWidth,
        height: Number.isFinite(frame.contentHeight) ? frame.contentHeight : 0,
      },
    };
    pages.push(page);
    return page;
  };

  let page = newPage();
  const top = margin.top;
  const bottom = top + frame.contentHeight;
  let cursor = top;
  let atTop = true;
  const anchoredSections = new Set<string>();

  const place = (p: Prepared, y: number, hgt: number, chunks: Chunk[], piece: number, split: boolean) => {
    const sectionAnchor = piece === 0 && !anchoredSections.has(p.section.id);
    if (sectionAnchor) anchoredSections.add(p.section.id);
    const x = frame.xOf(p.colStart);
    page.boxes.push({
      component: p.component.id,
      x,
      y,
      width: p.areaWidth,
      height: hgt,
      html: renderBox(p, x, y, p.areaWidth, hgt, chunks, { piece, sectionAnchor }),
      ...(split ? { piece } : {}),
    });
    const g = components[p.component.id];
    if (g && !g.pages.includes(page.index)) g.pages.push(page.index);
    const b = bands[p.band.id];
    if (b && !b.pages.includes(page.index)) b.pages.push(page.index);
  };

  doc.sections.forEach((section, si) => {
    section.bands.forEach((band, bi) => {
      const geo = bands[band.id];
      if (!geo) return;
      const items = itemsOf(band, prepared);
      const gap = atTop ? 0 : bi === 0 && si > 0 ? grid.sectionGap : grid.bandGap;
      let y = cursor + gap;
      const fits = y + geo.height <= bottom + 0.01;
      const single = items.length === 1 ? (items[0] as Prepared) : null;
      const canSplit = paged && single !== null && single.laid.splittable && defOf(single.component.type).sizing === "content";

      if (!fits && canSplit && single) {
        const p = single;
        const header = p.laid.header;
        const queue = [...p.laid.chunks];
        let piece = 0;
        if (!atTop && y + (queue[0]?.height ?? 0) + p.inset * 2 > bottom) {
          page = newPage();
          y = top;
        }
        while (queue.length) {
          const room = bottom - y - p.inset * 2;
          const take: Chunk[] = piece > 0 && header ? [header] : [];
          let used = take.reduce((s, c) => s + c.height, 0);
          while (queue.length && used + (queue[0] as Chunk).height <= room + 0.01) {
            const c = queue.shift() as Chunk;
            take.push(c);
            used += c.height;
          }
          if (take.length === 0 || (header && piece > 0 && take.length === 1)) {
            // Not even one chunk fits on an empty page: place it anyway and report.
            const c = queue.shift() as Chunk;
            take.push(c);
            used += c.height;
            out.push(diag("warning", "band-too-tall", `A slice of "${p.component.id}" is taller than the page content area.`, { component: p.component.id, band: band.id }));
          }
          const hgt = used + p.inset * 2;
          place(p, y, hgt, take, piece, true);
          page.bands.push({ id: band.id, section: section.id, y, height: hgt, rows: geo.rows, piece });
          cursor = y + hgt;
          if (queue.length) {
            page = newPage();
            y = top;
            piece += 1;
          }
        }
        atTop = false;
        return;
      }

      if (!fits && paged) {
        if (!atTop) {
          page = newPage();
          y = top;
        }
        if (geo.height > frame.contentHeight + 0.01) {
          out.push(
            diag("error", "band-too-tall", `Band "${band.id}" is ${Math.round(geo.height)}px tall; the page content area is ${Math.round(frame.contentHeight)}px.`, {
              band: band.id,
              section: section.id,
              suggestions: [
                "Lower the band span.",
                "Move components into separate bands.",
                "Put a single text, list, table or code component in the band so it can split across pages.",
              ],
            }),
          );
        }
      }

      for (const p of items) place(p, y, geo.height, p.laid.chunks, 0, false);
      if (items.length === 0 && !geo.pages.includes(page.index)) geo.pages.push(page.index);
      page.bands.push({ id: band.id, section: section.id, y, height: geo.height, rows: geo.rows });
      cursor = y + geo.height;
      atTop = false;
    });
  });

  if (!paged) {
    page.height = cursor + margin.bottom;
    page.content.height = cursor - margin.top;
  }
  return pages;
}
