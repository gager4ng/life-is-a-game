import type { RelDim } from "./content-types";
import { nextEventId } from "./ledger";
import type { Effect, Relationship, World } from "./types";
import { REL_BOUNDS } from "./types";
import { clamp, round2 } from "./util";
import { getChar } from "./world";

/**
 * Collects the effects of one ledger event. Every state change that matters (money,
 * relationships, memories, flags…) goes through a sink, so the ledger records it.
 * The sink knows the id its event will get; append that event right after using it.
 */
export interface Sink {
  eventId: string;
  effects: Effect[];
}

export function openSink(world: World): Sink {
  return { eventId: nextEventId(world), effects: [] };
}

export const relKey = (from: string, to: string): string => `${from}>${to}`;

/** How `from` sees `to`. Strangers read as all zeros; nothing is stored until something happens. */
export function peekRel(world: World, from: string, to: string): Readonly<Relationship> {
  return (
    world.relationships[relKey(from, to)] ?? {
      from,
      to,
      trust: 0,
      familiarity: 0,
      respect: 0,
      warmth: 0,
      tension: 0,
      lastEventId: world.rootEventId,
    }
  );
}

export function adjustRel(
  world: World,
  sink: Sink,
  from: string,
  to: string,
  deltas: Partial<Record<RelDim, number>>,
): void {
  if (from === to) return;
  const key = relKey(from, to);
  let rel = world.relationships[key];
  for (const dim of Object.keys(deltas).sort() as RelDim[]) {
    const delta = Math.round(deltas[dim] ?? 0);
    if (delta === 0) continue;
    if (!rel) {
      rel = { ...peekRel(world, from, to) };
      world.relationships[key] = rel;
    }
    const [lo, hi] = REL_BOUNDS[dim];
    const before = rel[dim];
    const after = clamp(before + delta, lo, hi);
    if (after === before) continue;
    rel[dim] = after;
    rel.lastEventId = sink.eventId;
    sink.effects.push({ kind: "relationship", from, to, dim, delta: after - before, value: after });
  }
}

export function changeMoney(world: World, sink: Sink, who: string, delta: number): void {
  const c = getChar(world, who);
  const d = Math.round(delta);
  if (d === 0) return;
  const after = c.needs.money + d;
  if (after < 0) throw new Error(`Money for ${who} would go negative (${after})`);
  c.needs.money = after;
  c.lastMoneyEventId = sink.eventId;
  sink.effects.push({ kind: "money", who, delta: d, value: after });
}

export function transferMoney(
  world: World,
  sink: Sink,
  from: string,
  to: string,
  amount: number,
): void {
  changeMoney(world, sink, from, -amount);
  changeMoney(world, sink, to, amount);
}

export function adjustMood(world: World, sink: Sink, who: string, delta: number): void {
  const c = getChar(world, who);
  const before = c.needs.mood;
  const after = round2(clamp(before + delta, 0, 100));
  if (after === before) return;
  c.needs.mood = after;
  sink.effects.push({ kind: "mood", who, delta: round2(after - before), value: after });
}

export function adjustEnergy(world: World, sink: Sink, who: string, delta: number): void {
  const c = getChar(world, who);
  const before = c.needs.energy;
  const after = round2(clamp(before + delta, 0, 100));
  if (after === before) return;
  c.needs.energy = after;
  sink.effects.push({ kind: "energy", who, delta: round2(after - before), value: after });
}

export function setFlag(world: World, sink: Sink, who: string, flag: string): void {
  const c = getChar(world, who);
  if (c.flags[flag]) return;
  c.flags[flag] = sink.eventId;
  sink.effects.push({ kind: "flag", who, flag });
}

export function learnLocation(world: World, sink: Sink, who: string, locationId: string): void {
  const c = getChar(world, who);
  if (c.knownLocations[locationId]) return;
  c.knownLocations[locationId] = sink.eventId;
  sink.effects.push({ kind: "knows_location", who, locationId });
}
