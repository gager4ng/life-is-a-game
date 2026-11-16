import type { LocationDef, LocationType, MapPlace, RegionMap, Tile } from "@liag/engine";
import { PALETTE } from "./color";
import { hash, hash01 } from "../util/random";

/**
 * Everything static about the city, worked out from the map data once: which tiles are which,
 * the buildings (places and filler) with their Lagos-style looks, streetlights and trees.
 * Pure data, no drawing, so it can be unit-tested.
 */

export interface BuildingStyle {
  wall: number;
  roof: number;
  floors: number;
  /** Rooftop water tank. */
  tank: boolean;
  /** Signboard colour over a ground-floor shop, or null for none. */
  sign: number | null;
  /** Corrugated zinc roof with a slope look, else a flat roof with a parapet. */
  zinc: boolean;
  seed: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  style: BuildingStyle;
  /** Set for the roofed part of a game location. */
  locationId: string | null;
  placeType: LocationType | null;
}

export interface PlaceView {
  locationId: string;
  name: string;
  type: LocationType;
  rect: { x: number; y: number; w: number; h: number };
  door: Tile;
  building: { x: number; y: number; w: number; h: number } | null;
  /** Open tiles inside the place where people can stand, nearest the door first. */
  spots: Tile[];
}

export interface CityModel {
  width: number;
  height: number;
  tiles: string[];
  boxes: Box[];
  places: PlaceView[];
  streetLights: Tile[];
  trees: Tile[];
  /** Walkable tiles (for background walkers), in a fixed order. */
  sidewalks: Tile[];
  /** Road tiles at the map edge where traffic enters and leaves. */
  roadEnds: Tile[];
}

export const FLOOR_PX = 22;

export function boxHeight(b: Box): number {
  return b.style.floors * FLOOR_PX + 6;
}

function code(tiles: string[], x: number, y: number): string {
  return tiles[y]?.[x] ?? "#";
}

const PLACE_STYLE: Partial<Record<LocationType, Partial<BuildingStyle>>> = {
  buka: { wall: 0xf7b267, roof: 0xb0623f, floors: 1, zinc: true, sign: 0xd62828, tank: false },
  music_venue: { wall: 0x4b3f72, roof: 0x2d2d3a, floors: 2, zinc: false, sign: 0x118ab2 },
  school: { wall: 0xf6e7cb, roof: 0x8d5a3b, floors: 3, zinc: false, sign: null, tank: true },
  home: { floors: 2, zinc: true, sign: null, tank: true },
};

function styleFor(key: string, over: Partial<BuildingStyle> = {}): BuildingStyle {
  const h = hash(key);
  const floorsRoll = hash01(`${key}:floors`);
  return {
    wall: PALETTE.walls[h % PALETTE.walls.length]!,
    roof: PALETTE.roofs[(h >>> 5) % PALETTE.roofs.length]!,
    floors: floorsRoll < 0.2 ? 1 : floorsRoll < 0.65 ? 2 : floorsRoll < 0.9 ? 3 : 4,
    tank: hash01(`${key}:tank`) < 0.55,
    sign: hash01(`${key}:sign`) < 0.7 ? PALETTE.signs[(h >>> 9) % PALETTE.signs.length]! : null,
    zinc: hash01(`${key}:zinc`) < 0.45,
    seed: h,
    ...over,
  };
}

