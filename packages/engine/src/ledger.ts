import type { Effect, EventType, JsonValue, LedgerEvent, World } from "./types";

export interface NewEvent {
  type: EventType;
  actors: string[];
  location: string | null;
  causes: string[];
  effects?: Effect[];
  data?: { [key: string]: JsonValue };
}

export const eventIdForSeq = (seq: number): string => `e${seq}`;
export const seqOf = (id: string): number => Number(id.slice(1));

/** The id the next appended event will get. Lets effects reference their own event. */
export function nextEventId(world: World): string {
  return eventIdForSeq(world.ledger.length + 1);
}

/**
 * Append-only. Every event except world_created must name at least one earlier cause,
 * so any outcome can be traced back to the start of the world.
 */
export function appendEvent(world: World, e: NewEvent): LedgerEvent {
  const seq = world.ledger.length + 1;
  const causes = [...new Set(e.causes)];
  if (e.type !== "world_created" && causes.length === 0) {
    throw new Error(`Ledger: ${e.type} event has no causes`);
  }
  for (const c of causes) {
    const cs = seqOf(c);
    if (!Number.isInteger(cs) || cs < 1 || cs >= seq) {
      throw new Error(`Ledger: ${e.type} cites unknown or later cause ${c}`);
    }
  }
  const ev: LedgerEvent = {
    id: eventIdForSeq(seq),
    seq,
    tick: world.tick,
    type: e.type,
    actors: e.actors,
    location: e.location,
    causes,
    effects: e.effects ?? [],
    data: e.data ?? {},
  };
  world.ledger.push(ev);
  return ev;
}

export function getEvent(world: World, id: string): LedgerEvent {
  const ev = world.ledger[seqOf(id) - 1];
  if (!ev || ev.id !== id) throw new Error(`Ledger: no event ${id}`);
  return ev;
}

/** Every event reachable backwards through cause ids (including the start event). */
export function traceCauses(world: World, id: string): LedgerEvent[] {
  const seen = new Set<string>();
  const out: LedgerEvent[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const ev = getEvent(world, cur);
    out.push(ev);
    stack.push(...ev.causes);
  }
  return out.sort((a, b) => a.seq - b.seq);
}
