import type { GraphicsContext } from "pixi.js";
import { Container, Graphics } from "pixi.js";
import type { Tile } from "@liag/engine";
import { DRIVE_COST, WALK_COST, findPath } from "@liag/engine";
import type { RegionMap } from "@liag/engine";
import type { CityModel } from "./city-model";
import type { CityView } from "./city-view";
import { entityZ, iso } from "./iso";
import type { Look } from "./look";
import { randomLook } from "./look";
import type { Facing } from "./people-model";
import { facingOf } from "./people-model";
import { personFrames, umbrellaContext } from "./art/person";
import type { VehicleKind } from "./art/vehicles";
import { DANFO, KEKE_COLORS, vehicleContext } from "./art/vehicles";
import { Rand } from "../util/random";

/**
 * Background life that is not part of the simulation: danfos, keke and okada on the roads and
 * passers-by on the sidewalks. Decoration only; the engine never sees any of it.
 */

interface Mover {
  path: Tile[];
  /** Distance travelled along the path, in tiles. */
  dist: number;
  speed: number;
  root: Container;
  body: Graphics;
  facing: Facing;
}

interface Vehicle extends Mover {
  ctx: Record<Facing, GraphicsContext>;
}

interface Walker extends Mover {
  look: Look;
  umbrella: Graphics | null;
  frameT: number;
}

const FACINGS: Facing[] = ["se", "sw", "ne", "nw"];

export class Ambient {
  private readonly rand = new Rand(20260601);
  private vehicles: Vehicle[] = [];
  private walkers: Walker[] = [];
  private conductor: Walker | null = null;
  private wantVehicles = 12;
  private wantWalkers = 24;
  private raining = false;

  constructor(
    private readonly map: RegionMap,
    private readonly city: CityModel,
    private readonly view: CityView,
  ) {
    this.placeConductor();
  }

  /** How busy the streets are: by time of day and weather. */
  setMood(night: number, rain: boolean, heavy: boolean): void {
    this.raining = rain;
    const busy = 1 - night * 0.7;
    this.wantVehicles = Math.round(13 * busy * (heavy ? 0.6 : 1));
    this.wantWalkers = Math.round(26 * busy * (rain ? (heavy ? 0.3 : 0.55) : 1));
  }

  /** `dt` in seconds of real time already multiplied by the game speed. */
  update(dt: number): void {
    if (this.vehicles.length < this.wantVehicles && this.rand.chance(0.04)) this.spawnVehicle();
    if (this.walkers.length < this.wantWalkers && this.rand.chance(0.08)) this.spawnWalker();
    this.vehicles = this.vehicles.filter((v) => this.moveVehicle(v, dt));
    this.walkers = this.walkers.filter((w) => this.moveWalker(w, dt));
    if (this.conductor) {
      // Calling for passengers: a little arm-wave loop.
      this.conductor.frameT += dt * 2;
      const f = personFrames(this.conductor.look);
      this.conductor.body.context = f.front[1 + (Math.floor(this.conductor.frameT) % 2) * 2]!;
    }
  }

  private spawnVehicle(): void {
    const ends = this.city.roadEnds;
    if (ends.length < 2) return;
    const a = this.rand.pick(ends);
    const b = this.rand.pick(ends);
    if (a === b) return;
    const path = findPath(this.map, a, b, DRIVE_COST);
    if (!path || path.length < 4) return;
    const roll = this.rand.next();
    const kind: VehicleKind = roll < 0.45 ? "danfo" : roll < 0.75 ? "keke" : "okada";
    const color =
      kind === "danfo"
        ? DANFO
        : kind === "keke"
          ? this.rand.pick(KEKE_COLORS)
          : this.rand.pick([0xd62828, 0x1d3557, 0x2a9d8f, 0xf77f00]);
    const ctx = Object.fromEntries(
      FACINGS.map((f) => [f, vehicleContext(kind, f, color)]),
    ) as Record<Facing, GraphicsContext>;
    const root = new Container();
    const body = new Graphics(ctx.se);
    root.addChild(body);
    this.view.addEntity(root);
    const speed = kind === "danfo" ? 4.2 : kind === "keke" ? 3.4 : 5;
    this.vehicles.push({
      path,
      dist: 0,
      speed: speed * (0.85 + this.rand.next() * 0.3),
      root,
      body,
      facing: "se",
      ctx,
    });
  }

