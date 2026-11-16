import type { LocationDef, Tile } from "./content-types";
import { available, askAmount, currentPrices } from "./economy";
import { adjustEnergy, adjustMood, openSink } from "./effects";
import { appendEvent } from "./ledger";
import type { Endpoint } from "./map";
import { journey, positionOnJourney, sameTile } from "./map";
import { segmentAt } from "./planning";
import { chance, intBetween } from "./rng";
import { TICK_MINUTES, isNight, minuteOfDay } from "./time";
import type { CharacterState, World } from "./types";
import { clamp, round2 } from "./util";
import { currentWeather, isRain, rainEndsAt } from "./weather";
import {
  getChar,
  getLocation,
  hasItem,
  hasTrait,
  isAt,
  isOpen,
  isPresent,
  occupants,
  sortedCharacterIds,
} from "./world";

export const EATING_ACTIVITIES: ReadonlySet<string> = new Set([
  "lunch",
  "dinner",
  "breakfast",
  "eat",
  "watch_match",
]);

interface Desire {
  locationId: string;
  /** Set when the target is a spot on the street rather than a place. */
  tile: Tile | null;
  activity: string;
  causes: string[];
  source: string;
  sourceId: string | null;
}

export function inEncounter(world: World, charId: string): boolean {
  return world.encounters.some((e) => e.askerId === charId || e.giverId === charId);
}

function desire(world: World, c: CharacterState, minute: number): Desire | null {
  if (c.override) {
    if (world.tick < c.override.untilTick) {
      return {
        locationId: c.override.locationId,
        tile: c.override.tile ?? null,
        activity: c.override.activity,
        causes: [c.override.eventId],
        source: "player",
        sourceId: null,
      };
    }
    c.override = null;
  }
  const seg = segmentAt(c, minute);
  if (!seg) return null;
  const causes = [c.planEventId];
  if (seg.source === "world_event" && seg.sourceId && world.activeWorldEvents[seg.sourceId]) {
    causes.push(world.activeWorldEvents[seg.sourceId]!);
  }
  return {
    locationId: seg.locationId,
    tile: null,
    activity: seg.activity,
    causes,
    source: seg.source,
    sourceId: seg.sourceId,
  };
}

function targetKey(want: Desire): string {
  return want.tile ? `street:${want.tile[0]},${want.tile[1]}` : want.locationId;
}

function endpointOf(want: Desire): Endpoint {
  return want.tile ? { tile: [want.tile[0], want.tile[1]] } : { locationId: want.locationId };
}

function sameTarget(to: Endpoint, want: Desire): boolean {
  if ("tile" in to) return want.tile !== null && sameTile(to.tile, want.tile);
  return want.tile === null && to.locationId === want.locationId;
}

/**
 * Each tick: everyone heads where their plan (or their player) says, unless something stops
 * them. Getting there takes time: the walk along the streets (plus any danfo ride), counted
 * in whole ticks. On the way they are at no place, so they meet nobody until they arrive.
 */
export function moveCharacters(world: World): void {
  const minute = minuteOfDay(world.tick);
  for (const id of sortedCharacterIds(world)) {
    const c = getChar(world, id);
    if (inEncounter(world, id)) continue;
    if (c.travel) {
      if (world.tick >= c.travel.arriveTick) arrive(world, c);
      else if (c.controlledBy) redirect(world, c, minute);
      continue;
    }
    const want = desire(world, c, minute);
    if (!want) continue;
    if (want.tile) {
      if (sameTile(c.street, want.tile)) {
        c.activity = want.activity;
        c.delay = null;
        continue;
      }
      if (rainHoldsBack(world, c, want, minute)) continue;
      depart(world, c, want);
      continue;
    }
    if (want.locationId === c.locationId && isPresent(c)) {
      c.activity = want.activity;
      c.seeking = null;
      c.delay = null;
      continue;
    }
    if (!c.knownLocations[want.locationId]) {
      // They want to go somewhere they can not find: they will ask around (directions).
      c.seeking = { locationId: want.locationId, causeId: want.causes[0]! };
      continue;
    }
    c.seeking = null;
    const dest = getLocation(world, want.locationId);
    if (!isOpen(dest, minute)) continue;
    if (occupants(world, dest.id).length >= dest.capacity) continue;
    if (rainHoldsBack(world, c, want, minute)) continue;
    if (c.shortOf && c.shortOf.locationId === c.locationId && isPresent(c)) wentWithout(world, c);
    depart(world, c, want);
  }
}

