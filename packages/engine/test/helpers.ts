import type { ContentBundle } from "../src/content-types";
import { startEncounter } from "../src/encounters";
import type { EncounterKind, EncounterSubtype, LedgerEvent, World } from "../src/types";
import { createWorld, getChar, getLocation } from "../src/world";
import { fixture } from "./fixture";

export function testWorld(
  opts: {
    players?: { playerId: string; characterId: string; autopilot?: boolean }[];
    content?: ContentBundle;
    seed?: number;
  } = {},
): World {
  return createWorld(opts.content ?? fixture(), {
    seed: opts.seed ?? 1,
    players: opts.players ?? [],
  });
}

/** Put two characters awake in the same place and start an encounter between them. */
export function meet(
  world: World,
  askerId: string,
  giverId: string,
  kind: EncounterKind,
  subtype: EncounterSubtype,
  extra: { amount?: number; targetLocation?: string; at?: string } = {},
): void {
  const at = extra.at ?? "t_park";
  for (const id of [askerId, giverId]) {
    const c = getChar(world, id);
    c.locationId = at;
    c.activity = "hustle";
  }
  startEncounter(world, {
    kind,
    subtype,
    asker: getChar(world, askerId),
    giver: getChar(world, giverId),
    loc: getLocation(world, at),
    causes: [world.rootEventId],
    amount: extra.amount ?? null,
    targetLocation: extra.targetLocation ?? null,
  });
}

export function lastOf(world: World, type: string): LedgerEvent {
  const ev = [...world.ledger].reverse().find((e) => e.type === type);
  if (!ev) throw new Error(`no ${type} event`);
  return ev;
}
