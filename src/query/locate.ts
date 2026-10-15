import type { LayoutResult, UnitBox } from "../layout/types";
import type { Rect } from "../schema/placement";
import { findComponents } from "./find";

/** Something a note points at: a component, an area of the grid, or both. */
export interface Anchor {
  component?: string;
  rect?: Rect;
}

export interface Located {
  /** The anchored component as it is drawn now; `exists: false` once it was removed or unplaced. */
  component?: { id: string; exists: boolean; box?: UnitBox; pieces?: UnitBox[] };
  /** Components drawn over the anchor's area now (the rect, else the component's box). */
  under: string[];
  /** One line: where the anchor is now and what is there. */
  text: string;
}

const where = (b: UnitBox) => `p${b.page} x${b.x} y${b.y} w${b.w} h${b.h}`;

/** Where each anchor is now: positions move with the layout, so notes are resolved on every read. */
export function locateAnchors(result: LayoutResult, anchors: Anchor[]): Located[] {
  return anchors.map((anchor) => {
    const parts: string[] = [];
    let component: Located["component"];
    let area: Rect | undefined = anchor.rect;
    if (anchor.component !== undefined) {
      const g = result.components[anchor.component];
      if (g) {
        component = { id: g.id, exists: true, box: g.box, pieces: g.pieces };
        parts.push(`${g.id} is at ${g.pieces.map(where).join(" + ")}`);
        area ??= g.box;
      } else {
        component = { id: anchor.component, exists: false };
        parts.push(`${anchor.component} is no longer in the document`);
      }
    }
    if (anchor.rect) parts.push(`area ${anchor.rect.page ? `p${anchor.rect.page} ` : ""}x${anchor.rect.x} y${anchor.rect.y} w${anchor.rect.w} h${anchor.rect.h}`);
    const under = area ? findComponents(result, { rect: area }).matches.map((m) => m.id).filter((id) => id !== anchor.component) : [];
    if (anchor.rect || under.length) parts.push(under.length ? `over: ${under.join(", ")}` : "over: nothing");
    return { ...(component ? { component } : {}), under, text: parts.join(" · ") };
  });
}
