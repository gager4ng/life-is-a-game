import type { Graphics, GraphicsContext } from "pixi.js";
import { iso } from "../iso";

type G = Graphics | GraphicsContext;

/** Flat diamond covering [x, x+w) x [y, y+h) in tile units, lifted `z` pixels. */
export function diamond(
  g: G,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  color: number,
  alpha = 1,
): void {
  const a = iso(x, y);
  const b = iso(x + w, y);
  const c = iso(x + w, y + h);
  const d = iso(x, y + h);
  g.poly([a.x, a.y - z, b.x, b.y - z, c.x, c.y - z, d.x, d.y - z]).fill({ color, alpha });
}

/**
 * A wall face along the +x edge (x = const, from y0 to y1) or the +y edge (y = const, from
 * x0 to x1), from height z0 to z1. `u0..u1` picks a part of the edge (0..1) for windows.
 */
export function faceX(
  g: G,
  x: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: number,
  alpha = 1,
): void {
  const a = iso(x, y0);
  const b = iso(x, y1);
  g.poly([a.x, a.y - z0, b.x, b.y - z0, b.x, b.y - z1, a.x, a.y - z1]).fill({ color, alpha });
}

export function faceY(
  g: G,
  y: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  color: number,
  alpha = 1,
): void {
  const a = iso(x0, y);
  const b = iso(x1, y);
  g.poly([a.x, a.y - z0, b.x, b.y - z0, b.x, b.y - z1, a.x, a.y - z1]).fill({ color, alpha });
}

/** A solid box [x, x+w) x [y, y+h), from z0 to z1 pixels: two visible walls and a top. */
export function box(
  g: G,
  x: number,
  y: number,
  w: number,
  h: number,
  z0: number,
  z1: number,
  color: number,
  shadeL = 0.92,
  shadeR = 0.75,
): void {
  faceY(g, y + h, x, x + w, z0, z1, mulColor(color, shadeL));
  faceX(g, x + w, y, y + h, z0, z1, mulColor(color, shadeR));
  diamond(g, x, y, w, h, z1, color);
}

function mulColor(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 0xff) * f));
  const gg = Math.min(255, Math.round(((c >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((c & 0xff) * f));
  return (r << 16) | (gg << 8) | b;
}

/** Soft round shadow on the ground at a tile-unit point. */
export function groundShadow(g: G, x: number, y: number, r: number, alpha = 0.22): void {
  const p = iso(x, y);
  g.ellipse(p.x, p.y, r, r / 2).fill({ color: 0x000000, alpha });
}
