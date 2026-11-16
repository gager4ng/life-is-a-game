import type {
  CharacterDef,
  ContentBundle,
  LocationDef,
  QuestDef,
  RegionDef,
  TraitId,
  WorldEventDef,
} from "./content-types";
import { appendEvent } from "./ledger";
import { createRng } from "./rng";
import { calendar, parseHHMM } from "./time";
import type { CharacterState, PlayerState, Relationship, World } from "./types";
import { WORLD_VERSION } from "./types";
import { validateContentRefs } from "./validate";

export interface CreateWorldOptions {
  seed: number | string;
  /** ISO date of day 1. Defaults to 2026-06-01 (a Monday in the rainy season). */
  startDate?: string;
  /** Any number of human players, each controlling one playable character. */
  players?: { playerId: string; characterId: string; autopilot?: boolean }[];
  /** Replaces the content's world events (e.g. loaded from a JSON news file). */
  worldEvents?: WorldEventDef[];
}

export const DEFAULT_START_DATE = "2026-06-01";

export function createWorld(content: ContentBundle, opts: CreateWorldOptions): World {
  const bundle: ContentBundle = {
    ...content,
    worldEvents: opts.worldEvents ?? content.worldEvents,
  };
  const errors = validateContentRefs(bundle);
  if (errors.length) throw new Error(`Invalid content:\n- ${errors.join("\n- ")}`);
  const startDate = opts.startDate ?? DEFAULT_START_DATE;
  calendar(startDate, 0); // validates the date

  const world: World = {
    version: WORLD_VERSION,
    seed: String(opts.seed),
    rng: createRng(opts.seed),
    tick: 0,
    startDate,
    content: cloneJson(bundle),
    rootEventId: "",
    dayEventId: "",
    regionWeather: {},
    characters: {},
    relationships: {},
    players: {},
    encounters: [],
    quests: [],
    debts: [],
    activeWorldEvents: {},
    cooldowns: {},
    ledger: [],
    counters: { encounter: 0, memory: 0, debt: 0, quest: 0 },
  };

  const players: PlayerState[] = (opts.players ?? []).map((p) => ({
    playerId: p.playerId,
    characterId: p.characterId,
    autopilot: p.autopilot ?? false,
  }));
  const root = appendEvent(world, {
    type: "world_created",
    actors: players.map((p) => p.characterId),
    location: null,
    causes: [],
    data: { seed: world.seed, startDate, players: players.map((p) => p.playerId) },
  });
  world.rootEventId = root.id;
  world.dayEventId = root.id;

  for (const def of bundle.characters) {
    world.characters[def.id] = initialCharacter(def, root.id);
  }
  for (const p of players) {
    const c = world.characters[p.characterId];
    if (!c) throw new Error(`Player ${p.playerId}: unknown character ${p.characterId}`);
    const def = bundle.characters.find((d) => d.id === p.characterId)!;
    if (!def.playable) throw new Error(`Character ${p.characterId} is not playable`);
    if (c.controlledBy) throw new Error(`Character ${p.characterId} already has a player`);
    if (world.players[p.playerId]) throw new Error(`Duplicate player id ${p.playerId}`);
    c.controlledBy = p.playerId;
    world.players[p.playerId] = p;
  }
  for (const s of bundle.relationships) {
    const dirs: [string, string][] = s.mutual
      ? [
          [s.from, s.to],
          [s.to, s.from],
        ]
      : [[s.from, s.to]];
    for (const [from, to] of dirs) {
      const rel: Relationship = {
        from,
        to,
        trust: s.trust,
        familiarity: s.familiarity,
        respect: s.respect,
        warmth: s.warmth,
        tension: s.tension,
        lastEventId: root.id,
      };
      world.relationships[`${from}>${to}`] = rel;
    }
  }
  return world;
}

function initialCharacter(def: CharacterDef, rootId: string): CharacterState {
  const known: Record<string, string> = {};
  for (const l of [def.homeId, ...(def.job ? [def.job.workplaceId] : []), ...def.knownLocations]) {
    known[l] = rootId;
  }
  return {
    id: def.id,
    name: def.shortName,
    regionId: def.regionId,
    homeId: def.homeId,
    workplaceId: def.job?.workplaceId ?? null,
    controlledBy: null,
    traits: [...def.traits],
    items: [...def.items],
    locationId: def.homeId,
    activity: "sleep",
    arrivalEventId: rootId,
    needs: { ...def.start },
    lastMoneyEventId: rootId,
    memories: [],
    flags: {},
    knownLocations: known,
    goals: def.goals.map((g) => ({
      id: g.id,
      kind: g.kind,
      opportunity: g.opportunity ?? null,
      location: g.location ?? null,
      amount: g.amount ?? null,
      priority: g.priority,
      status: "active",
      eventId: rootId,
    })),
    offerUses: {},
    offersGiven: {},
    plan: [],
    planEventId: rootId,
    override: null,
    delay: null,
    seeking: null,
    shortOf: null,
    shelteredUntil: -1,
    busyUntil: -1,
    today: { ticksWorked: 0, trips: 0, mealsOut: 0, drinks: 0 },
  };
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function getChar(world: World, id: string): CharacterState {
  const c = world.characters[id];
  if (!c) throw new Error(`Unknown character ${id}`);
  return c;
}

export function charDef(world: World, id: string): CharacterDef {
  const d = world.content.characters.find((c) => c.id === id);
  if (!d) throw new Error(`Unknown character def ${id}`);
  return d;
}

export function getLocation(world: World, id: string): LocationDef {
  const l = world.content.locations.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown location ${id}`);
  return l;
}

export function getRegion(world: World, id: string): RegionDef {
  const r = world.content.regions.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown region ${id}`);
  return r;
}

export function getQuestDef(world: World, id: string): QuestDef {
  const q = world.content.quests.find((x) => x.id === id);
  if (!q) throw new Error(`Unknown quest ${id}`);
  return q;
}

export function sortedCharacterIds(world: World): string[] {
  return Object.keys(world.characters).sort();
}

export function isOpen(loc: LocationDef, minute: number): boolean {
  if (!loc.hours) return true;
  const open = parseHHMM(loc.hours.open);
  const close = parseHHMM(loc.hours.close);
  if (open === close) return true;
  return open < close ? minute >= open && minute < close : minute >= open || minute < close;
}

export function occupants(world: World, locationId: string): CharacterState[] {
  return sortedCharacterIds(world)
    .map((id) => world.characters[id]!)
    .filter((c) => c.locationId === locationId);
}

export function hasItem(c: CharacterState, item: string): boolean {
  return c.items.includes(item);
}

export function hasTrait(c: CharacterState, t: TraitId): boolean {
  return c.traits.includes(t);
}

export function isAsleep(c: CharacterState): boolean {
  return c.activity === "sleep";
}

export function resolveRef(c: CharacterState, ref: string): string {
  if (ref === "home") return c.homeId;
  if (ref === "work") return c.workplaceId ?? c.homeId;
  return ref;
}
