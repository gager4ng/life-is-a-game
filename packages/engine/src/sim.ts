import { optionsFor, otherOf, roleOf } from "./decisions";
import { checkOverdueDebts, settleDay } from "./economy";
import { adjustMood, openSink } from "./effects";
import { detectEncounters, recordPlayerReply, resolveEncounter } from "./encounters";
import { appendEvent } from "./ledger";
import { decayMemories } from "./memory";
import { moveCharacters, updateNeeds } from "./movement";
import { worldEventApplies, planDay } from "./planning";
import { autopilotIntent, evaluateQuests } from "./quests";
import {
  TICKS_PER_DAY,
  TICK_MINUTES,
  calendar,
  dayIndex,
  dayNumber,
  minuteOfDay,
  parseHHMM,
} from "./time";
import type { LedgerEvent, PendingChoice, World } from "./types";
import { setDayWeather, updateWeather } from "./weather";
import type { Tile } from "./content-types";
import { isWalkable, regionMap } from "./map";
import { getChar, getLocation, isAt, isOpen, sortedCharacterIds } from "./world";

function startDay(world: World): void {
  const day = dayNumber(world.tick);
  const cal = calendar(world.startDate, dayIndex(world.tick));
  const ev = appendEvent(world, {
    type: "day_started",
    actors: [],
    location: null,
    causes: [world.dayEventId],
    data: { day, date: cal.iso, weekday: cal.weekdayName },
  });
  world.dayEventId = ev.id;

  // World events (the stand-in for the future daily news feed).
  for (const def of [...world.content.worldEvents].sort((a, b) => a.id.localeCompare(b.id))) {
    const active = day >= def.fromDay && day <= def.toDay;
    const started = world.activeWorldEvents[def.id];
    if (active && !started) {
      const sink = openSink(world);
      if (def.moodDelta) {
        for (const id of sortedCharacterIds(world)) {
          const c = getChar(world, id);
          if (worldEventApplies(def, c, { all: true })) adjustMood(world, sink, id, def.moodDelta);
        }
      }
      const wev = appendEvent(world, {
        type: "world_event_started",
        actors: [],
        location: null,
        causes: [ev.id],
        effects: sink.effects,
        data: { worldEventId: def.id, name: def.name, kind: def.kind, regionId: def.regionId },
      });
      world.activeWorldEvents[def.id] = wev.id;
    } else if (!active && started) {
      appendEvent(world, {
        type: "world_event_ended",
        actors: [],
        location: null,
        causes: [started, ev.id],
        data: { worldEventId: def.id, name: def.name },
      });
      delete world.activeWorldEvents[def.id];
    }
  }

  setDayWeather(world);
  decayMemories(world);
  checkOverdueDebts(world);
  for (const id of sortedCharacterIds(world)) planDay(world, getChar(world, id));
}

/** True while some human player still has to answer an encounter. */
export function hasBlockingChoices(world: World): boolean {
  return world.encounters.some((e) =>
    e.awaiting.some((cid) => {
      const pid = getChar(world, cid).controlledBy;
      return pid !== null && !world.players[pid]?.autopilot;
    }),
  );
}

export interface StepResult {
  tick: number;
  events: LedgerEvent[];
  pending: PendingChoice[];
}

/**
 * Advance the world by one 10-minute tick. Order: day start, weather, movement, needs,
 * encounters, quests, end-of-day settlement. Throws if a player still owes a reply.
 */
export function stepTick(world: World): StepResult {
  if (hasBlockingChoices(world)) {
    throw new Error("A player must reply to an encounter before the world can move on.");
  }
  const from = world.ledger.length;
  const tick = world.tick;
  if (tick % TICKS_PER_DAY === 0) startDay(world);
  updateWeather(world);
  moveCharacters(world);
  updateNeeds(world);
  detectEncounters(world);
  for (const pid of Object.keys(world.players).sort()) {
    evaluateQuests(world, pid);
    autopilotIntent(world, pid);
  }
  if (tick % TICKS_PER_DAY === TICKS_PER_DAY - 1) settleDay(world);
  world.tick += 1;
  return { tick, events: world.ledger.slice(from), pending: allPendingChoices(world) };
}

/** Run until the given tick (exclusive). Players without autopilot must not be prompted. */
export function runUntil(world: World, endTick: number, onStep?: (r: StepResult) => void): void {
  while (world.tick < endTick) {
    const r = stepTick(world);
    onStep?.(r);
  }
}

export function runDays(world: World, days: number, onStep?: (r: StepResult) => void): void {
  runUntil(world, world.tick + days * TICKS_PER_DAY, onStep);
}

