import { Container, Graphics } from "pixi.js";
import { PALETTE, mix, shade } from "./color";
import type { Box, CityModel, PlaceView } from "./city-model";
import { FLOOR_PX, boxHeight } from "./city-model";
import { TH, TW, diagonalZ, iso } from "./iso";
import { box, diamond, faceX, faceY, groundShadow } from "./art/shapes";
import { vehicleContext } from "./art/vehicles";
import { hash, hash01 } from "../util/random";

/**
 * The static city, drawn once. The ground is a single Graphics in its own render group (its
 * geometry never changes). Buildings are cut into tile columns and every column on one diagonal
 * shares a Graphics, which gives exact back-to-front order with people and cars slotted in
 * between: about 80 objects for the whole district, so draw calls stay low.
 *
 * Night lighting never redraws anything: lit windows and lamp heads sit in separate per-diagonal
 * layers whose alpha follows the clock, and the rest of the scene is tinted darker.
 */
export class CityView {
  readonly root = new Container({ sortableChildren: true });
  /** Additive glows (streetlight pools, stage lights), above everything in the city. */
  readonly glows = new Container();
  private readonly ground = new Graphics();
  private readonly layers = new Map<number, Graphics>();
  private readonly lights = new Map<number, Graphics>();
  private readonly stageLights: { g: Graphics; phase: number }[] = [];
  private readonly lampGlow = new Graphics();
  /** Things that take the ambient tint (everything except light sources). */
  private readonly tinted: (Container | Graphics)[] = [];

  constructor(private readonly city: CityModel) {
    this.ground.zIndex = -1_000_000;
    const groundGroup = new Container({ isRenderGroup: true });
    groundGroup.zIndex = -1_000_000;
    groundGroup.addChild(this.ground);
    this.root.addChild(groundGroup);
    this.tinted.push(groundGroup);
    this.glows.blendMode = "add";
    this.glows.zIndex = 1_000_000;
    this.glows.addChild(this.lampGlow);
    this.root.addChild(this.glows);

    this.drawGround();
    for (const b of city.boxes) this.drawBox(b);
    for (const p of city.places) this.drawPlace(p);
    for (const t of city.streetLights) this.drawStreetLight(t[0], t[1]);
    for (const t of city.trees) this.drawTree(t[0], t[1]);
  }

  private layer(d: number): Graphics {
    let g = this.layers.get(d);
    if (!g) {
      g = new Graphics();
      g.zIndex = diagonalZ(d);
      this.layers.set(d, g);
      this.root.addChild(g);
      this.tinted.push(g);
    }
    return g;
  }

  private lightLayer(d: number): Graphics {
    let g = this.lights.get(d);
    if (!g) {
      g = new Graphics();
      g.zIndex = diagonalZ(d) + 1;
      g.alpha = 0;
      this.lights.set(d, g);
      this.root.addChild(g);
    }
    return g;
  }

  /** Register a moving thing (person, vehicle) so it takes the ambient tint. */
  addEntity(c: Container): void {
    this.root.addChild(c);
    this.tinted.push(c);
  }

  removeEntity(c: Container): void {
    this.root.removeChild(c);
    const i = this.tinted.indexOf(c);
    if (i >= 0) this.tinted.splice(i, 1);
  }

  /** Daylight tint for the scene and how strongly lights glow (0 day .. 1 deep night). */
  setLighting(tint: number, night: number, timeMs: number): void {
    for (const t of this.tinted) t.tint = tint;
    for (const g of this.lights.values()) g.alpha = night;
    this.glows.alpha = night;
    for (const s of this.stageLights) {
      s.g.alpha = 0.55 + 0.45 * Math.sin(timeMs / 380 + s.phase);
      s.g.rotation = Math.sin(timeMs / 1400 + s.phase) * 0.25;
    }
  }

  // ---------------------------------------------------------------------------
  // Ground
  // ---------------------------------------------------------------------------

  private code(x: number, y: number): string {
    return this.city.tiles[y]?.[x] ?? "#";
  }

