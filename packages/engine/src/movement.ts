import type { LocationDef } from "./content-types";
import { available, askAmount, currentPrices } from "./economy";
import { adjustEnergy, adjustMood, openSink } from "./effects";
import { appendEvent } from "./ledger";
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
  isOpen,
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
    activity: seg.activity,
    causes,
    source: seg.source,
    sourceId: seg.sourceId,
  };
}

/** Each tick: everyone heads where their plan (or their player) says, unless something stops them. */
export function moveCharacters(world: World): void {
  const minute = minuteOfDay(world.tick);
  for (const id of sortedCharacterIds(world)) {
    const c = getChar(world, id);
    if (inEncounter(world, id)) continue;
    const want = desire(world, c, minute);
    if (!want) continue;
    if (want.locationId === c.locationId) {
      c.activity = want.activity;
      c.seeking = null;
      c.delay = null;
      continue;
    }
    if (!c.knownLocations[want.locationId]) {
      // They want to go somewhere they can't find: they'll ask around (directions).
      c.seeking = { locationId: want.locationId, causeId: want.causes[0]! };
      continue;
    }
    c.seeking = null;
    const dest = getLocation(world, want.locationId);
    if (!isOpen(dest, minute)) continue;
    if (occupants(world, dest.id).length >= dest.capacity) continue;
    if (rainHoldsBack(world, c, want, minute)) continue;

    if (c.shortOf && c.shortOf.locationId === c.locationId) wentWithout(world, c);
    const from = c.locationId;
    const causes = [...want.causes];
    if (c.delay?.eventId) causes.push(c.delay.eventId);
    const ev = appendEvent(world, {
      type: "arrived",
      actors: [id],
      location: dest.id,
      causes,
      effects: [{ kind: "location", who: id, from, to: dest.id }],
      data: { from, activity: want.activity, source: want.source, sourceId: want.sourceId },
    });
    c.locationId = dest.id;
    c.activity = want.activity;
    c.arrivalEventId = ev.id;
    c.delay = null;
    onArrive(world, c, dest);
  }
}

/** Rain keeps people where they are for a while: heavy rain almost always, light rain sometimes. */
function rainHoldsBack(world: World, c: CharacterState, want: Desire, minute: number): boolean {
  if (c.delay && c.delay.forLocation === want.locationId) {
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
    c.delay = { forLocation: want.locationId, untilTick: world.tick, eventId: null };
    return false;
  }
  const ticks = heavy
    ? clamp(Math.ceil((end - minute) / TICK_MINUTES), 1, 6)
    : intBetween(world.rng, 1, 3);
  const here = getLocation(world, c.locationId);
  const ev = appendEvent(world, {
    type: "delayed",
    actors: [c.id],
    location: c.locationId,
    causes: [st.eventId, ...want.causes],
    data: {
      weather: w,
      wanted: want.locationId,
      minutes: ticks * TICK_MINUTES,
      noDanfo: here.type === "transport_hub",
    },
  });
  c.delay = { forLocation: want.locationId, untilTick: world.tick + ticks, eventId: ev.id };
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
    const loc = getLocation(world, c.locationId);
    const sleeping = c.activity === "sleep";
    let energy = c.needs.energy;
    let mood = c.needs.mood;
    if (sleeping) energy += 1.8;
    else energy -= hasTrait(c, "night_owl") && isNight(minute) ? 0.3 : 0.5;
    const w = currentWeather(world, c.regionId);
    if (loc.outdoor && !sleeping) {
      if (isRain(w) && !hasItem(c, "umbrella") && c.shelteredUntil <= world.tick) {
        mood -= w === "heavy_rain" ? 0.8 : 0.4;
      } else if (w === "harmattan") mood -= 0.1;
    }
    mood += (55 - mood) * 0.01;
    c.needs.energy = round2(clamp(energy, 0, 100));
    c.needs.mood = round2(clamp(mood, 0, 100));
    if (c.workplaceId === c.locationId && c.activity === "work") c.today.ticksWorked += 1;
  }
}
