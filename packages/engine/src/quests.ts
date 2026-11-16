import type { QuestDef, QuestEffects } from "./content-types";
import { bind, checkChance, evalCondition, locationTarget } from "./conditions";
import { openDebts } from "./economy";
import type { Sink } from "./effects";
import { adjustMood, adjustRel, changeMoney, openSink, setFlag } from "./effects";
import { learnPlace } from "./encounters";
import { appendEvent } from "./ledger";
import { chance } from "./rng";
import { TICKS_PER_DAY, TICK_MINUTES, dayIndex, minuteOfDay, isWithin } from "./time";
import type {
  CharacterState,
  EventType,
  JsonValue,
  PlayerState,
  QuestInstance,
  World,
} from "./types";
import { uniq } from "./util";
import { getChar, getLocation, getQuestDef, isAt, isOpen } from "./world";

const KIND_ORDER = { main: 0, side: 1, emergent: 2 } as const;
const MAX_TRANSITIONS_PER_TICK = 6;

export function questsFor(world: World, playerId: string): QuestInstance[] {
  return world.quests.filter((q) => q.playerId === playerId);
}

function applyQuestEffects(
  world: World,
  sink: Sink,
  c: CharacterState,
  fx: QuestEffects | undefined,
  bindings: Record<string, string>,
): void {
  if (!fx) return;
  if (fx.money) changeMoney(world, sink, c.id, fx.money);
  if (fx.mood) adjustMood(world, sink, c.id, fx.mood);
  for (const f of fx.flags ?? []) setFlag(world, sink, c.id, bind(f, bindings));
  for (const r of fx.relationships ?? []) {
    adjustRel(world, sink, bind(r.with, bindings), c.id, { [r.dim]: r.delta });
  }
  if (fx.revealLocation) learnPlace(world, sink, c, bind(fx.revealLocation, bindings));
}

function questEvent(
  world: World,
  inst: QuestInstance,
  type: EventType,
  causes: string[],
  sink: Sink,
  data: { [k: string]: JsonValue },
): void {
  sink.effects.push({
    kind: "quest",
    playerId: inst.playerId,
    instanceId: inst.instanceId,
    questId: inst.questId,
    status: inst.status,
    stepId: inst.stepId,
  });
  const c = getChar(world, inst.characterId);
  const ev = appendEvent(world, {
    type,
    actors: [inst.characterId],
    location: c.locationId,
    causes: uniq([inst.lastEventId, ...causes]),
    effects: sink.effects,
    data: { questId: inst.questId, instanceId: inst.instanceId, stepId: inst.stepId, ...data },
  });
  inst.lastEventId = ev.id;
}

/** Possible bindings for a quest (emergent quests bind world facts such as a debt). */
function candidateBindings(
  world: World,
  def: QuestDef,
  c: CharacterState,
): Record<string, string>[] {
  if (def.bind === "debt") {
    return openDebts(world, c.id).map((d) => ({ debt: d.id, creditor: d.creditor }));
  }
  return [{}];
}