/** Set off. Nothing is ledgered yet: the arrival records the trip and why it was made. */
function depart(world: World, c: CharacterState, want: Desire): void {
  const from: Endpoint = c.street ? { tile: c.street } : { locationId: c.locationId };
  const to = endpointOf(want);
  const j = journey(world.content, c.regionId, from, to);
  const causes = [...want.causes];
  if (c.delay?.eventId) causes.push(c.delay.eventId);
  c.delay = null;
  c.street = null;
  c.travel = {
    from,
    to,
    departTick: world.tick,
    arriveTick: world.tick + j.ticks,
    activity: want.activity,
    causes,
    source: want.source,
    sourceId: want.sourceId,
  };
  c.activity = "travel";
  if (j.ticks === 0) arrive(world, c);
}

function arrive(world: World, c: CharacterState): void {
  const t = c.travel!;
  const from = "locationId" in t.from ? t.from.locationId : "street";
  const data = {
    from,
    activity: t.activity,
    source: t.source,
    sourceId: t.sourceId,
    departedTick: t.departTick,
    minutes: (world.tick - t.departTick) * TICK_MINUTES,
  };
  if ("tile" in t.to) {
    const ev = appendEvent(world, {
      type: "arrived",
      actors: [c.id],
      location: null,
      causes: t.causes,
      data: { ...data, street: [t.to.tile[0], t.to.tile[1]] },
    });
    c.street = [t.to.tile[0], t.to.tile[1]];
    c.activity = t.activity;
    c.arrivalEventId = ev.id;
    c.travel = null;
    return;
  }
  const dest = getLocation(world, t.to.locationId);
  if (occupants(world, dest.id).length >= dest.capacity) {
    t.arriveTick = world.tick + 1; // full: wait outside a little
    return;
  }
  const ev = appendEvent(world, {
    type: "arrived",
    actors: [c.id],
    location: dest.id,
    causes: t.causes,
    effects: [{ kind: "location", who: c.id, from, to: dest.id }],
    data,
  });
  c.locationId = dest.id;
  c.activity = t.activity;
  c.arrivalEventId = ev.id;
  c.travel = null;
  onArrive(world, c, dest);
}

/** Where a traveller is right now, as the nearest path tile (null while riding off-map). */
export function travelTile(world: World, c: CharacterState): Tile | null {
  const t = c.travel;
  if (!t) return null;
  const j = journey(world.content, c.regionId, t.from, t.to);
  const span = Math.max(1, t.arriveTick - t.departTick);
  const pos = positionOnJourney(j, ((world.tick - t.departTick) / span) * j.totalMinutes);
  if (!pos) return null;
  return [Math.round(pos.x), Math.round(pos.y)];
}

/** A player changed their mind on the way: turn round from wherever they are now. */
function redirect(world: World, c: CharacterState, minute: number): void {
  const want = desire(world, c, minute);
  if (!want || sameTarget(c.travel!.to, want)) return;
  if (!want.tile) {
    if (!c.knownLocations[want.locationId]) return;
    if (!isOpen(getLocation(world, want.locationId), minute)) return;
  }
  const here = travelTile(world, c);
  if (!here) return; // on a danfo: they can only change plans once they get off
  c.travel = null;
  c.street = here;
  depart(world, c, want);
}