export function pendingChoices(world: World, playerId: string): PendingChoice[] {
  const out: PendingChoice[] = [];
  for (const enc of world.encounters) {
    for (const cid of enc.awaiting) {
      const c = getChar(world, cid);
      if (c.controlledBy !== playerId) continue;
      out.push({
        encounterId: enc.id,
        playerId,
        characterId: cid,
        otherId: otherOf(enc, cid),
        role: roleOf(enc, cid),
        kind: enc.kind,
        subtype: enc.subtype,
        locationId: enc.locationId,
        amount: enc.amount,
        options: optionsFor(world, enc, cid),
        scene: enc.scene ?? null,
      });
    }
  }
  return out;
}

export function allPendingChoices(world: World): PendingChoice[] {
  return Object.keys(world.players)
    .sort()
    .flatMap((pid) => pendingChoices(world, pid));
}

/** A player answers an encounter. Returns the events this produced. */
export function chooseReply(
  world: World,
  playerId: string,
  encounterId: string,
  optionId: string,
): LedgerEvent[] {
  const from = world.ledger.length;
  const enc = world.encounters.find((e) => e.id === encounterId);
  if (!enc) throw new Error(`No pending encounter ${encounterId}`);
  const cid = enc.awaiting.find((id) => getChar(world, id).controlledBy === playerId);
  if (!cid) throw new Error(`Player ${playerId} has nothing to answer in ${encounterId}`);
  const option = optionsFor(world, enc, cid).find((o) => o.id === optionId);
  if (!option) throw new Error(`Option ${optionId} is not available`);
  recordPlayerReply(
    world,
    enc,
    cid,
    { tone: option.tone, action: option.action, eventId: null },
    false,
  );
  if (enc.awaiting.length === 0) {
    resolveEncounter(world, enc);
    evaluateQuests(world, playerId);
  }
  return world.ledger.slice(from);
}

/** Places a player's character can choose to go to right now. */
export function reachablePlaces(world: World, playerId: string): string[] {
  const p = world.players[playerId];
  if (!p) throw new Error(`Unknown player ${playerId}`);
  const c = getChar(world, p.characterId);
  const minute = minuteOfDay(world.tick);
  return Object.keys(c.knownLocations)
    .sort()
    .filter((id) => {
      const loc = getLocation(world, id);
      if (loc.regionId !== c.regionId || isAt(c, id)) return false;
      if (loc.type === "home" && id !== c.homeId) return false;
      return isOpen(loc, minute);
    });
}

/**
 * A player decides to go somewhere: a place they know (for `hours`, or until it closes), or a
 * spot on the street (a tile on the region's map). Their character sets off on the next tick
 * and the walk takes as long as the path is; the choice is in the ledger.
 */
export function setPlayerDestination(
  world: World,
  playerId: string,
  target: string | Tile,
  hours = 2,
): LedgerEvent {
  const p = world.players[playerId];
  if (!p) throw new Error(`Unknown player ${playerId}`);
  const c = getChar(world, p.characterId);
  let until = world.tick + Math.round((hours * 60) / TICK_MINUTES);
  if (typeof target !== "string") {
    const map = regionMap(world.content, c.regionId);
    if (!map || !isWalkable(map, target)) throw new Error(`Can't walk to ${target.join(",")}`);
    const tile: Tile = [target[0], target[1]];
    const ev = appendEvent(world, {
      type: "player_choice",
      actors: [c.id],
      location: c.locationId,
      causes: [c.arrivalEventId],
      data: { playerId, goTo: null, street: [tile[0], tile[1]], untilTick: until },
    });
    c.override = {
      locationId: c.locationId,
      tile,
      activity: "stroll",
      untilTick: until,
      eventId: ev.id,
    };
    return ev;
  }
  const locationId = target;
  if (!reachablePlaces(world, playerId).includes(locationId)) {
    throw new Error(`Can't go to ${locationId} right now`);
  }
  const loc = getLocation(world, locationId);
  if (loc.hours) {
    const minute = minuteOfDay(world.tick);
    let close = parseHHMM(loc.hours.close);
    if (close <= minute) close += 1440;
    until = Math.min(until, world.tick + Math.floor((close - minute) / TICK_MINUTES));
  }
  const ev = appendEvent(world, {
    type: "player_choice",
    actors: [c.id],
    location: c.locationId,
    causes: [c.arrivalEventId],
    data: { playerId, goTo: locationId, untilTick: until },
  });
  c.override = { locationId, activity: "visit", untilTick: until, eventId: ev.id };
  return ev;
}

/** Cancel a player's own plan and return to the daily routine. */
export function clearPlayerDestination(world: World, playerId: string): void {
  const p = world.players[playerId];
  if (!p) throw new Error(`Unknown player ${playerId}`);
  getChar(world, p.characterId).override = null;
}