function startQuests(world: World, p: PlayerState, c: CharacterState): void {
  const defs = [...world.content.quests].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id),
  );
  for (const def of defs) {
    const mine = world.quests.filter((q) => q.playerId === p.playerId && q.questId === def.id);
    if (mine.some((q) => q.status === "active")) continue;
    if (mine.length > 0 && !def.repeatable) continue;
    for (const bindings of candidateBindings(world, def, c)) {
      const key = JSON.stringify(bindings);
      if (mine.some((q) => JSON.stringify(q.bindings) === key)) continue;
      const causes: string[] = [];
      let ok = true;
      for (const pre of def.prerequisites) {
        const r = evalCondition(world, c, pre, bindings);
        if (!r.ok) {
          ok = false;
          break;
        }
        causes.push(...r.causes);
      }
      if (!ok) continue;
      world.counters.quest += 1;
      let deadlineTick: number | null = null;
      if (def.deadline?.day) deadlineTick = def.deadline.day * TICKS_PER_DAY;
      if (def.deadline?.daysAfterStart) {
        const rel = world.tick + def.deadline.daysAfterStart * TICKS_PER_DAY;
        deadlineTick = deadlineTick === null ? rel : Math.min(deadlineTick, rel);
      }
      const inst: QuestInstance = {
        instanceId: `q${world.counters.quest}`,
        questId: def.id,
        playerId: p.playerId,
        characterId: c.id,
        status: "active",
        stepId: def.startStep,
        startedTick: world.tick,
        lastEventId: causes[0] ?? world.dayEventId,
        attempts: {},
        nextAttemptTick: 0,
        bindings,
        deadlineTick,
      };
      world.quests.push(inst);
      questEvent(world, inst, "quest_started", [...causes, world.dayEventId], openSink(world), {
        kind: def.kind,
        bindings,
        deadlineTick,
      });
      break; // one new instance per quest per tick
    }
  }
}

function finish(
  world: World,
  inst: QuestInstance,
  def: QuestDef,
  c: CharacterState,
  goto: "complete" | "fail",
  causes: string[],
  reason: string,
): void {
  const sink = openSink(world);
  if (goto === "complete") {
    inst.status = "completed";
    applyQuestEffects(world, sink, c, def.rewards, inst.bindings);
    questEvent(world, inst, "quest_completed", causes, sink, { reason });
  } else {
    inst.status = "failed";
    applyQuestEffects(world, sink, c, def.failurePenalty, inst.bindings);
    questEvent(world, inst, "quest_failed", causes, sink, { reason });
  }
}

/** Move to the next step, or finish. Returns true if the quest is still active. */
function go(
  world: World,
  inst: QuestInstance,
  def: QuestDef,
  c: CharacterState,
  goto: string,
  causes: string[],
  reason: string,
): boolean {
  if (goto === "complete" || goto === "fail") {
    finish(world, inst, def, c, goto, causes, reason);
    return false;
  }
  inst.stepId = goto;
  return true;
}

function progress(world: World, inst: QuestInstance, def: QuestDef, c: CharacterState): void {
  for (let n = 0; n < MAX_TRANSITIONS_PER_TICK && inst.status === "active"; n++) {
    if (inst.deadlineTick !== null && world.tick >= inst.deadlineTick) {
      finish(world, inst, def, c, "fail", [world.dayEventId], "deadline");
      return;
    }
    for (const fw of def.failWhen) {
      const r = evalCondition(world, c, fw, inst.bindings);
      if (r.ok) {
        finish(world, inst, def, c, "fail", r.causes, "condition");
        return;
      }
    }
    const step = def.steps.find((s) => s.id === inst.stepId);
    if (!step) throw new Error(`Quest ${def.id}: missing step ${inst.stepId}`);
    if (step.kind === "condition") {
      const r = evalCondition(world, c, step.completeWhen, inst.bindings);
      if (!r.ok) return;
      let goto = "fail";
      const causes = [...r.causes];
      for (const b of step.next) {
        if (!b.when) {
          goto = b.goto;
          break;
        }
        const br = evalCondition(world, c, b.when, inst.bindings);
        if (br.ok) {
          goto = b.goto;
          causes.push(...br.causes);
          break;
        }
      }
      const sink = openSink(world);
      applyQuestEffects(world, sink, c, step.effects, inst.bindings);
      const from = step.id;
      questEvent(world, inst, "quest_step", causes, sink, { completedStep: from, next: goto });
      if (!go(world, inst, def, c, goto, [inst.lastEventId], `step:${from}`)) return;
    } else {
      if (world.tick < inst.nextAttemptTick) return;
      const r = evalCondition(world, c, step.attemptWhen, inst.bindings);
      if (!r.ok) return;
      const attempt = (inst.attempts[step.id] ?? 0) + 1;
      inst.attempts[step.id] = attempt;
      const p = checkChance(world, c, step.chance, inst.bindings);
      const success = chance(world.rng, p);
      const sink = openSink(world);
      if (success) applyQuestEffects(world, sink, c, step.effects, inst.bindings);
      const goto = success
        ? step.onSuccess
        : attempt >= step.maxAttempts
          ? step.onExhausted
          : step.onFailure;
      questEvent(world, inst, "quest_check", r.causes, sink, {
        check: step.id,
        attempt,
        maxAttempts: step.maxAttempts,
        chance: Math.round(p * 100),
        success,
        next: goto,
      });
      if (!success) inst.nextAttemptTick = world.tick + step.retryAfterTicks;
      if (
        !go(
          world,
          inst,
          def,
          c,
          goto,
          [inst.lastEventId],
          success ? "check_passed" : "check_failed",
        )
      )
        return;
      if (!success) return;
    }
  }
}

