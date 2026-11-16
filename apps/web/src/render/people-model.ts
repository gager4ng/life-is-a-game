import type { CharacterState, Journey, Tile, World } from "@liag/engine";
import { isPresent, journey, positionOnJourney } from "@liag/engine";
import type { CityModel } from "./city-model";
import { spotFor } from "./city-model";

/**
 * Maps engine state to what the city should show for each character: where they stand,
 * which way they face, whether they're walking or out of sight. Pure, so it is unit-tested.
 */

export type Facing = "se" | "sw" | "ne" | "nw";

export interface PersonView {
  id: string;
  /** Tile units (fractional). */
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  visible: boolean;
  isPlayer: boolean;
  /** Why they're hidden, if they are: indoors asleep, on a danfo, at an off-map place. */
  hiddenBecause: "asleep" | "riding" | "offmap" | null;
}

/** Screen direction for a step along the grid: +x is down-right (se), +y is down-left (sw). */
export function facingOf(dx: number, dy: number, fallback: Facing = "se"): Facing {
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? "se" : "nw";
  if (dy !== 0) return dy > 0 ? "sw" : "ne";
  return fallback;
}

/**
 * How far along their trip a traveller is, 0..1. `shownTick` is the time on screen: the last
 * simulated tick plus how far the clock has run towards the next one.
 */
export function tripProgress(c: CharacterState, shownTick: number): number {
  const t = c.travel;
  if (!t) return 1;
  const span = t.arriveTick - t.departTick;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (shownTick - t.departTick) / span));
}

const journeys = new Map<string, Journey>();

/** Path-finding once per trip, not once per frame. */
function cachedJourney(world: World, c: CharacterState): Journey {
  const t = c.travel!;
  const key = `${world.seed}|${c.id}|${t.departTick}|${JSON.stringify(t.from)}|${JSON.stringify(t.to)}`;
  let j = journeys.get(key);
  if (!j) {
    if (journeys.size > 400) journeys.clear();
    j = journey(world.content, c.regionId, t.from, t.to);
    journeys.set(key, j);
  }
  return j;
}

export function personView(
  world: World,
  city: CityModel,
  id: string,
  shownTick: number,
  prev?: PersonView,
): PersonView {
  const c = world.characters[id]!;
  const isPlayer = c.controlledBy !== null;
  const base = { id, isPlayer, moving: false, visible: true, hiddenBecause: null };
  const fallbackFacing = prev?.facing ?? "sw";

  if (c.travel) {
    const j = cachedJourney(world, c);
    const pos = positionOnJourney(j, tripProgress(c, shownTick) * j.totalMinutes);
    if (!pos) {
      return {
        ...base,
        x: prev?.x ?? 0,
        y: prev?.y ?? 0,
        facing: fallbackFacing,
        visible: false,
        hiddenBecause: "riding",
      };
    }
    return {
      ...base,
      x: pos.x,
      y: pos.y,
      facing: facingOf(pos.dir[0], pos.dir[1], fallbackFacing),
      moving: true,
    };
  }
  if (c.street) {
    return { ...base, x: c.street[0], y: c.street[1], facing: fallbackFacing };
  }
  const place = city.places.find((p) => p.locationId === c.locationId);
  if (!place) {
    return {
      ...base,
      x: prev?.x ?? 0,
      y: prev?.y ?? 0,
      facing: fallbackFacing,
      visible: false,
      hiddenBecause: "offmap",
    };
  }
  const spot = spotFor(place, id);
  if (isPresent(c) && c.activity === "sleep") {
    return {
      ...base,
      x: spot.x,
      y: spot.y,
      facing: fallbackFacing,
      visible: false,
      hiddenBecause: "asleep",
    };
  }
  // Face the encounter partner, if any, else the door.
  const enc = world.encounters.find((e) => e.askerId === id || e.giverId === id);
  let facing = fallbackFacing;
  if (enc) {
    const other = enc.askerId === id ? enc.giverId : enc.askerId;
    const o = spotFor(place, other);
    facing = facingOf(o.x - spot.x, o.y - spot.y, fallbackFacing);
  } else if (!prev || prev.moving) {
    facing = facingOf(place.door[0] - spot.x, place.door[1] - spot.y, fallbackFacing);
  }
  return { ...base, x: spot.x, y: spot.y, facing };
}

/** Where the player character is right now, as the tile under them. */
export function playerTile(v: PersonView): Tile {
  return [Math.round(v.x), Math.round(v.y)];
}
