import { Container, Graphics, Text } from "pixi.js";
import type { LocationType } from "@liag/engine";
import { PALETTE, mix, shade } from "./color";
import type { Look } from "./look";
import { hash } from "../util/random";

export type Expression = "neutral" | "happy" | "annoyed" | "surprised";

/**
 * The side-on, street-level scene shown during an encounter with the player: the place as a
 * backdrop and both people drawn large, facing each other, with simple expressions.
 */
export class EncounterScene {
  readonly root = new Container();
  private readonly backdrop = new Container();
  private readonly people = new Container();
  private left: Graphics | null = null;
  private right: Graphics | null = null;
  private looks: { left: Look; right: Look } | null = null;
  private w = 0;
  private h = 0;
  private figureScale = 1;

  constructor() {
    this.root.addChild(this.backdrop, this.people);
    this.root.visible = false;
  }

  show(opts: {
    w: number;
    h: number;
    placeType: LocationType | "street";
    placeName: string;
    sky: number;
    night: number;
    left: Look;
    right: Look;
    leftExpr: Expression;
    rightExpr: Expression;
  }): void {
    this.w = opts.w;
    this.h = opts.h;
    this.looks = { left: opts.left, right: opts.right };
    for (const c of this.backdrop.removeChildren()) c.destroy({ children: true });
    const g = new Graphics();
    this.backdrop.addChild(g);
    drawBackdrop(
      g,
      this.backdrop,
      opts.w,
      opts.h,
      opts.placeType,
      opts.placeName,
      opts.sky,
      opts.night,
    );
    this.backdrop.tint = mix(0xffffff, 0x6a76a8, opts.night * 0.6);
    this.setExpressions(opts.leftExpr, opts.rightExpr);
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  setExpressions(l: Expression, r: Expression): void {
    if (!this.looks) return;
    for (const c of this.people.removeChildren()) c.destroy();
    // Figures stand on the pavement line, about 40% of the screen height tall.
    const ground = this.h * 0.86;
    this.figureScale = Math.min(this.h * 0.0021, this.w * 0.0028);
    const gap = Math.min(this.w * 0.24, 260);
    this.left = bigPerson(this.looks.left, l);
    this.right = bigPerson(this.looks.right, r);
    this.left.position.set(this.w / 2 - gap, ground);
    this.right.position.set(this.w / 2 + gap, ground);
    this.left.scale.set(this.figureScale);
    this.right.scale.set(-this.figureScale, this.figureScale);
    this.people.addChild(this.left, this.right);
  }

  /** Screen point just above each head, for speech bubbles. */
  heads(): { left: { x: number; y: number }; right: { x: number; y: number } } {
    const top = (g: Graphics | null): { x: number; y: number } =>
      g ? { x: g.x, y: g.y - 215 * this.figureScale } : { x: 0, y: 0 };
    return { left: top(this.left), right: top(this.right) };
  }
}

// ---------------------------------------------------------------------------
// Backdrops
// ---------------------------------------------------------------------------

function drawBackdrop(
  g: Graphics,
  layer: Container,
  w: number,
  h: number,
  type: LocationType | "street",
  name: string,
  sky: number,
  night: number,
): void {
  // Sky
  for (let i = 0; i < 8; i++) {
    g.rect(0, (h * 0.6 * i) / 8, w, (h * 0.6) / 8 + 1).fill(mix(sky, shade(sky, 1.25), i / 8));
  }
  // Distant buildings
  let x = -20;
  let k = 0;
  while (x < w) {
    const bw = 60 + (hash(`bd${k}`) % 90);
    const bh = h * (0.18 + (hash(`bh${k}`) % 100) / 400);
    const col = shade(PALETTE.walls[hash(`bc${k}`) % PALETTE.walls.length]!, 0.75);
    g.rect(x, h * 0.62 - bh, bw, bh).fill(col);
    for (let wy = h * 0.62 - bh + 10; wy < h * 0.6 - 14; wy += 22) {
      for (let wx = x + 8; wx < x + bw - 12; wx += 18) {
        const lit = night > 0.3 && hash(`w${k}${wx}${wy}`) % 3 !== 0;
        g.rect(wx, wy, 8, 10).fill(lit ? 0xffd36b : shade(col, 0.6));
      }
    }
    if (hash(`bt${k}`) % 2 === 0) g.rect(x + bw - 26, h * 0.62 - bh - 16, 18, 16).fill(0x222222);
    x += bw + 6;
    k++;
  }
  // Pavement and road edge
  g.rect(0, h * 0.62, w, h * 0.38).fill(0xbfb6a6);
  g.rect(0, h * 0.62, w, 6).fill(0x8f877a);
  g.rect(0, h * 0.93, w, h * 0.07).fill(PALETTE.road);

  const mid = h * 0.62;
  switch (type) {
    case "buka": {
      g.rect(w * 0.08, mid - h * 0.3, w * 0.84, h * 0.3).fill(0xf7b267);
      g.rect(w * 0.08, mid - h * 0.34, w * 0.84, h * 0.06).fill(0xb0623f);
      g.rect(w * 0.3, mid - h * 0.26, w * 0.4, h * 0.08).fill(0xd62828);
      g.rect(w * 0.12, mid - h * 0.16, w * 0.2, h * 0.16).fill(0x3b3330);
      for (let i = 0; i < 3; i++) {
        const px = w * (0.68 + i * 0.09);
        g.ellipse(px, mid + 6, 22, 8).fill(0x3a2a1a);
        g.rect(px - 18, mid - 26, 36, 30).fill(0x222222);
        g.ellipse(px, mid - 26, 18, 6).fill(0x444444);
        g.ellipse(px, mid + 4, 14, 4).fill({ color: 0xff7b00, alpha: 0.8 });
      }
      g.rect(w * 0.2, mid + 10, w * 0.25, 10).fill(0x8b5a2b);
      sign(layer, name, w * 0.5, mid - h * 0.22, 0xffffff, Math.max(12, h * 0.03));
      break;
    }
    case "market": {
      const cols = [0xe63946, 0x2a9d8f, 0xf4a261, 0x457b9d];
      for (let i = 0; i < 4; i++) {
        const cx = w * (0.14 + i * 0.24);
        g.rect(cx - 3, mid - h * 0.22, 6, h * 0.22).fill(0x444444);
        g.poly([
          cx - w * 0.11,
          mid - h * 0.2,
          cx,
          mid - h * 0.3,
          cx + w * 0.11,
          mid - h * 0.2,
        ]).fill(cols[i]!);
        g.rect(cx - w * 0.08, mid - h * 0.06, w * 0.16, h * 0.06).fill(0x8d6748);
        for (let j = 0; j < 6; j++)
          g.circle(cx - w * 0.06 + j * w * 0.024, mid - h * 0.07, 7).fill(
            [0xd62828, 0xf77f00, 0x6a994e, 0xfcbf49][j % 4]!,
          );
      }
      break;
    }
    case "transport_hub": {
      const bx = w * 0.12;
      const by = mid - h * 0.26;
      const bw = w * 0.76;
      const bh = h * 0.24;
      g.roundRect(bx, by, bw, bh, 14).fill(PALETTE.danfo);
      g.rect(bx, by + bh * 0.55, bw, bh * 0.07).fill(0x111111);
      g.rect(bx, by + bh * 0.72, bw, bh * 0.05).fill(0x111111);
      for (let i = 0; i < 5; i++)
        g.roundRect(bx + 14 + i * (bw / 5.3), by + 10, bw / 6.2, bh * 0.35, 4).fill(0x2b3a4a);
      g.circle(bx + bw * 0.18, by + bh, bh * 0.2).fill(0x151515);
      g.circle(bx + bw * 0.82, by + bh, bh * 0.2).fill(0x151515);
      g.circle(bx + bw * 0.18, by + bh, bh * 0.08).fill(0x888888);
      g.circle(bx + bw * 0.82, by + bh, bh * 0.08).fill(0x888888);
      break;
    }
    case "music_venue": {
      g.rect(w * 0.05, mid - h * 0.32, w * 0.9, h * 0.32).fill(0x2b2440);
      g.rect(w * 0.05, mid - h * 0.06, w * 0.9, h * 0.06).fill(0x1b1b24);
      const lc = [0xff3d7f, 0x3a86ff, 0xffbe0b, 0x8338ec];
      for (let i = 0; i < 4; i++) {
        const lx = w * (0.2 + i * 0.2);
        g.circle(lx, mid - h * 0.29, 8).fill(lc[i]!);
        g.poly([lx, mid - h * 0.29, lx - 50, mid, lx + 50, mid]).fill({
          color: lc[i]!,
          alpha: 0.18 + night * 0.25,
        });
      }
      g.rect(w * 0.08, mid - h * 0.2, 40, h * 0.2).fill(0x111111);
      g.rect(w * 0.92 - 40, mid - h * 0.2, 40, h * 0.2).fill(0x111111);
      sign(layer, name, w * 0.5, mid - h * 0.26, 0xffffff, Math.max(12, h * 0.03));
      break;
    }
    case "school": {
      g.rect(w * 0.1, mid - h * 0.3, w * 0.8, h * 0.24).fill(0xf6e7cb);
      for (let i = 0; i < 8; i++)
        g.rect(w * (0.13 + i * 0.095), mid - h * 0.25, w * 0.05, h * 0.06).fill(0x34495e);
      g.rect(w * 0.3, mid - h * 0.2, 16, h * 0.2).fill(0xd9d2c0);
      g.rect(w * 0.7 - 16, mid - h * 0.2, 16, h * 0.2).fill(0xd9d2c0);
      g.rect(w * 0.28, mid - h * 0.26, w * 0.44, h * 0.06).fill(0x2a5d8f);
      sign(layer, name, w * 0.5, mid - h * 0.23, 0xffffff, Math.max(11, h * 0.026));
      break;
    }
    case "home": {
      g.rect(w * 0.15, mid - h * 0.32, w * 0.7, h * 0.22).fill(0xf6e7cb);
      g.rect(w * 0.12, mid - h * 0.36, w * 0.76, h * 0.05).fill(0x8d5a3b);
      for (let i = 0; i < 4; i++)
        g.rect(w * (0.2 + i * 0.17), mid - h * 0.27, w * 0.07, h * 0.08).fill(0x34495e);
      g.rect(0, mid - h * 0.12, w, h * 0.12).fill(0xd8cbb3);
      g.rect(w * 0.44, mid - h * 0.12, w * 0.12, h * 0.12).fill(0x264653);
      break;
    }
    case "workplace": {
      g.rect(w * 0.1, mid - h * 0.5, w * 0.8, h * 0.5).fill(0x5d7a91);
      for (let r = 0; r < 6; r++)
        for (let c = 0; c < 8; c++)
          g.rect(w * (0.12 + c * 0.098), mid - h * 0.48 + r * h * 0.075, w * 0.085, h * 0.06).fill(
            night > 0.3 && (r + c) % 3 ? 0xfff1c1 : 0x9fc3d8,
          );
      break;
    }
    default: {
      for (let i = 0; i < 3; i++) {
        const sx = w * (0.05 + i * 0.32);
        g.rect(sx, mid - h * 0.26, w * 0.28, h * 0.26).fill(
          PALETTE.walls[(i * 5) % PALETTE.walls.length]!,
        );
        g.rect(sx + 10, mid - h * 0.22, w * 0.28 - 20, h * 0.05).fill(PALETTE.signs[i]!);
        g.rect(sx + 14, mid - h * 0.14, w * 0.28 - 28, h * 0.14).fill(0x3b3330);
      }
    }
  }
}

function sign(
  layer: Container,
  text: string,
  x: number,
  y: number,
  color: number,
  size: number,
): void {
  const t = new Text({
    text,
    style: { fontFamily: "system-ui, sans-serif", fontSize: size, fontWeight: "700", fill: color },
    resolution: 2,
  });
  t.anchor.set(0.5);
  t.position.set(x, y);
  layer.addChild(t);
}

// ---------------------------------------------------------------------------
// People, large
// ---------------------------------------------------------------------------

/** A large figure facing right, feet at (0, 0), about 215 units tall. */
export function bigPerson(look: Look, expr: Expression): Graphics {
  const g = new Graphics();
  const broad = look.build === "broad" ? 1.18 : look.build === "slim" ? 0.9 : 1;
  const tw = 34 * broad;
  const skirt = look.outfit === "dress" || look.outfit === "blouse_wrapper";
  const long = look.outfit === "kaftan";
  const shoe = 0x2a2420;
  g.ellipse(0, 0, 46 * broad, 9).fill({ color: 0x000000, alpha: 0.25 });
  // Legs
  const leg = skirt ? look.skin : look.bottom;
  g.roundRect(-tw * 0.55, -80, tw * 0.45, 78, 8).fill(shade(leg, 0.9));
  g.roundRect(tw * 0.1, -80, tw * 0.45, 78, 8).fill(leg);
  g.roundRect(-tw * 0.62, -8, tw * 0.6, 10, 5).fill(shoe);
  g.roundRect(tw * 0.08, -8, tw * 0.62, 10, 5).fill(shoe);
  // Lower garment
  if (skirt) {
    const sk = look.outfit === "dress" ? look.top : look.bottom;
    g.poly([-tw * 0.95, -95, tw * 0.95, -95, tw * 1.15, -30, -tw * 1.15, -30]).fill(sk);
    g.rect(-tw * 1.1, -40, tw * 2.2, 5).fill(shade(sk, 0.8));
  } else if (!long) {
    g.roundRect(-tw * 0.95, -98, tw * 1.9, 26, 8).fill(look.bottom);
  }
  // Arms behind the body
  const sleeve = look.outfit === "tshirt" ? look.top : look.top;
  g.roundRect(-tw - 14, -160, 16, 70, 8).fill(shade(sleeve, 0.85));
  g.roundRect(tw - 2, -160, 16, 70, 8).fill(shade(sleeve, 0.85));
  if (look.outfit === "tshirt") {
    g.roundRect(-tw - 13, -128, 14, 40, 7).fill(look.skin);
    g.roundRect(tw - 1, -128, 14, 40, 7).fill(look.skin);
  }
  g.circle(-tw - 6, -88, 8).fill(look.skin);
  g.circle(tw + 6, -88, 8).fill(look.skin);
  // Torso
  const bottom = long ? -30 : look.outfit === "dress" ? -92 : -95;
  g.roundRect(-tw, -168, tw * 2, 168 + bottom, 14).fill(look.top);
  switch (look.outfit) {
    case "suit":
      g.poly([-8, -168, 8, -168, 0, -128]).fill(look.accent);
      g.poly([-tw * 0.6, -168, -6, -168, -2, -120]).fill(shade(look.top, 0.8));
      g.poly([tw * 0.6, -168, 6, -168, 2, -120]).fill(shade(look.top, 0.8));
      break;
    case "kaftan":
      g.roundRect(-7, -166, 14, 50, 4).fill(look.accent);
      for (let i = 0; i < 4; i++) g.circle(0, -158 + i * 12, 2.5).fill(shade(look.accent, 0.7));
      break;
    case "shirt":
      g.rect(-2, -166, 4, 70).fill(shade(look.top, 0.8));
      g.poly([-14, -168, 0, -156, 14, -168]).fill(shade(look.top, 1.15));
      break;
    case "blouse_wrapper":
      g.rect(-tw, -120, tw * 2, 8).fill(look.accent);
      break;
    case "tshirt":
      g.roundRect(-14, -150, 28, 18, 5).fill(look.accent);
      break;
    default:
  }
  // Neck and head
  g.roundRect(-9, -184, 18, 20, 6).fill(shade(look.skin, 0.9));
  const hy = -205;
  g.ellipse(5, hy, 23, 27).fill(look.skin);
  g.ellipse(-16, hy + 2, 5, 7).fill(shade(look.skin, 0.9));
  bigHair(g, look, hy);
  bigFace(g, look, hy, expr);
  bigHeadwear(g, look, hy);
  return g;
}

function bigHair(g: Graphics, look: Look, hy: number): void {
  const hc = look.hairColor;
  if (look.headwear === "gele" || look.headwear === "headscarf") return;
  switch (look.hair) {
    case "bald":
      g.ellipse(0, hy - 18, 10, 4).fill({ color: 0xffffff, alpha: 0.18 });
      return;
    case "afro":
      g.circle(0, hy - 12, 34).fill(hc);
      g.ellipse(9, hy + 6, 19, 18).fill(look.skin);
      return;
    case "braids":
      g.ellipse(2, hy - 14, 26, 17).fill(hc);
      for (let i = 0; i < 6; i++) g.roundRect(-22 + i * 3, hy - 8, 4, 48, 2).fill(hc);
      return;
    case "locs":
      g.ellipse(2, hy - 14, 26, 17).fill(hc);
      for (let i = 0; i < 5; i++) g.roundRect(-24 + i * 5, hy - 10, 7, 44, 3).fill(hc);
      return;
    case "bun":
      g.ellipse(2, hy - 14, 25, 16).fill(hc);
      g.circle(-14, hy - 28, 12).fill(hc);
      return;
    case "twists":
      g.ellipse(2, hy - 14, 26, 17).fill(hc);
      for (let i = 0; i < 6; i++) g.circle(-18 + i * 8, hy - 28, 6).fill(hc);
      return;
    default:
      g.ellipse(3, hy - 16, 24, 13).fill(hc);
  }
}

function bigHeadwear(g: Graphics, look: Look, hy: number): void {
  const a = look.accent;
  switch (look.headwear) {
    case "gele":
      g.poly([-38, hy - 6, -30, hy - 40, 0, hy - 56, 32, hy - 42, 42, hy - 8, 4, hy - 20]).fill(a);
      g.poly([-22, hy - 18, -4, hy - 48, 22, hy - 20]).fill(shade(a, 0.8));
      g.poly([-10, hy - 22, 6, hy - 44, 16, hy - 22]).fill(shade(a, 1.15));
      return;
    case "headscarf":
      g.ellipse(2, hy - 10, 27, 22).fill(a);
      g.ellipse(-20, hy + 10, 8, 10).fill(shade(a, 0.85));
      return;
    case "cap":
      g.ellipse(2, hy - 18, 25, 14).fill(a);
      g.ellipse(26, hy - 12, 16, 5).fill(shade(a, 0.8));
      return;
    case "fila":
      g.poly([-24, hy - 10, 26, hy - 10, 18, hy - 40, -28, hy - 30]).fill(a);
      g.rect(-24, hy - 13, 50, 4).fill(shade(a, 0.8));
      return;
    default:
  }
}

function bigFace(g: Graphics, look: Look, hy: number, expr: Expression): void {
  const eye = 0x1a1110;
  const ex = [4, 20];
  const ey = hy - 2;
  const brow = shade(look.hairColor, 1.2);
  for (const x of ex) {
    if (expr === "happy") {
      g.moveTo(x - 4, ey + 1)
        .quadraticCurveTo(x, ey - 4, x + 4, ey + 1)
        .stroke({ width: 2.5, color: eye });
    } else {
      const r = expr === "surprised" ? 5 : 4;
      g.ellipse(x, ey, r, r + 1).fill(0xffffff);
      g.circle(x + 1.5, ey + 0.5, expr === "surprised" ? 2.2 : 2.6).fill(eye);
    }
  }
  // Brows
  const by = ey - (expr === "surprised" ? 12 : 9);
  for (const x of ex) {
    // Annoyed: the inner ends (towards the nose) pull down.
    const innerRight = x === ex[0];
    const tilt = expr === "annoyed" ? 3.5 : 0;
    g.moveTo(x - 5, by + (innerRight ? -tilt : tilt))
      .lineTo(x + 5, by + (innerRight ? tilt : -tilt))
      .stroke({ width: 2.5, color: brow });
  }
  // Nose
  g.moveTo(14, hy + 3)
    .lineTo(17, hy + 9)
    .lineTo(13, hy + 10)
    .stroke({ width: 1.5, color: shade(look.skin, 0.7) });
  // Mouth
  const my = hy + 15;
  const lip = shade(look.skin, 0.55);
  switch (expr) {
    case "happy":
      g.moveTo(4, my - 1)
        .quadraticCurveTo(13, my + 9, 22, my - 1)
        .closePath()
        .fill(0x5a1f1a);
      g.moveTo(4, my - 1)
        .quadraticCurveTo(13, my + 9, 22, my - 1)
        .stroke({ width: 1.5, color: lip });
      break;
    case "annoyed":
      g.moveTo(6, my + 4)
        .quadraticCurveTo(13, my - 3, 20, my + 4)
        .stroke({ width: 2.5, color: lip });
      break;
    case "surprised":
      g.ellipse(13, my + 2, 4.5, 6).fill(0x5a1f1a);
      break;
    default:
      g.moveTo(7, my + 1)
        .lineTo(19, my + 1)
        .stroke({ width: 2.5, color: lip });
  }
}
