import type { Box } from "../render/city-model";

/**
 * 3D world units: 1 unit = 1 map tile. Tile (tx, ty) covers x in [tx, tx+1) and z in [ty, ty+1);
 * y is up. So map x is world x and map y is world z.
 */

/** Height of one storey. */
export const FLOOR_H = 0.62;
/** A person is about this tall (a little larger than life so they read on a phone). */
export const PERSON_H = 0.56;

export function buildingHeight(b: Pick<Box, "style">): number {
  return b.style.floors * FLOOR_H + 0.12;
}

/** World point for a (fractional) tile position: the centre of tile (tx, ty) is (tx+.5, ty+.5). */
export function tileCentre(tx: number, ty: number): { x: number; z: number } {
  return { x: tx + 0.5, z: ty + 0.5 };
}

/** The tile under a world point. */
export function worldToTile(x: number, z: number): { tx: number; ty: number } {
  return { tx: Math.floor(x), ty: Math.floor(z) };
}

/** Yaw (rotation about y) that turns a figure built facing +z towards the direction (dx, dz). */
export function yawFor(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Shortest signed difference between two angles. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
