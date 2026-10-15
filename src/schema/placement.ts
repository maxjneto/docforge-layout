import { z } from "zod";

const Unit = z.number().int().min(0);
const Size = z.number().int().min(1);

/**
 * Where a component sits: a page (1-based) and a box in grid units, measured from the
 * top-left corner of the page's content area. `h` is a minimum height: content that
 * needs more grows the box (and pushes whatever it runs into).
 */
export const PlacementSchema = z
  .object({
    page: z.number().int().min(1),
    x: Unit,
    y: Unit,
    w: Size,
    h: Size.optional(),
  })
  .strict();
export type Placement = z.infer<typeof PlacementSchema>;

/** A rectangle in grid units, optionally limited to one page. */
export const RectSchema = z
  .object({
    page: z.number().int().min(1).optional(),
    x: Unit,
    y: Unit,
    w: Size,
    h: Size,
  })
  .strict();
export type Rect = z.infer<typeof RectSchema>;
