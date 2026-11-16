import type { WorldEventDef } from "./content-types";
import { appendEvent } from "./ledger";
import { chance } from "./rng";
import { TICK_MINUTES, TICKS_PER_DAY, calendar, dayIndex, parseHHMM } from "./time";
import type { CharacterState, PlanSegment, World } from "./types";
import { charDef, getLocation, isOpen, resolveRef } from "./world";

interface Cell {
  locationId: string;
  activity: string;
  source: PlanSegment["source"];
  sourceId: string | null;
}

function overlay(cells: Cell[], fromMin: number, toMin: number, cell: Cell): void {
  const a = Math.floor(fromMin / TICK_MINUTES);
  const b = toMin <= fromMin ? TICKS_PER_DAY : Math.ceil(toMin / TICK_MINUTES);
  for (let i = a; i < Math.min(b, TICKS_PER_DAY); i++) cells[i] = { ...cell };
}

export function worldEventApplies(
  def: WorldEventDef,
  c: CharacterState,
  who: { all?: boolean; traits?: string[]; ids?: string[] },
): boolean {
  if (def.regionId && def.regionId !== c.regionId) return false;
  if (who.all) return true;
  if (who.ids?.includes(c.id)) return true;
  if (who.traits?.some((t) => (c.traits as string[]).includes(t))) return true;
  return false;
}

/**
 * Build a character's plan for the day: weekday/weekend routine, then chance-based variations
 * (only those whose conditions hold), then world-event overrides. Closed places fall back to home.
 * Logged as one day_planned event that later arrivals cite as their cause.
 */
export function planDay(world: World, c: CharacterState): void {
  const def = charDef(world, c.id);
  const cal = calendar(world.startDate, dayIndex(world.tick));
  const base = cal.weekend ? def.routine.weekend : def.routine.weekday;
  const cells: Cell[] = new Array<Cell>(TICKS_PER_DAY);
  base.forEach((slot, i) => {
    const next = base[i + 1];
    overlay(cells, parseHHMM(slot.from), next ? parseHHMM(next.from) : 1440, {
      locationId: resolveRef(c, slot.at),
      activity: slot.activity,
      source: "routine",
      sourceId: null,
    });
  });

  const weather = world.regionWeather[c.regionId];
  const rainyDay = (weather?.day.windows.length ?? 0) > 0;
  const causes = [world.dayEventId];
  const variations: string[] = [];
  for (const v of def.routine.variations) {
    if (v.days === "weekday" && cal.weekend) continue;
    if (v.days === "weekend" && !cal.weekend) continue;
    if (v.onlyIfRainy && !rainyDay) continue;
    if (v.requiresFlag && !c.flags[v.requiresFlag]) continue;
    if (!chance(world.rng, v.chance)) continue;
    overlay(cells, parseHHMM(v.from), parseHHMM(v.to), {
      locationId: resolveRef(c, v.at),
      activity: v.activity,
      source: "variation",
      sourceId: v.id,
    });
    variations.push(v.id);
    if (v.onlyIfRainy && weather) causes.push(weather.setEventId);
    if (v.requiresFlag) causes.push(c.flags[v.requiresFlag]!);
  }

  const worldEvents: string[] = [];
  for (const id of Object.keys(world.activeWorldEvents).sort()) {
    const wev = world.content.worldEvents.find((e) => e.id === id);
    if (!wev) continue;
    for (const o of wev.routineOverrides ?? []) {
      if (!worldEventApplies(wev, c, o.who)) continue;
      overlay(cells, parseHHMM(o.from), parseHHMM(o.to), {
        locationId: resolveRef(c, o.at),
        activity: o.activity,
        source: "world_event",
        sourceId: wev.id,
      });
      if (!worldEvents.includes(wev.id)) {
        worldEvents.push(wev.id);
        causes.push(world.activeWorldEvents[id]!);
      }
    }
  }

  // A place that is closed at that time can't be visited: stay home instead.
  for (let i = 0; i < TICKS_PER_DAY; i++) {
    const cell = cells[i]!;
    if (!isOpen(getLocation(world, cell.locationId), i * TICK_MINUTES)) {
      cells[i] = {
        locationId: c.homeId,
        activity: "rest",
        source: "closed_fallback",
        sourceId: cell.locationId,
      };
    }
  }

  const segments: PlanSegment[] = [];
  for (let i = 0; i < TICKS_PER_DAY; i++) {
    const cell = cells[i]!;
    const last = segments[segments.length - 1];
    if (
      last &&
      last.locationId === cell.locationId &&
      last.activity === cell.activity &&
      last.source === cell.source &&
      last.sourceId === cell.sourceId
    ) {
      last.to = (i + 1) * TICK_MINUTES;
    } else {
      segments.push({ from: i * TICK_MINUTES, to: (i + 1) * TICK_MINUTES, ...cell });
    }
  }

  const ev = appendEvent(world, {
    type: "day_planned",
    actors: [c.id],
    location: null,
    causes,
    data: { variations, worldEvents },
  });
  c.plan = segments;
  c.planEventId = ev.id;
}

export function segmentAt(c: CharacterState, minute: number): PlanSegment | null {
  return c.plan.find((s) => minute >= s.from && minute < s.to) ?? null;
}