  private spawnWalker(): void {
    const sw = this.city.sidewalks;
    const a = this.rand.pick(sw);
    const b = this.rand.pick(sw);
    const path = findPath(this.map, a, b, WALK_COST);
    if (!path || path.length < 6) return;
    const look = randomLook(this.rand);
    const root = new Container();
    const body = new Graphics(personFrames(look).front[0]!);
    root.addChild(body);
    let umbrella: Graphics | null = null;
    if (look.umbrella) {
      umbrella = new Graphics(
        umbrellaContext(this.rand.pick([0x1d3557, 0xe63946, 0x2a9d8f, 0x333333])),
      );
      umbrella.visible = false;
      root.addChild(umbrella);
    }
    this.view.addEntity(root);
    this.walkers.push({
      path,
      dist: 0,
      speed: 2 + this.rand.next() * 0.8,
      root,
      body,
      facing: "se",
      look,
      umbrella,
      frameT: 0,
    });
  }

  private placeConductor(): void {
    const park = this.city.places.find((p) => p.type === "transport_hub");
    if (!park) return;
    const look = randomLook(new Rand(7));
    look.top = 0xf6c90e;
    look.outfit = "tshirt";
    look.headwear = "cap";
    look.accent = 0x111111;
    const root = new Container();
    const body = new Graphics(personFrames(look).front[0]!);
    root.addChild(body);
    const x = park.door[0] + 1.6;
    const y = park.door[1] + 0.4;
    const p = iso(x, y);
    root.position.set(p.x, p.y);
    root.zIndex = entityZ(x, y);
    this.view.addEntity(root);
    this.conductor = {
      path: [],
      dist: 0,
      speed: 0,
      root,
      body,
      facing: "se",
      look,
      umbrella: null,
      frameT: 0,
    };
  }

  /** Position along a path at a distance; false when the end is reached. */
  private place(m: Mover, lane: number): boolean {
    const steps = m.path.length - 1;
    if (m.dist >= steps) return false;
    const i = Math.floor(m.dist);
    const t = m.dist - i;
    const a = m.path[i]!;
    const b = m.path[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    // Keep right: offset to the right of the direction of travel.
    const x = a[0] + dx * t + 0.5 - dy * lane;
    const y = a[1] + dy * t + 0.5 + dx * lane;
    const p = iso(x, y);
    m.root.position.set(p.x, p.y);
    m.root.zIndex = entityZ(x - 0.5, y - 0.5);
    m.facing = facingOf(dx, dy, m.facing);
    return true;
  }

  private moveVehicle(v: Vehicle, dt: number): boolean {
    v.dist += v.speed * dt;
    if (!this.place(v, 0.24)) {
      this.view.removeEntity(v.root);
      v.root.destroy({ children: true });
      return false;
    }
    v.body.context = v.ctx[v.facing];
    return true;
  }

  private moveWalker(w: Walker, dt: number): boolean {
    w.dist += w.speed * dt;
    if (!this.place(w, 0.18)) {
      this.view.removeEntity(w.root);
      w.root.destroy({ children: true });
      return false;
    }
    w.frameT += dt * 7;
    const f = personFrames(w.look);
    const front = w.facing === "se" || w.facing === "sw";
    w.body.context = (front ? f.front : f.back)[1 + (Math.floor(w.frameT) % 4)]!;
    w.body.scale.x = w.facing === "sw" || w.facing === "nw" ? -1 : 1;
    if (w.umbrella) w.umbrella.visible = this.raining;
    return true;
  }
}
