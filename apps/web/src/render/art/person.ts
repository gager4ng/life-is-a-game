import { GraphicsContext } from "pixi.js";
import { shade } from "../color";
import type { Look } from "../look";

/**
 * Small city-scale people, built from layers (legs, lower garment, top, arms, head, hair,
 * headwear) in the person's own colours. Each look gets a handful of pre-built frames so
 * walking never re-tessellates anything: front and back views, idle plus four walk frames.
 * The two left-facing directions are the right-facing ones mirrored.
 */

export const WALK_FRAMES = 4;

export interface PersonFrames {
  /** [idle, walk0..walk3] facing towards the camera (se; mirror for sw). */
  front: GraphicsContext[];
  /** Same, facing away (ne; mirror for nw). */
  back: GraphicsContext[];
}

function widths(look: Look): { torso: number; hip: number } {
  return look.build === "broad"
    ? { torso: 6.5, hip: 6 }
    : look.build === "slim"
      ? { torso: 4.6, hip: 4.2 }
      : { torso: 5.5, hip: 5 };
}

function drawPerson(c: GraphicsContext, look: Look, front: boolean, frame: number): void {
  const { torso, hip } = widths(look);
  const swing = frame < 0 ? 0 : [2.2, 0, -2.2, 0][frame]!;
  const bob = frame < 0 ? 0 : frame % 2 === 0 ? 0 : -0.8;
  const skirt = look.outfit === "dress" || look.outfit === "blouse_wrapper";
  const long = look.outfit === "kaftan";
  const legColor = skirt ? look.skin : look.bottom;
  const shoe = 0x2a2420;

  c.ellipse(0, 0, 7, 3).fill({ color: 0x000000, alpha: 0.28 });
  // Legs (stride)
  c.roundRect(-3.2 + swing * 0.5, -12 + bob, 2.6, 12 - bob, 1).fill(legColor);
  c.roundRect(0.6 - swing * 0.5, -12 + bob, 2.6, 12 - bob, 1).fill(shade(legColor, 0.85));
  c.roundRect(-3.6 + swing * 0.7, -1.4, 3.4, 1.8, 0.8).fill(shoe);
  c.roundRect(0.3 - swing * 0.7, -1.4, 3.4, 1.8, 0.8).fill(shoe);

  const top = -26 + bob;
  // Lower garment
  if (skirt) {
    const sk = look.outfit === "dress" ? look.top : look.bottom;
    c.poly([-hip, -14 + bob, hip, -14 + bob, hip + 1.6, -4, -hip - 1.6, -4]).fill(sk);
  } else if (!long) {
    c.roundRect(-hip, -15 + bob, hip * 2, 5, 1.5).fill(look.bottom);
  }
  // Arms (swing opposite to legs), behind the torso
  const armColor = look.outfit === "tshirt" ? look.skin : look.top;
  c.roundRect(-torso - 2.2, top + 2 - swing * 0.4, 2.4, 11, 1.2).fill(shade(armColor, 0.85));
  c.roundRect(torso - 0.2, top + 2 + swing * 0.4, 2.4, 11, 1.2).fill(shade(armColor, 0.85));
  if (look.outfit === "tshirt") {
    c.roundRect(-torso - 2.2, top + 2 - swing * 0.4, 2.4, 4, 1.2).fill(look.top);
    c.roundRect(torso - 0.2, top + 2 + swing * 0.4, 2.4, 4, 1.2).fill(look.top);
  }
  // Torso
  const torsoBottom = long ? -5 : look.outfit === "dress" ? -13 : -13.5;
  c.roundRect(-torso, top, torso * 2, torsoBottom - top + bob, 2.5).fill(look.top);
  if (look.outfit === "suit") {
    if (front) c.poly([-1.5, top, 1.5, top, 0, top + 6]).fill(look.accent);
  } else if (look.outfit === "kaftan") {
    if (front) c.roundRect(-1.2, top + 1, 2.4, 7, 1).fill(look.accent);
  } else if (look.outfit === "shirt") {
    if (front) c.rect(-0.4, top + 1, 0.8, 11).fill(shade(look.top, 0.8));
  } else if (look.outfit === "blouse_wrapper") {
    c.rect(-torso, top + 8, torso * 2, 1.5).fill(look.accent);
  } else if (look.outfit === "tshirt" && front) {
    c.roundRect(-2.5, top + 3, 5, 3, 1).fill(look.accent);
  }
  // Head
  const hx = front ? 0.6 : -0.3;
  const hy = top - 5.2;
  c.roundRect(hx - 1.4, top - 2.4, 2.8, 3, 1).fill(shade(look.skin, 0.9)); // neck
  c.circle(hx, hy, 4.6).fill(look.skin);
  drawHair(c, look, hx, hy, front);
  if (front && look.headwear !== "gele") {
    c.circle(hx - 1.3, hy + 0.2, 0.75).fill(0x1a1110);
    c.circle(hx + 1.9, hy + 0.2, 0.75).fill(0x1a1110);
  } else if (front) {
    c.circle(hx - 1.3, hy + 0.6, 0.75).fill(0x1a1110);
    c.circle(hx + 1.9, hy + 0.6, 0.75).fill(0x1a1110);
  }
  drawHeadwear(c, look, hx, hy, front);
}

