/**
 * Isometric projection. World positions are in tile units: tile (tx, ty) covers
 * [tx, tx+1) x [ty, ty+1), so its centre is (tx + 0.5, ty + 0.5). +x runs down-right on
 * screen, +y runs down-left.
 */
export const TW = 64;
export const TH = 32;

export interface Pt {
  x: number;
  y: number;
}

/** Screen position (unscaled world pixels) of a point in tile units. */
export function iso(x: number, y: number): Pt {
  return { x: ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 };
}

/** Screen position of the centre of the tile a (fractional) tile index sits on. */
export function tileCentre(tx: number, ty: number): Pt {
  return iso(tx + 0.5, ty + 0.5);
}

/** Inverse of `iso`: a ground-level screen point back to tile units. */
export function screenToTile(sx: number, sy: number): Pt {
  return { x: sy / TH + sx / TW, y: sy / TH - sx / TW };
}

/**
 * Painter's order. Buildings are drawn one tile column at a time and every column on the
 * same diagonal (x + y) goes in one layer, so a scalar order is exact for the grid. People
 * and vehicles slot in just after the diagonal they stand on.
 */
export function diagonalZ(d: number): number {
  return d * 10;
}

export function entityZ(x: number, y: number): number {
  return diagonalZ(Math.round(x) + Math.round(y)) + 5;
}