  private drawGround(): void {
    const g = this.ground;
    const { width, height } = this.city;
    const yardColor = new Map<string, number>();
    for (const p of this.city.places) {
      const col =
        p.type === "transport_hub"
          ? 0x8f8a80
          : p.type === "market"
            ? 0xc9ad7f
            : p.type === "home"
              ? 0xbdb7aa
              : p.type === "buka"
                ? 0xc79f74
                : p.type === "music_venue"
                  ? 0x5e566e
                  : 0xcfc6b0;
      for (let y = p.rect.y; y < p.rect.y + p.rect.h; y++)
        for (let x = p.rect.x; x < p.rect.x + p.rect.w; x++) yardColor.set(`${x},${y}`, col);
    }
    // Earth beyond the edge so the map doesn't float in the sky.
    diamond(g, -6, -6, width + 12, height + 12, 0, 0x6f6352);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = this.code(x, y);
        const v = (hash(`g${x},${y}`) % 7) / 100 - 0.03;
        switch (c) {
          case "R":
            diamond(g, x, y, 1, 1, 0, shade(PALETTE.road, 1 + v));
            this.roadMarks(x, y);
            break;
          case "z":
            diamond(g, x, y, 1, 1, 0, PALETTE.road);
            this.zebra(x, y);
            break;
          case "s": {
            diamond(g, x, y, 1, 1, 0, shade(PALETTE.sidewalk, 1 + v));
            // Kerb on the road side
            if (this.code(x + 1, y) === "R") faceX(g, x + 1, y, y + 1, -1, 3, PALETTE.kerb);
            if (this.code(x, y + 1) === "R") faceY(g, y + 1, x, x + 1, -1, 3, PALETTE.kerb);
            // Open gutter along the other side of some sidewalks
            if (this.code(x - 1, y) === "#" || this.code(x, y - 1) === "#") {
              const left = this.code(x - 1, y) === "#";
              const a = left ? iso(x + 0.08, y) : iso(x, y + 0.08);
              const b = left ? iso(x + 0.08, y + 1) : iso(x + 1, y + 0.08);
              g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: 0x5a564e, alpha: 0.6 });
            }
            break;
          }
          case "p":
            diamond(g, x, y, 1, 1, 0, shade(yardColor.get(`${x},${y}`) ?? PALETTE.yard, 1 + v));
            break;
          case "g":
            diamond(g, x, y, 1, 1, 0, shade(PALETTE.grass, 1 + v * 2));
            for (let i = 0; i < 3; i++) {
              const p = iso(x + hash01(`gr${x},${y},${i}`), y + hash01(`gs${x},${y},${i}`));
              g.circle(p.x, p.y, 1.6).fill(shade(PALETTE.grass, 0.78));
            }
            break;
          case "~":
            diamond(g, x, y, 1, 1, -4, PALETTE.water);
            faceY(g, y, x, x + 1, -4, 0, 0x6d6a60);
            {
              const p = iso(x + 0.5, y + 0.5);
              g.moveTo(p.x - 10, p.y - 4)
                .lineTo(p.x + 6, p.y - 4)
                .stroke({ width: 1, color: 0x9cc3cf, alpha: 0.7 });
            }
            break;
          default:
            diamond(g, x, y, 1, 1, 0, shade(PALETTE.lot, 1 + v));
        }
      }
    }
  }

  private isRoad(x: number, y: number): boolean {
    const c = this.code(x, y);
    return c === "R" || c === "z";
  }

  private roadMarks(x: number, y: number): void {
    const g = this.ground;
    const alongY =
      this.isRoad(x, y - 1) &&
      this.isRoad(x, y + 1) &&
      !(
        this.isRoad(x - 1, y) &&
        this.isRoad(x + 1, y) &&
        this.code(x + 1, y) !== "z" &&
        this.code(x - 1, y) !== "z"
      );
    const alongX = this.isRoad(x - 1, y) && this.isRoad(x + 1, y) && !alongY;
    if (alongY) {
      // Two-lane road: line on the shared edge; one-lane: dashes down the middle.
      const edge =
        this.code(x + 1, y) === "R" && this.code(x - 1, y) !== "R"
          ? x + 1
          : this.code(x - 1, y) === "R" && this.code(x + 1, y) !== "R"
            ? -1
            : x + 0.5;
      if (edge < 0) return;
      const a = iso(edge, y + 0.2);
      const b = iso(edge, y + 0.7);
      g.moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: 1.6, color: PALETTE.roadLine, alpha: 0.7 });
    } else if (alongX) {
      const edge =
        this.code(x, y + 1) === "R" && this.code(x, y - 1) !== "R"
          ? y + 1
          : this.code(x, y - 1) === "R" && this.code(x, y + 1) !== "R"
            ? -1
            : y + 0.5;
      if (edge < 0) return;
      const a = iso(x + 0.2, edge);
      const b = iso(x + 0.7, edge);
      g.moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: 1.6, color: PALETTE.roadLine, alpha: 0.7 });
    }
  }

  private zebra(x: number, y: number): void {
    const g = this.ground;
    // People cross along whichever axis has sidewalk on both sides.
    const walkX = !this.isRoad(x - 1, y) || !this.isRoad(x + 1, y);
    for (let i = 0; i < 4; i++) {
      const t = 0.12 + i * 0.22;
      if (walkX) diamond(g, x + t, y + 0.1, 0.11, 0.8, 0, 0xeeeeee, 0.85);
      else diamond(g, x + 0.1, y + t, 0.8, 0.11, 0, 0xeeeeee, 0.85);
    }
  }

  // ---------------------------------------------------------------------------
  // Buildings, column by column
  // ---------------------------------------------------------------------------

  private drawBox(b: Box): void {
    const H = boxHeight(b);
    const s = b.style;
    const wallL = s.wall;
    const wallR = shade(s.wall, 0.78);
    const glass = 0x34495e;
    const lit = [0xffe08a, 0xffd36b, 0xfff1c1];
    const ground0 = 4;
    for (let ty = b.y; ty < b.y + b.h; ty++) {
      for (let tx = b.x; tx < b.x + b.w; tx++) {
        const d = tx + ty;
        const g = this.layer(d);
        const L = this.lightLayer(d);
        const frontY = ty === b.y + b.h - 1;
        const frontX = tx === b.x + b.w - 1;
        // Walls (only the outside faces you can see)
        if (frontY) faceY(g, ty + 1, tx, tx + 1, 0, H, wallL);
        if (frontX) faceX(g, tx + 1, ty, ty + 1, 0, H, wallR);
        // Base band (dirt splash)
        if (frontY) faceY(g, ty + 1, tx, tx + 1, 0, 4, shade(wallL, 0.7));
        if (frontX) faceX(g, tx + 1, ty, ty + 1, 0, 4, shade(wallR, 0.7));
        // Windows per floor
        for (let f = 0; f < s.floors; f++) {
          const z0 = ground0 + f * FLOOR_PX + 7;
          const z1 = z0 + 9;
          const shopFloor = f === 0 && s.sign !== null;
          const k = `${s.seed}:${tx},${ty},${f}`;
          const on = hash01(k) < 0.62;
          const color = lit[hash(k) % lit.length]!;
          if (frontY) {
            if (shopFloor) {
              faceY(g, ty + 1, tx + 0.12, tx + 0.88, 4, 15, 0x3b3330);
              faceY(L, ty + 1, tx + 0.12, tx + 0.88, 4, 15, 0xffc861, 0.9);
            } else {
              faceY(g, ty + 1, tx + 0.3, tx + 0.7, z0, z1, glass);
              faceY(g, ty + 1, tx + 0.3, tx + 0.7, z0 - 1, z0, shade(wallL, 0.6));
              if (on) faceY(L, ty + 1, tx + 0.3, tx + 0.7, z0, z1, color);
            }
          }
          if (frontX) {
            if (shopFloor) {
              faceX(g, tx + 1, ty + 0.12, ty + 0.88, 4, 15, 0x2e2826);
              faceX(L, tx + 1, ty + 0.12, ty + 0.88, 4, 15, 0xffc861, 0.9);
            } else {
              faceX(g, tx + 1, ty + 0.3, ty + 0.7, z0, z1, shade(glass, 0.85));
              faceX(g, tx + 1, ty + 0.3, ty + 0.7, z0 - 1, z0, shade(wallR, 0.6));
              if (on) faceX(L, tx + 1, ty + 0.3, ty + 0.7, z0, z1, shade(color, 0.9));
            }
          }
        }
        // Signboard over the shop front
        if (s.sign !== null && f0Sign(b, tx, ty)) {
          const sc = s.sign;
          if (frontY) {
            faceY(g, ty + 1, tx + 0.05, tx + 0.95, 16, 22, sc);
            for (let i = 0; i < 3; i++)
              faceY(g, ty + 1, tx + 0.18 + i * 0.24, tx + 0.32 + i * 0.24, 18, 20, 0xffffff, 0.85);
          }
          if (frontX) {
            faceX(g, tx + 1, ty + 0.05, ty + 0.95, 16, 22, shade(sc, 0.85));
            for (let i = 0; i < 3; i++)
              faceX(g, tx + 1, ty + 0.18 + i * 0.24, ty + 0.32 + i * 0.24, 18, 20, 0xf0f0f0, 0.85);
          }
        }
        // Roof
        if (s.zinc) {
          diamond(g, tx, ty, 1, 1, H, s.roof);
          for (let i = 1; i < 4; i++) {
            const a = iso(tx + i / 4, ty);
            const c = iso(tx + i / 4, ty + 1);
            g.moveTo(a.x, a.y - H)
              .lineTo(c.x, c.y - H)
              .stroke({ width: 1, color: shade(s.roof, 0.75) });
          }
        } else {
          diamond(g, tx, ty, 1, 1, H, shade(s.wall, 0.9));
          if (frontY) faceY(g, ty + 1, tx, tx + 1, H, H + 3, shade(wallL, 1.05));
          if (frontX) faceX(g, tx + 1, ty, ty + 1, H, H + 3, shade(wallR, 1.05));
        }
        // Water tank on the back corner of the roof
        if (s.tank && tx === b.x && ty === b.y) {
          const p = iso(tx + 0.45, ty + 0.45);
          const top = p.y - H - 16;
          const col = (s.seed & 1) === 0 ? 0x1f1f1f : 0x2b5f9e;
          g.rect(p.x - 7, top, 14, 14).fill(col);
          g.ellipse(p.x, top + 14, 7, 3).fill(col);
          g.ellipse(p.x, top, 7, 3).fill(shade(col, 1.6));
          g.rect(p.x + 4, top + 2, 1.4, 11).fill({ color: 0xffffff, alpha: 0.15 });
        }
        // AC unit on some side walls
        if (frontX && s.floors >= 2 && hash01(`ac${s.seed}${tx}${ty}`) < 0.25) {
          faceX(g, tx + 1, ty + 0.15, ty + 0.4, FLOOR_PX + 4, FLOOR_PX + 10, 0xe8e8e8);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Places: what makes each one recognisable
  // ---------------------------------------------------------------------------

  private drawPlace(p: PlaceView): void {
    switch (p.type) {
      case "market":
        return this.drawMarket(p);
      case "transport_hub":
        return this.drawPark(p);
      case "buka":
        return this.drawBuka(p);
      case "music_venue":
        return this.drawStage(p);
      case "school":
        return this.drawCampus(p);
      case "home":
        return this.drawCompound(p);
      default:
    }
  }

  private drawMarket(p: PlaceView): void {
    const umbrellas = [0xe63946, 0x2a9d8f, 0xf4a261, 0x457b9d, 0xffb703, 0x8338ec];
    const goods = [0xd62828, 0xf77f00, 0x6a994e, 0xfcbf49, 0x9b2226, 0xe9d8a6];
    for (const [x, y] of p.spots) {
      // Stalls in a grid, leaving lanes to walk through.
      if ((x - p.rect.x) % 2 === 1 || (y - p.rect.y) % 3 === 2) continue;
      if (x === p.door[0] && y === p.door[1]) continue;
      const g = this.layer(x + y);
      const k = hash(`stall${x},${y}`);
      groundShadow(g, x + 0.5, y + 0.5, 22, 0.18);
      box(g, x + 0.2, y + 0.25, 0.6, 0.5, 0, 9, 0x8d6748);
      for (let i = 0; i < 5; i++) {
        const q = iso(x + 0.3 + (i % 3) * 0.18, y + 0.35 + Math.floor(i / 3) * 0.2);
        g.circle(q.x, q.y - 11, 3).fill(goods[(k + i) % goods.length]!);
      }
      // Pole and umbrella
      const c = iso(x + 0.5, y + 0.5);
      g.rect(c.x - 0.8, c.y - 34, 1.6, 26).fill(0x444444);
      const col = umbrellas[k % umbrellas.length]!;
      const top = c.y - 40;
      g.poly([c.x - 24, top + 6, c.x, top - 6, c.x + 24, top + 6, c.x, top + 14]).fill(col);
      g.poly([c.x - 24, top + 6, c.x, top - 6, c.x, top + 14]).fill(shade(col, 0.82));
      g.poly([c.x - 12, top, c.x, top - 6, c.x + 12, top, c.x, top + 4]).fill({
        color: 0xffffff,
        alpha: 0.25,
      });
    }
  }

  private drawPark(p: PlaceView): void {
    // A long shelter along the back edge.
    const sy = p.rect.y;
    for (let x = p.rect.x + 1; x < p.rect.x + p.rect.w - 1; x++) {
      const g = this.layer(x + sy);
      const a = iso(x + 0.15, sy + 0.8);
      g.rect(a.x - 1, a.y - 30, 2, 30).fill(0x555555);
      diamond(g, x, sy, 1, 1, 30, 0x9aa5ab);
      faceY(g, sy + 1, x, x + 1, 27, 30, 0x6f7a80);
    }
    // Parked danfos in rows, nose to the lane.
    const ctxs = [
      vehicleContext("danfo", "sw", PALETTE.danfo),
      vehicleContext("danfo", "ne", PALETTE.danfo),
    ];
    let n = 0;
    for (let y = p.rect.y + 2; y < p.rect.y + p.rect.h - 1; y += 2) {
      for (let x = p.rect.x + 1; x < p.rect.x + p.rect.w - 1; x += 2) {
        if (Math.abs(x - p.door[0]) + Math.abs(y - p.door[1]) < 2) continue;
        if (hash01(`bus${x},${y}`) < 0.2) continue;
        const g = new Graphics(ctxs[n++ % 2]!);
        const c = iso(x + 0.5, y + 0.5);
        g.position.set(c.x, c.y);
        g.zIndex = diagonalZ(x + y) + 4;
        this.addEntity(g);
      }
    }
    // Ticket post / sign at the gate.
    const [dx, dy] = p.door;
    const g = this.layer(dx + dy);
    const c = iso(dx + 0.5, dy + 0.5);
    g.rect(c.x + 14, c.y - 44, 2, 40).fill(0x333333);
    g.rect(c.x + 4, c.y - 52, 24, 12).fill(0x1d3557);
    g.rect(c.x + 7, c.y - 48, 18, 2).fill(0xffffff);
  }

  private drawBuka(p: PlaceView): void {
    // Benches and a canopy over the forecourt, cooking pots by the wall.
    for (const [x, y] of p.spots) {
      const g = this.layer(x + y);
      const k = hash(`buka${x},${y}`);
      if (k % 3 === 0) {
        // Pot on a firewood stove
        const c = iso(x + 0.5, y + 0.4);
        g.ellipse(c.x, c.y, 9, 4).fill(0x3a2a1a);
        this.lightLayer(x + y)
          .ellipse(c.x, c.y - 1, 7, 3)
          .fill({ color: 0xff7b00, alpha: 0.9 });
        g.rect(c.x - 7, c.y - 12, 14, 9).fill(0x222222);
        g.ellipse(c.x, c.y - 12, 7, 3).fill(0x444444);
      } else {
        box(g, x + 0.15, y + 0.35, 0.7, 0.25, 0, 7, 0x8b5a2b);
        box(g, x + 0.15, y + 0.75, 0.7, 0.12, 0, 4, 0x6f4520);
      }
    }
    const cx = p.rect.x;
    const cy = p.building ? p.building.y + p.building.h : p.rect.y;
    for (let x = cx; x < p.rect.x + p.rect.w; x++) {
      const g = this.layer(x + cy);
      diamond(g, x, cy, 1, 1, 26, 0x2a9d8f, 0.92);
      faceY(g, cy + 1, x, x + 1, 22, 26, 0x1f776d);
    }
  }

  private drawStage(p: PlaceView): void {
    const sx = p.rect.x + 1;
    const sy = p.building ? p.building.y + p.building.h : p.rect.y;
    const w = Math.max(2, p.rect.w - 2);
    // Raised stage with speakers and a light truss.
    for (let x = sx; x < sx + w; x++) {
      const g = this.layer(x + sy);
      box(g, x, sy, 1, 1, 0, 8, 0x2b2b35);
    }
    const g0 = this.layer(sx + sy);
    box(g0, sx, sy, 0.35, 0.35, 8, 26, 0x111111);
    const g1 = this.layer(sx + w - 1 + sy);
    box(g1, sx + w - 0.35, sy, 0.35, 0.35, 8, 26, 0x111111);
    const a = iso(sx, sy + 0.5);
    const b = iso(sx + w, sy + 0.5);
    const gl = this.layer(sx + w - 1 + sy);
    gl.moveTo(a.x, a.y - 48)
      .lineTo(b.x, b.y - 48)
      .stroke({ width: 3, color: 0x777777 });
    gl.rect(a.x - 1.5, a.y - 48, 3, 40).fill(0x777777);
    gl.rect(b.x - 1.5, b.y - 48, 3, 40).fill(0x777777);
    // Coloured stage lights (glow at night, swinging).
    const colors = [0xff3d7f, 0x3a86ff, 0xffbe0b, 0x8338ec];
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - 46 };
      const beam = new Graphics();
      beam.poly([0, 0, -18, 52, 18, 52]).fill({ color: colors[i]!, alpha: 0.35 });
      beam.circle(0, 0, 4).fill({ color: colors[i]!, alpha: 0.9 });
      beam.position.set(q.x, q.y);
      this.glows.addChild(beam);
      this.stageLights.push({ g: beam, phase: i * 1.7 });
      this.lightLayer(sx + w - 1 + sy)
        .circle(q.x, q.y, 3)
        .fill(colors[i]!);
    }
  }

  private drawCampus(p: PlaceView): void {
    // A low fence round the yard, with gate pillars and an arched sign at the gate.
    const r = p.rect;
    const yEdge = r.y + r.h; // the street side
    for (let x = r.x; x < r.x + r.w; x++) {
      if (Math.abs(x - p.door[0]) <= 0) continue;
      const g = this.layer(x + yEdge - 1);
      faceY(g, yEdge - 0.05, x, x + 1, 0, 10, 0xe9e2d0);
      faceY(g, yEdge - 0.05, x, x + 1, 10, 12, 0x2a5d8f);
    }
    const [dx, dy] = p.door;
    const g = this.layer(dx + dy + 1);
    const left = iso(dx, dy + 1);
    const right = iso(dx + 1, dy + 1);
    for (const q of [left, right]) {
      g.rect(q.x - 3, q.y - 34, 6, 34).fill(0xd9d2c0);
      g.rect(q.x - 3.5, q.y - 37, 7, 3).fill(0x2a5d8f);
    }
    g.poly([
      left.x - 4,
      left.y - 40,
      right.x + 4,
      right.y - 40,
      right.x + 4,
      right.y - 50,
      left.x - 4,
      left.y - 50,
    ]).fill(0x2a5d8f);
    g.poly([
      left.x,
      left.y - 43,
      right.x,
      right.y - 43,
      right.x,
      right.y - 47,
      left.x,
      left.y - 47,
    ]).fill({ color: 0xffffff, alpha: 0.8 });
    // Flagpole
    const f = iso(r.x + 0.5, r.y + r.h - 1.5);
    const gf = this.layer(r.x + r.y + r.h - 2);
    gf.rect(f.x - 1, f.y - 64, 2, 64).fill(0x999999);
    gf.rect(f.x + 1, f.y - 64, 8, 12).fill(0x008751);
    gf.rect(f.x + 9, f.y - 64, 8, 12).fill(0xffffff);
    gf.rect(f.x + 17, f.y - 64, 8, 12).fill(0x008751);
  }

  private drawCompound(p: PlaceView): void {
    // Walled yard with a gate, a clothesline and plastic chairs.
    const r = p.rect;
    const wall = mix(0xd8cbb3, PALETTE.walls[hash(p.locationId) % PALETTE.walls.length]!, 0.3);
    const yard = p.spots;
    const inYard = new Set(yard.map((t) => `${t[0]},${t[1]}`));
    for (const [x, y] of yard) {
      const g = this.layer(x + y);
      // +y side wall where the yard meets the outside
      if (
        !inYard.has(`${x},${y + 1}`) &&
        !(x === p.door[0] && y === p.door[1]) &&
        !(p.building && y + 1 === p.building.y)
      ) {
        faceY(g, y + 1, x, x + 1, 0, 11, wall);
        diamond(g, x, y + 0.92, 1, 0.08, 11, shade(wall, 1.1));
      }
      if (
        !inYard.has(`${x + 1},${y}`) &&
        !(x + 1 === r.x + r.w && p.building && y >= p.building.y && y < p.building.y + p.building.h)
      ) {
        faceX(g, x + 1, y, y + 1, 0, 11, shade(wall, 0.8));
        diamond(g, x + 0.92, y, 0.08, 1, 11, shade(wall, 1.1));
      }
    }
    // Gate
    const [dx, dy] = p.door;
    const gg = this.layer(dx + dy);
    faceY(gg, dy + 1, dx + 0.1, dx + 0.9, 0, 14, 0x264653);
    // Clothesline across the yard
    if (yard.length >= 4) {
      const a = yard[yard.length - 1]!;
      const b = yard[Math.max(0, yard.length - 4)]!;
      const pa = iso(a[0] + 0.5, a[1] + 0.5);
      const pb = iso(b[0] + 0.5, b[1] + 0.5);
      const gl = this.layer(Math.max(a[0] + a[1], b[0] + b[1]));
      gl.moveTo(pa.x, pa.y - 22)
        .lineTo(pb.x, pb.y - 22)
        .stroke({ width: 1, color: 0x555555 });
      const clothes = [0xe63946, 0xf1faee, 0x457b9d, 0xffb703];
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        const q = { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t - 22 };
        gl.rect(q.x - 3, q.y, 6, 8).fill(clothes[i % clothes.length]!);
      }
    }
    const chair = yard[1];
    if (chair) {
      const g = this.layer(chair[0] + chair[1]);
      box(g, chair[0] + 0.3, chair[1] + 0.3, 0.25, 0.25, 0, 6, 0xf1f1f1);
      faceX(g, chair[0] + 0.3, chair[1] + 0.3, chair[1] + 0.55, 6, 13, 0xe0e0e0);
    }
  }

  private drawStreetLight(x: number, y: number): void {
    const g = this.layer(x + y);
    const c = iso(x + 0.5, y + 0.5);
    g.rect(c.x - 1, c.y - 46, 2, 46).fill(0x3d3d3d);
    g.rect(c.x - 1, c.y - 46, 10, 2).fill(0x3d3d3d);
    g.rect(c.x + 6, c.y - 46, 5, 3).fill(0x777777);
    this.lightLayer(x + y)
      .rect(c.x + 6, c.y - 44, 5, 2)
      .fill(0xfff4c2);
    this.lampGlow.circle(c.x + 8, c.y - 43, 7).fill({ color: 0xffe7a0, alpha: 0.55 });
    this.lampGlow.ellipse(c.x + 8, c.y, TW * 0.9, TH * 0.9).fill({ color: 0xffd27a, alpha: 0.16 });
  }

  private drawTree(x: number, y: number): void {
    const g = this.layer(x + y);
    const c = iso(x + 0.5, y + 0.5);
    const k = hash01(`t${x},${y}`);
    groundShadow(g, x + 0.5, y + 0.5, 14, 0.2);
    g.rect(c.x - 2, c.y - 22, 4, 22).fill(0x6b4423);
    const green = mix(0x2d6a4f, 0x52b788, k);
    g.circle(c.x, c.y - 30, 13).fill(green);
    g.circle(c.x - 8, c.y - 24, 9).fill(shade(green, 0.85));
    g.circle(c.x + 7, c.y - 25, 9).fill(shade(green, 1.1));
  }
}

function f0Sign(b: Box, tx: number, ty: number): boolean {
  // Signs go on the street-facing front tiles only.
  return tx === b.x + b.w - 1 || ty === b.y + b.h - 1;
}