function drawHair(c: GraphicsContext, look: Look, hx: number, hy: number, front: boolean): void {
  const hc = look.hairColor;
  if (look.headwear === "gele" || look.headwear === "headscarf") return;
  switch (look.hair) {
    case "bald":
      if (!front) c.circle(hx, hy, 4.6).fill(shade(look.skin, 0.92));
      return;
    case "afro":
      c.circle(hx, hy - 2, 6.4).fill(hc);
      if (front) c.ellipse(hx + 0.3, hy + 1.2, 3.9, 3.2).fill(look.skin);
      return;
    case "braids":
      c.ellipse(hx, hy - 2.2, 4.9, 3.2).fill(hc);
      for (let i = -2; i <= 2; i++) c.rect(hx + i * 1.8 - 0.4, hy - 1, 0.9, front ? 6 : 9).fill(hc);
      if (!front) c.circle(hx, hy, 4.6).fill(hc);
      return;
    case "locs":
      c.ellipse(hx, hy - 2.2, 4.9, 3.2).fill(hc);
      for (let i = -2; i <= 2; i++)
        c.roundRect(hx + i * 2 - 0.7, hy - 2, 1.5, front ? 7 : 10, 0.7).fill(hc);
      if (!front) c.circle(hx, hy, 4.6).fill(hc);
      return;
    case "bun":
      c.ellipse(hx, hy - 2.4, 4.8, 3).fill(hc);
      c.circle(hx - 0.5, hy - 6, 2.4).fill(hc);
      if (!front) c.circle(hx, hy, 4.6).fill(hc);
      return;
    case "twists":
      c.ellipse(hx, hy - 2.4, 5, 3.2).fill(hc);
      for (let i = -2; i <= 2; i++) c.circle(hx + i * 2, hy - 4.6, 1.4).fill(hc);
      if (!front) c.circle(hx, hy, 4.6).fill(hc);
      return;
    case "low_cut":
    default:
      c.ellipse(hx, hy - 2.6, 4.7, 2.6).fill(hc);
      if (!front) c.circle(hx, hy - 0.4, 4.5).fill(shade(hc, 1.4));
  }
}

function drawHeadwear(
  c: GraphicsContext,
  look: Look,
  hx: number,
  hy: number,
  front: boolean,
): void {
  const a = look.accent;
  switch (look.headwear) {
    case "gele":
      // The fanned, pleated head tie for occasions (and some market mornings).
      c.poly([
        hx - 8,
        hy - 2,
        hx - 6,
        hy - 9,
        hx,
        hy - 12,
        hx + 6,
        hy - 9,
        hx + 8,
        hy - 2,
        hx,
        hy - 4,
      ]).fill(a);
      c.poly([hx - 5, hy - 4, hx, hy - 10, hx + 5, hy - 4]).fill(shade(a, 0.82));
      return;
    case "headscarf":
      c.ellipse(hx, hy - 2, 5.4, 4).fill(a);
      if (!front) c.circle(hx, hy, 4.8).fill(a);
      return;
    case "cap":
      c.ellipse(hx, hy - 2.8, 5, 3).fill(a);
      if (front) c.ellipse(hx + 3, hy - 1.6, 3.6, 1.3).fill(shade(a, 0.8));
      return;
    case "fila":
      c.poly([hx - 4.8, hy - 2, hx + 4.8, hy - 2, hx + 3.5, hy - 7.5, hx - 5.5, hy - 6]).fill(a);
      return;
    default:
  }
}

const cache = new Map<string, PersonFrames>();

function lookKey(l: Look): string {
  return [
    l.skin,
    l.hairColor,
    l.build,
    l.hair,
    l.headwear,
    l.outfit,
    l.top,
    l.bottom,
    l.accent,
  ].join("|");
}

export function personFrames(look: Look): PersonFrames {
  const k = lookKey(look);
  const hit = cache.get(k);
  if (hit) return hit;
  const make = (front: boolean): GraphicsContext[] =>
    [-1, 0, 1, 2, 3].map((f) => {
      const c = new GraphicsContext();
      drawPerson(c, look, front, f);
      return c;
    });
  const frames = { front: make(true), back: make(false) };
  cache.set(k, frames);
  return frames;
}

/** An open umbrella held over the head (drawn above the person in rain). */
export function umbrellaContext(color: number): GraphicsContext {
  const c = new GraphicsContext();
  c.rect(-0.5, -40, 1, 14).fill(0x222222);
  c.poly([-12, -38, -8, -44, 0, -47, 8, -44, 12, -38]).fill(color);
  c.poly([-12, -38, -6, -39.5, 0, -38, 6, -39.5, 12, -38]).fill(shade(color, 0.75));
  return c;
}
