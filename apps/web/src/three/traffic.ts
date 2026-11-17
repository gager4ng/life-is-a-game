import type { RegionMap, Tile } from "@liag/engine";
import { DRIVE_COST, WALK_COST, findPath } from "@liag/engine";
import type { CityModel } from "../render/city-model";
import type { Look } from "../render/look";
import { randomLook } from "../render/look";
import { Rand } from "../util/random";
import { angleDiff, yawFor } from "./coords";
import type { Figure } from "./people3d";
import type { VehicleKind, VehiclePose } from "./vehicles";
import { DANFO_YELLOW, KEKE_COLORS, OKADA_COLORS } from "./vehicles";

/**
 * Background life that is not part of the simulation: danfos, keke and okada on the roads,
 * passers-by on the sidewalks, and a conductor calling at the park. Decoration only, with its
 * own seeded random numbers; the engine never sees any of it.
 */

interface Mover {
  path: Tile[];
  dist: number;
  speed: number;
  x: number;
  z: number;
  yaw: number;
}

interface Vehicle extends Mover {
  kind: VehicleKind;
  color: number;
  rider: Look | null;
}

interface Walker extends Mover {
  look: Look;
  phase: number;
}

export class Traffic {
  private readonly rand = new Rand(20260601);
  private vehicles: Vehicle[] = [];
  private walkers: Walker[] = [];
  private wantVehicles = 10;
  private wantWalkers = 20;
  private conductor: { look: Look; x: number; z: number } | null = null;
  private time = 0;

  constructor(
    private readonly map: RegionMap,
    private readonly city: CityModel,
    private maxWalkers: number,
    private maxVehicles: number,
  ) {
    const park = city.places.find((p) => p.type === "transport_hub");
    if (park) {
      const look = randomLook(new Rand(7));
      look.top = 0xf6c90e;
      look.outfit = "tshirt";
      look.headwear = "cap";
      look.accent = 0x111111;
      look.umbrella = false;
      this.conductor = { look, x: park.door[0] + 1.6, z: park.door[1] + 0.9 };
    }
  }

  setLimits(walkers: number, vehicles: number): void {
    this.maxWalkers = walkers;
    this.maxVehicles = vehicles;
  }

  /** How busy the streets are: by time of day and weather. */
  setMood(night: number, rain: boolean, heavy: boolean): void {
    const busy = 1 - night * 0.7;
    this.wantVehicles = Math.round(this.maxVehicles * busy * (heavy ? 0.6 : 1));
    this.wantWalkers = Math.round(this.maxWalkers * busy * (rain ? (heavy ? 0.3 : 0.55) : 1));
  }

  /** `dt`: seconds of real time times the game speed. */
  update(dt: number): void {
    this.time += dt;
    if (this.vehicles.length < this.wantVehicles && this.rand.chance(0.05)) this.spawnVehicle();
    if (this.walkers.length < this.wantWalkers && this.rand.chance(0.1)) this.spawnWalker();
    this.vehicles = this.vehicles.filter((v) => this.move(v, dt, 0.24));
    this.walkers = this.walkers.filter((w) => {
      w.phase += dt * w.speed * 5.5;
      return this.move(w, dt, 0.3);
    });
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
        ? DANFO_YELLOW
        : kind === "keke"
          ? this.rand.pick(KEKE_COLORS)
          : this.rand.pick(OKADA_COLORS);
    const speed = kind === "danfo" ? 2.6 : kind === "keke" ? 2.1 : 3;
    this.vehicles.push({
      path,
      dist: 0,
      speed: speed * (0.85 + this.rand.next() * 0.3),
      x: a[0] + 0.5,
      z: a[1] + 0.5,
      yaw: 0,
      kind,
      color,
      rider: kind === "okada" ? { ...randomLook(this.rand), umbrella: false } : null,
    });
  }

  private spawnWalker(): void {
    const sw = this.city.sidewalks;
    const a = this.rand.pick(sw);
    const b = this.rand.pick(sw);
    const path = findPath(this.map, a, b, WALK_COST);
    if (!path || path.length < 6) return;
    this.walkers.push({
      path,
      dist: 0,
      speed: 1.1 + this.rand.next() * 0.4,
      x: a[0] + 0.5,
      z: a[1] + 0.5,
      yaw: 0,
      look: randomLook(this.rand),
      phase: this.rand.next() * 6,
    });
  }

  /** Move along the path, keeping right; false at the end. */
  private move(m: Mover, dt: number, lane: number): boolean {
    m.dist += m.speed * dt;
    const steps = m.path.length - 1;
    if (m.dist >= steps) return false;
    const i = Math.floor(m.dist);
    const t = m.dist - i;
    const a = m.path[i]!;
    const b = m.path[i + 1]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    // Right of the direction of travel, seen from above with +z towards the viewer.
    m.x = a[0] + dx * t + 0.5 - dz * lane;
    m.z = a[1] + dz * t + 0.5 + dx * lane;
    const want = yawFor(dx, dz);
    m.yaw += angleDiff(m.yaw, want) * Math.min(1, dt * 10);
    return true;
  }

  vehiclePoses(kind: VehicleKind): VehiclePose[] {
    return this.vehicles
      .filter((v) => v.kind === kind)
      .map((v) => ({ x: v.x, z: v.z, yaw: v.yaw, color: v.color }));
  }

  vehicleShadows(): { x: number; z: number; w: number; d: number; yaw: number }[] {
    return this.vehicles.map((v) => ({
      x: v.x,
      z: v.z,
      yaw: v.yaw,
      w: v.kind === "danfo" ? 0.6 : 0.4,
      d: v.kind === "danfo" ? 1.15 : v.kind === "keke" ? 0.7 : 0.55,
    }));
  }

  /** Passers-by, okada riders and the conductor as figures. */
  figures(raining: boolean): Figure[] {
    const out: Figure[] = [];
    for (const w of this.walkers)
      out.push({
        x: w.x,
        z: w.z,
        yaw: w.yaw,
        look: w.look,
        pose: "walk",
        expr: "neutral",
        phase: w.phase,
        umbrella: raining && w.look.umbrella,
        t: this.time,
      });
    for (const v of this.vehicles) {
      if (!v.rider) continue;
      out.push({
        x: v.x - Math.sin(v.yaw) * 0.04,
        z: v.z - Math.cos(v.yaw) * 0.04,
        y: 0.12,
        yaw: v.yaw,
        look: v.rider,
        pose: "ride",
        expr: "neutral",
        phase: 0,
        umbrella: false,
        t: this.time,
      });
    }
    if (this.conductor)
      out.push({
        x: this.conductor.x,
        z: this.conductor.z,
        yaw: Math.PI * 0.5 + Math.sin(this.time * 0.4) * 0.6,
        look: this.conductor.look,
        pose: "wave",
        expr: "happy",
        phase: 0,
        umbrella: false,
        t: this.time,
      });
    return out;
  }
}
