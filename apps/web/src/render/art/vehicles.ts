import { GraphicsContext } from "pixi.js";
import { PALETTE, shade } from "../color";
import { iso } from "../iso";
import type { Facing } from "../people-model";
import { box, faceX, faceY } from "./shapes";

export type VehicleKind = "danfo" | "keke" | "okada";

/** Size along the direction of travel, across it, and body height (tile units / px). */
const DIMS: Record<VehicleKind, { len: number; wid: number; hgt: number }> = {
  danfo: { len: 0.95, wid: 0.46, hgt: 22 },
  keke: { len: 0.55, wid: 0.36, hgt: 17 },
  okada: { len: 0.46, wid: 0.12, hgt: 9 },
};

function wheel(c: GraphicsContext, x: number, y: number): void {
  const p = iso(x, y);
  c.ellipse(p.x, p.y - 2, 3.2, 2.4).fill(0x151515);
}

/**
 * One vehicle drawn around its ground centre (0, 0). Along +x for se/nw, +y for sw/ne; the
 * front end gets headlights, the back tail lights (both glow brighter at night via `lights`).
 */
export function vehicleContext(kind: VehicleKind, facing: Facing, body: number): GraphicsContext {
  const c = new GraphicsContext();
  const d = DIMS[kind];
  const alongX = facing === "se" || facing === "nw";
  const lx = alongX ? d.len : d.wid;
  const ly = alongX ? d.wid : d.len;
  const x0 = -lx / 2;
  const y0 = -ly / 2;
  // Shadow
  const s = iso(0, 0);
  c.ellipse(s.x, s.y, (lx + ly) * 22, (lx + ly) * 9).fill({ color: 0x000000, alpha: 0.25 });
  // Wheels on the visible side
  if (alongX) {
    wheel(c, x0 + 0.15, y0 + ly);
    wheel(c, x0 + lx - 0.15, y0 + ly);
  } else {
    wheel(c, x0 + lx, y0 + 0.15);
    wheel(c, x0 + lx, y0 + ly - 0.15);
  }
  if (kind === "okada") {
    box(c, x0, y0, lx, ly, 3, d.hgt, 0x222222);
    // Rider: torso and helmet
    const r = iso(0, 0);
    c.roundRect(r.x - 4, r.y - d.hgt - 15, 8, 13, 3).fill(body);
    c.circle(r.x, r.y - d.hgt - 19, 4.2).fill(0x1d1d1d);
    return c;
  }
  const frontPositive = facing === "se" || facing === "sw";
  box(c, x0, y0, lx, ly, 3, d.hgt, body);
  // Windows band
  const wz0 = d.hgt * 0.55;
  const wz1 = d.hgt * 0.88;
  const glass = 0x2b3a4a;
  if (alongX) {
    faceY(c, y0 + ly, x0 + 0.08, x0 + lx - 0.08, wz0, wz1, glass);
    faceX(c, x0 + lx, y0 + 0.06, y0 + ly - 0.06, wz0, wz1, frontPositive ? 0x3b5266 : glass);
  } else {
    faceX(c, x0 + lx, y0 + 0.08, y0 + ly - 0.08, wz0, wz1, glass);
    faceY(c, y0 + ly, x0 + 0.06, x0 + lx - 0.06, wz0, wz1, frontPositive ? 0x3b5266 : glass);
  }
  if (kind === "danfo") {
    // The black stripes every Lagos danfo wears.
    const stripe = 0x111111;
    if (alongX) {
      faceY(c, y0 + ly, x0, x0 + lx, d.hgt * 0.32, d.hgt * 0.4, stripe);
      faceY(c, y0 + ly, x0, x0 + lx, d.hgt * 0.18, d.hgt * 0.24, stripe);
    } else {
      faceX(c, x0 + lx, y0, y0 + ly, d.hgt * 0.32, d.hgt * 0.4, stripe);
      faceX(c, x0 + lx, y0, y0 + ly, d.hgt * 0.18, d.hgt * 0.24, stripe);
    }
  } else {
    // Keke canopy
    const top = iso(0, 0);
    c.poly([
      top.x - 12,
      top.y - d.hgt - 2,
      top.x + 12,
      top.y - d.hgt - 2,
      top.x + 10,
      top.y - d.hgt - 7,
      top.x - 10,
      top.y - d.hgt - 7,
    ]).fill(0x1d1d1d);
  }
  // Lights on the visible end face
  const lightColor = frontPositive ? 0xfff2b0 : 0xd62828;
  if (alongX) {
    faceX(c, x0 + lx, y0 + 0.04, y0 + 0.12, 6, 10, lightColor);
    faceX(c, x0 + lx, y0 + ly - 0.12, y0 + ly - 0.04, 6, 10, lightColor);
  } else {
    faceY(c, y0 + ly, x0 + 0.04, x0 + 0.12, 6, 10, lightColor);
    faceY(c, y0 + ly, x0 + lx - 0.12, x0 + lx - 0.04, 6, 10, lightColor);
  }
  return c;
}

export const KEKE_COLORS = [0xf6c90e, 0x2a9d8f, 0x3a86ff, 0x6a994e];
export const DANFO = PALETTE.danfo;
export const DANFO_SHADE = shade(PALETTE.danfo, 0.8);
