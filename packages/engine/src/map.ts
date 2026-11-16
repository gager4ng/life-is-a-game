import type { ContentBundle, RegionMap, Tile } from "./content-types";
import { TICK_MINUTES } from "./time";

/**
 * Street grids and path-finding. Pure functions over content: the engine uses them for travel
 * time, and the browser client uses the very same paths to draw people walking.
 */

/** Cost of stepping onto a tile, or null if it can't be walked on. */
export type TileCost = (code: string) => number | null;

/** People keep to sidewalks, crossings and yards, and cross the road only where they must. */
export const WALK_COST: TileCost = (code) => {
  switch (code) {
    case "s":
    case "z":
    case "p":
      return 1;
    case "g":
      return 2;
    case "R":
      return 6;
    default:
      return null;
  }
};

/** Vehicles stay on the road (crossings included). */
export const DRIVE_COST: TileCost = (code) => (code === "R" || code === "z" ? 1 : null);

export function mapSize(map: RegionMap): { w: number; h: number } {
  return { w: map.tiles[0]?.length ?? 0, h: map.tiles.length };
}

export function tileCode(map: RegionMap, x: number, y: number): string {
  const row = map.tiles[y];
  if (!row || x < 0 || x >= row.length) return "#";
  return row[x]!;
}

export function isWalkable(map: RegionMap, t: Tile, cost: TileCost = WALK_COST): boolean {
  return cost(tileCode(map, t[0], t[1])) !== null;
}

export function sameTile(a: Tile | null | undefined, b: Tile | null | undefined): boolean {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

/** Binary heap keyed by (cost, tile index) so ties always break the same way. */
class Heap {
  private items: [number, number][] = [];
  get size(): number {
    return this.items.length;
  }
  private less(a: [number, number], b: [number, number]): boolean {
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }
  push(item: [number, number]): void {
    const h = this.items;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const h = this.items;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l]!, h[m]!)) m = l;
        if (r < h.length && this.less(h[r]!, h[m]!)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m]!, h[i]!];
        i = m;
      }
    }
    return top;
  }
}

const STEPS: readonly Tile[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/**
 * Cheapest 4-way path from `from` to `to`, both ends included. Deterministic: equal-cost
 * alternatives are always resolved the same way. Returns null if there is no way through.
 */
export function findPath(
  map: RegionMap,
  from: Tile,
  to: Tile,
  cost: TileCost = WALK_COST,
): Tile[] | null {
  const { w, h } = mapSize(map);
  const inside = (t: Tile): boolean => t[0] >= 0 && t[1] >= 0 && t[0] < w && t[1] < h;
  if (!inside(from) || !inside(to)) return null;
  if (!isWalkable(map, from, cost) || !isWalkable(map, to, cost)) return null;
  const start = from[1] * w + from[0];
  const goal = to[1] * w + to[0];
  const dist = new Float64Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  dist[start] = 0;
  const heap = new Heap();
  heap.push([0, start]);
  while (heap.size > 0) {
    const [d, i] = heap.pop();
    if (d > dist[i]!) continue;
    if (i === goal) break;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const c = cost(tileCode(map, nx, ny));
      if (c === null) continue;
      const j = ny * w + nx;
      const nd = d + c;
      if (nd < dist[j]!) {
        dist[j] = nd;
        prev[j] = i;
        heap.push([nd, j]);
      }
    }
  }
  if (dist[goal] === Infinity) return null;
  const out: Tile[] = [];
  for (let i = goal; i !== -1; i = prev[i]!) out.push([i % w, Math.floor(i / w)]);
  return out.reverse();
}

export function regionMap(content: ContentBundle, regionId: string): RegionMap | null {
  return content.maps.find((m) => m.regionId === regionId) ?? null;
}

/** Where a place is on its region's grid: its door, or for off-map places the place you ride from. */
export function placeTile(map: RegionMap, locationId: string): Tile | null {
  const p = map.places.find((x) => x.locationId === locationId);
  if (p) return [p.door[0], p.door[1]];
  const off = map.offMap.find((x) => x.locationId === locationId);
  if (off) return placeTile(map, off.via);
  return null;
}