/** Rain keeps people where they are for a while: heavy rain almost always, light rain sometimes. */
function rainHoldsBack(world: World, c: CharacterState, want: Desire, minute: number): boolean {
  const key = targetKey(want);
  if (c.delay && c.delay.forLocation === key) {
    return world.tick < c.delay.untilTick;
  }
  c.delay = null;
  const w = currentWeather(world, c.regionId);
  if (!isRain(w) || c.activity === "sleep") return false;
  const st = world.regionWeather[c.regionId]!;
  const umbrella = hasItem(c, "umbrella");
  const heavy = w === "heavy_rain";
  const p = heavy ? (umbrella ? 0.6 : 0.85) : umbrella ? 0.1 : 0.5;
  const end = rainEndsAt(st.day, minute) ?? minute + TICK_MINUTES;
  if (!chance(world.rng, p)) {
    c.delay = { forLocation: key, untilTick: world.tick, eventId: null };
    return false;
  }
  const ticks = heavy
    ? clamp(Math.ceil((end - minute) / TICK_MINUTES), 1, 6)
    : intBetween(world.rng, 1, 3);
  const present = isPresent(c);
  const here = getLocation(world, c.locationId);
  const ev = appendEvent(world, {
    type: "delayed",
    actors: [c.id],
    location: present ? c.locationId : null,
    causes: [st.eventId, ...want.causes],
    data: {
      weather: w,
      wanted: want.tile ? null : want.locationId,
      minutes: ticks * TICK_MINUTES,
      noDanfo: present && here.type === "transport_hub",
    },
  });
  c.delay = { forLocation: key, untilTick: world.tick + ticks, eventId: ev.id };
  return true;
}

function onArrive(world: World, c: CharacterState, dest: LocationDef): void {
  const p = currentPrices(world, c.regionId);
  if (dest.type === "transport_hub" && c.activity === "commute") {
    if (available(world, c) >= p.transportFare) c.today.trips += 1;
    else markShort(world, c, "transport_money", p.transportFare);
  } else if (dest.type === "buka" && EATING_ACTIVITIES.has(c.activity)) {
    if (available(world, c) >= p.mealOut) c.today.mealsOut += 1;
    else markShort(world, c, "chop_money", p.mealOut);
  } else if (dest.type === "music_venue" && c.activity !== "work" && c.activity !== "perform") {
    if (available(world, c) >= p.drink) c.today.drinks += 1;
  }
}

function markShort(
  world: World,
  c: CharacterState,
  kind: "transport_money" | "chop_money",
  cost: number,
): void {
  const shortfall = cost - Math.max(0, available(world, c));
  const amount = askAmount(shortfall);
  const ev = appendEvent(world, {
    type: "short_of_money",
    actors: [c.id],
    location: c.locationId,
    causes: [c.arrivalEventId],
    data: { kind, cost, amount },
  });
  c.shortOf = { kind, amount, locationId: c.locationId, eventId: ev.id };
}

/** Leaving without the money they needed: trek home, or go hungry. */
export function wentWithout(world: World, c: CharacterState): void {
  const short = c.shortOf;
  if (!short) return;
  const sink = openSink(world);
  if (short.kind === "transport_money") {
    adjustMood(world, sink, c.id, -6);
    adjustEnergy(world, sink, c.id, -8);
  } else {
    adjustMood(world, sink, c.id, -5);
  }
  appendEvent(world, {
    type: "went_without",
    actors: [c.id],
    location: c.locationId,
    causes: [short.eventId],
    effects: sink.effects,
    data: { kind: short.kind },
  });
  c.shortOf = null;
}

/** Small per-tick changes in energy and mood (not ledgered: they are continuous, not events). */
export function updateNeeds(world: World): void {
  const minute = minuteOfDay(world.tick);
  for (const id of sortedCharacterIds(world)) {
    const c = getChar(world, id);
    const outdoor = !isPresent(c) || getLocation(world, c.locationId).outdoor;
    const sleeping = c.activity === "sleep";
    let energy = c.needs.energy;
    let mood = c.needs.mood;
    if (sleeping) energy += 1.8;
    else energy -= hasTrait(c, "night_owl") && isNight(minute) ? 0.3 : 0.5;
    const w = currentWeather(world, c.regionId);
    if (outdoor && !sleeping) {
      if (isRain(w) && !hasItem(c, "umbrella") && c.shelteredUntil <= world.tick) {
        mood -= w === "heavy_rain" ? 0.8 : 0.4;
      } else if (w === "harmattan") mood -= 0.1;
    }
    mood += (55 - mood) * 0.01;
    c.needs.energy = round2(clamp(energy, 0, 100));
    c.needs.mood = round2(clamp(mood, 0, 100));
    if (c.workplaceId && isAt(c, c.workplaceId) && c.activity === "work") c.today.ticksWorked += 1;
  }
}
