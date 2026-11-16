import type { ChanceSpec, Condition, TraitId } from "./content-types";
import { available, openDebts } from "./economy";
import { peekRel } from "./effects";
import { dayNumber, minuteOfDay, parseHHMM, isWithin } from "./time";
import type { CharacterState, World } from "./types";
import { clamp } from "./util";
import { currentWeather, weatherEventId } from "./weather";
import { getChar, hasTrait, isAsleep } from "./world";

export interface CondResult {
  ok: boolean;
  /** Ledger ids of the facts that made it true. */
  causes: string[];
}

const NO: CondResult = { ok: false, causes: [] };

export function bind(value: string, bindings: Record<string, string>): string {
  return value.startsWith("$") ? (bindings[value.slice(1)] ?? value) : value;
}

/** Evaluate a quest condition for a character; returns the events that make it true. */
export function evalCondition(
  world: World,
  c: CharacterState,
  cond: Condition,
  bindings: Record<string, string>,
): CondResult {
  switch (cond.type) {
    case "all": {
      const causes: string[] = [];
      for (const sub of cond.of) {
        const r = evalCondition(world, c, sub, bindings);
        if (!r.ok) return NO;
        causes.push(...r.causes);
      }
      return { ok: true, causes };
    }
    case "any": {
      for (const sub of cond.of) {
        const r = evalCondition(world, c, sub, bindings);
        if (r.ok) return r;
      }
      return NO;
    }
    case "not":
      return evalCondition(world, c, cond.of, bindings).ok ? NO : { ok: true, causes: [] };
    case "has_flag": {
      const ev = c.flags[bind(cond.flag, bindings)];
      return ev ? { ok: true, causes: [ev] } : NO;
    }
    case "money_at_least":
      return available(world, c) >= cond.amount ? { ok: true, causes: [c.lastMoneyEventId] } : NO;
    case "relationship": {
      const other = bind(cond.with, bindings);
      const rel = peekRel(world, other, c.id);
      const v = rel[cond.dim];
      if (cond.atLeast !== undefined && v < cond.atLeast) return NO;
      if (cond.atMost !== undefined && v > cond.atMost) return NO;
      return { ok: true, causes: [rel.lastEventId] };
    }
    case "at_location":
      return c.locationId === bind(cond.location, bindings)
        ? { ok: true, causes: [c.arrivalEventId] }
        : NO;
    case "time_between":
      return isWithin(minuteOfDay(world.tick), parseHHMM(cond.from), parseHHMM(cond.to))
        ? { ok: true, causes: [] }
        : NO;
    case "present": {
      const other = world.characters[bind(cond.character, bindings)];
      if (!other || other.locationId !== c.locationId || isAsleep(other)) return NO;
      return { ok: true, causes: [other.arrivalEventId] };
    }
    case "day_at_least":
      return dayNumber(world.tick) >= cond.day ? { ok: true, causes: [world.dayEventId] } : NO;
    case "owes_money": {
      const debt = openDebts(world, c.id, cond.to ? bind(cond.to, bindings) : undefined)[0];
      return debt ? { ok: true, causes: [debt.eventId] } : NO;
    }
    case "debt_repaid": {
      const debt = world.debts.find((d) => d.id === bind(cond.debt, bindings));
      return debt && debt.status === "repaid" && debt.settledEventId
        ? { ok: true, causes: [debt.settledEventId] }
        : NO;
    }
    case "weather":
      return cond.is.includes(currentWeather(world, c.regionId))
        ? { ok: true, causes: [weatherEventId(world, c.regionId)] }
        : NO;
    case "world_event_active": {
      const ev = world.activeWorldEvents[cond.id];
      return ev ? { ok: true, causes: [ev] } : NO;
    }
    case "knows_location": {
      const ev = c.knownLocations[bind(cond.location, bindings)];
      return ev ? { ok: true, causes: [ev] } : NO;
    }
  }
}

/** Probability (0..1) of a quest check succeeding, from traits, relationships and needs. */
export function checkChance(
  world: World,
  c: CharacterState,
  spec: ChanceSpec,
  bindings: Record<string, string>,
): number {
  let p = spec.base;
  for (const [trait, bonus] of Object.entries(spec.traits ?? {})) {
    if (hasTrait(c, trait as TraitId)) p += bonus ?? 0;
  }
  if (spec.relationship) {
    const other = getChar(world, bind(spec.relationship.with, bindings));
    p += peekRel(world, other.id, c.id)[spec.relationship.dim] * spec.relationship.per;
  }
  if (spec.moodAbove && c.needs.mood > spec.moodAbove.value) p += spec.moodAbove.bonus;
  if (spec.energyBelow && c.needs.energy < spec.energyBelow.value) p -= spec.energyBelow.penalty;
  return clamp(p, spec.min, spec.max) / 100;
}

/** Find the place (and optional time window) a condition asks the character to be. */
export function locationTarget(
  cond: Condition,
  bindings: Record<string, string>,
): { locationId: string; window: [number, number] | null } | null {
  if (cond.type === "at_location")
    return { locationId: bind(cond.location, bindings), window: null };
  if (cond.type === "all" || cond.type === "any") {
    let loc: string | null = null;
    let window: [number, number] | null = null;
    for (const sub of cond.of) {
      if (sub.type === "time_between") window = [parseHHMM(sub.from), parseHHMM(sub.to)];
      const t = locationTarget(sub, bindings);
      if (t && !loc) {
        loc = t.locationId;
        window = window ?? t.window;
      }
    }
    return loc ? { locationId: loc, window } : null;
  }
  return null;
}