function inRect(r: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

function roofedPart(p: MapPlace, tiles: string[]): MapPlace["building"] | null {
  if (p.building) return p.building;
  // A place with no yard at all is one building.
  for (let y = p.y; y < p.y + p.h; y++)
    for (let x = p.x; x < p.x + p.w; x++) if (code(tiles, x, y) !== "#") return null;
  return { x: p.x, y: p.y, w: p.w, h: p.h };
}

export function buildCity(map: RegionMap, locations: LocationDef[]): CityModel {
  const tiles = map.tiles;
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;
  const boxes: Box[] = [];
  const places: PlaceView[] = [];
  const taken = new Set<string>();
  const key = (x: number, y: number): string => `${x},${y}`;

  for (const p of map.places) {
    const loc = locations.find((l) => l.id === p.locationId);
    if (!loc) continue;
    const building = roofedPart(p, tiles);
    for (let y = p.y; y < p.y + p.h; y++)
      for (let x = p.x; x < p.x + p.w; x++) taken.add(key(x, y));
    if (building) {
      boxes.push({
        ...building,
        style: styleFor(p.locationId, PLACE_STYLE[loc.type] ?? {}),
        locationId: p.locationId,
        placeType: loc.type,
      });
    }
    const spots: Tile[] = [];
    for (let y = p.y; y < p.y + p.h; y++)
      for (let x = p.x; x < p.x + p.w; x++) {
        const c = code(tiles, x, y);
        if ((c === "p" || c === "g") && !(building && inRect(building, x, y))) spots.push([x, y]);
      }
    const d = (t: Tile): number => Math.abs(t[0] - p.door[0]) + Math.abs(t[1] - p.door[1]);
    spots.sort((a, b) => d(a) - d(b) || a[1] - b[1] || a[0] - b[0]);
    places.push({
      locationId: p.locationId,
      name: loc.name,
      type: loc.type,
      rect: { x: p.x, y: p.y, w: p.w, h: p.h },
      door: p.door,
      building: building ?? null,
      spots,
    });
  }

  // Filler buildings: cut every remaining lot into plots of 1-3 tiles a side.
  const free = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    code(tiles, x, y) === "#" &&
    !taken.has(key(x, y));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!free(x, y)) continue;
      const k = `plot:${x},${y}`;
      let w = 2 + (hash(k) % 2);
      let h = 2 + ((hash(k) >>> 3) % 2);
      const fits = (ww: number, hh: number): boolean => {
        for (let j = y; j < y + hh; j++)
          for (let i = x; i < x + ww; i++) if (!free(i, j)) return false;
        return true;
      };
      while (w > 1 && !fits(w, 1)) w--;
      while (h > 1 && !fits(w, h)) h--;
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) taken.add(key(i, j));
      // Shops (signboards) only on plots that face a street on a side you can see.
      const facesStreet =
        [...Array(h).keys()].some((j) => "sz".includes(code(tiles, x + w, y + j))) ||
        [...Array(w).keys()].some((i) => "sz".includes(code(tiles, x + i, y + h)));
      const style = styleFor(k);
      if (!facesStreet) style.sign = null;
      boxes.push({ x, y, w, h, style, locationId: null, placeType: null });
    }
  }

  const streetLights: Tile[] = [];
  const trees: Tile[] = [];
  const sidewalks: Tile[] = [];
  const roadEnds: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = code(tiles, x, y);
      if (c === "s" || c === "z" || c === "p") sidewalks.push([x, y]);
      if (c === "s") {
        const nextToRoad = [
          code(tiles, x + 1, y),
          code(tiles, x - 1, y),
          code(tiles, x, y + 1),
          code(tiles, x, y - 1),
        ].includes("R");
        if (nextToRoad && (x * 7 + y * 3) % 9 === 0) streetLights.push([x, y]);
        else if (!nextToRoad && hash01(`tree:${x},${y}`) < 0.04) trees.push([x, y]);
      }
      if (c === "g" && hash01(`tree:${x},${y}`) < 0.35) trees.push([x, y]);
      if (c === "R" && (x === 0 || y === 0 || x === width - 1 || y === height - 1))
        roadEnds.push([x, y]);
    }
  }
  return { width, height, tiles, boxes, places, streetLights, trees, sidewalks, roadEnds };
}

/** The spot a character stands on while at a place: stable for that person, spread out. */
export function spotFor(place: PlaceView, charId: string): { x: number; y: number } {
  if (place.spots.length === 0) return { x: place.door[0], y: place.door[1] };
  const h = hash(`${place.locationId}:${charId}`);
  const n = Math.min(place.spots.length, 12);
  const t = place.spots[h % n]!;
  const jx = (((h >>> 8) % 100) / 100 - 0.5) * 0.5;
  const jy = (((h >>> 16) % 100) / 100 - 0.5) * 0.5;
  return { x: t[0] + jx, y: t[1] + jy };
}

/** Which place (if any) covers a tile. */
export function placeAt(city: CityModel, x: number, y: number): PlaceView | null {
  return city.places.find((p) => inRect(p.rect, x, y)) ?? null;
}