function rideMinutes(map: RegionMap, locationId: string | null): number {
  if (!locationId) return 0;
  return map.offMap.find((x) => x.locationId === locationId)?.rideMinutes ?? 0;
}

/** One end of a trip: a place, or a spot on the street. */
export type Endpoint = { locationId: string } | { tile: Tile };

export interface Journey {
  /** Tiles walked, both ends included (empty when the region has no map). */
  path: Tile[];
  /** Riding before the walk (leaving an off-map place), walking, riding after (to one). */
  rideBefore: number;
  walkMinutes: number;
  rideAfter: number;
  totalMinutes: number;
  /** Whole ticks the trip takes (at least 1 unless nothing has to move). */
  ticks: number;
}

/** Fixed trip length in a region without a street grid. */
export const UNMAPPED_TRIP_MINUTES = TICK_MINUTES;

/** How someone gets from one place (or street spot) to another, and how long it takes. */
export function journey(
  content: ContentBundle,
  regionId: string,
  from: Endpoint,
  to: Endpoint,
): Journey {
  const map = regionMap(content, regionId);
  if (!map) {
    return {
      path: [],
      rideBefore: 0,
      walkMinutes: UNMAPPED_TRIP_MINUTES,
      rideAfter: 0,
      totalMinutes: UNMAPPED_TRIP_MINUTES,
      ticks: Math.ceil(UNMAPPED_TRIP_MINUTES / TICK_MINUTES),
    };
  }
  const fromLoc = "locationId" in from ? from.locationId : null;
  const toLoc = "locationId" in to ? to.locationId : null;
  const a = fromLoc ? placeTile(map, fromLoc) : (from as { tile: Tile }).tile;
  const b = toLoc ? placeTile(map, toLoc) : (to as { tile: Tile }).tile;
  if (!a || !b) throw new Error(`No map position for ${fromLoc ?? "a street spot"} or ${toLoc}`);
  const sameOffMap = fromLoc !== null && fromLoc === toLoc;
  const rideBefore = sameOffMap ? 0 : rideMinutes(map, fromLoc);
  const rideAfter = sameOffMap ? 0 : rideMinutes(map, toLoc);
  const path = findPath(map, a, b) ?? [a, b];
  const walkMinutes = (path.length - 1) * map.minutesPerTile;
  const totalMinutes = rideBefore + walkMinutes + rideAfter;
  return {
    path,
    rideBefore,
    walkMinutes,
    rideAfter,
    totalMinutes,
    ticks: totalMinutes <= 0 ? 0 : Math.max(1, Math.ceil(totalMinutes / TICK_MINUTES)),
  };
}

/**
 * Where along a journey someone is after `minutes`: a tile position (fractional, between two
 * path tiles) while walking, or null while riding off-map.
 */
export function positionOnJourney(
  j: Journey,
  minutes: number,
): { x: number; y: number; dir: Tile } | null {
  if (j.path.length === 0) return null;
  if (minutes < j.rideBefore) return null;
  const walked = minutes - j.rideBefore;
  if (walked > j.walkMinutes && j.rideAfter > 0) return null;
  const steps = j.path.length - 1;
  if (steps === 0) return { x: j.path[0]![0], y: j.path[0]![1], dir: [0, 1] };
  const f = j.walkMinutes > 0 ? Math.min(1, Math.max(0, walked / j.walkMinutes)) : 1;
  const pos = f * steps;
  const i = Math.min(steps - 1, Math.floor(pos));
  const a = j.path[i]!;
  const b = j.path[i + 1]!;
  const t = pos - i;
  return {
    x: a[0] + (b[0] - a[0]) * t,
    y: a[1] + (b[1] - a[1]) * t,
    dir: [b[0] - a[0], b[1] - a[1]],
  };
}