/** Start any quests whose prerequisites now hold, then move active ones forward. */
export function evaluateQuests(world: World, playerId: string): void {
  const p = world.players[playerId];
  if (!p) throw new Error(`Unknown player ${playerId}`);
  const c = getChar(world, p.characterId);
  startQuests(world, p, c);
  const active = world.quests
    .filter((q) => q.playerId === playerId && q.status === "active")
    .sort((a, b) => {
      const da = getQuestDef(world, a.questId);
      const db = getQuestDef(world, b.questId);
      return KIND_ORDER[da.kind] - KIND_ORDER[db.kind] || a.instanceId.localeCompare(b.instanceId);
    });
  for (const inst of active) progress(world, inst, getQuestDef(world, inst.questId), c);
}

/** Where the current step of a quest wants the player to be (for hints and autopilot). */
export function questTarget(
  world: World,
  inst: QuestInstance,
): { locationId: string; window: [number, number] | null } | null {
  const def = getQuestDef(world, inst.questId);
  const step = def.steps.find((s) => s.id === inst.stepId);
  if (!step) return null;
  return locationTarget(
    step.kind === "condition" ? step.completeWhen : step.attemptWhen,
    inst.bindings,
  );
}

/**
 * Autopilot for a player character: when a quest step needs them somewhere they know, at a time
 * it's open, they head there. Logged as a player_intent so arrivals stay traceable.
 */
export function autopilotIntent(world: World, playerId: string): void {
  const p = world.players[playerId];
  if (!p || !p.autopilot) return;
  const c = getChar(world, p.characterId);
  if (c.activity === "sleep" || c.override) return;
  const minute = minuteOfDay(world.tick);
  if (minute >= 22 * 60 || minute < 6 * 60) return;
  const active = world.quests
    .filter((q) => q.playerId === playerId && q.status === "active")
    .sort((a, b) => {
      const da = getQuestDef(world, a.questId);
      const db = getQuestDef(world, b.questId);
      return KIND_ORDER[da.kind] - KIND_ORDER[db.kind] || a.instanceId.localeCompare(b.instanceId);
    });
  for (const inst of active) {
    if (world.tick < inst.nextAttemptTick) continue;
    const target = questTarget(world, inst);
    if (!target || isAt(c, target.locationId)) continue;
    if (target.window && !isWithin(minute, target.window[0], target.window[1])) continue;
    const loc = getLocation(world, target.locationId);
    if (!isOpen(loc, minute)) continue;
    let until = world.tick + 18;
    if (target.window) {
      const end = target.window[1] <= minute ? target.window[1] + 1440 : target.window[1];
      until = dayIndex(world.tick) * TICKS_PER_DAY + Math.ceil(end / TICK_MINUTES);
    }
    const ev = appendEvent(world, {
      type: "player_intent",
      actors: [c.id],
      location: c.locationId,
      causes: [inst.lastEventId],
      data: { playerId, questId: inst.questId, locationId: target.locationId, auto: true },
    });
    c.override = {
      locationId: target.locationId,
      activity: "quest",
      untilTick: until,
      eventId: ev.id,
    };
    return;
  }
}
