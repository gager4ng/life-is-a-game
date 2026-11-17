import type { Condition, QuestInstance, World } from "@liag/engine";
import {
  charDef,
  findOffer,
  getLocation,
  getQuestDef,
  isAt,
  isOpen,
  isWithin,
  peekRel,
  questTarget,
} from "@liag/engine";

/**
 * "What should I do next?" Everything here is read from engine state and content: the quest
 * step, who can actually help with it (their offers) and where their day plans take them.
 * Nothing is hard-coded per quest. Pure functions, unit-tested.
 */

export interface PlaceTarget {
  locationId: string;
  /** Time window the step needs, minutes of day [from, to), if any. */
  window: [number, number] | null;
  known: boolean;
}

export interface Suggestion {
  charId: string;
  name: string;
  locationId: string;
  /** Minutes of day. */
  from: number;
  to: number;
  /** The player knows the way there. */
  known: boolean;
  /** They are planned to be there right now. */
  now: boolean;
  /** They will be there later today (false = earlier today, so probably tomorrow too). */
  later: boolean;
  /** They trust the player enough for their offer (else: get to know them first). */
  trusted: boolean;
}

export interface StepGuide {
  questInstance: string;
  questTitle: string;
  objective: string;
  /** A fixed place the step needs (e.g. the live spot in the evening). */
  target: PlaceTarget | null;
  /** When the step has no fixed place: who could help, and where and when to find them. */
  suggestions: Suggestion[];
}

const KIND_ORDER = { main: 0, side: 1, emergent: 2 } as const;

/** The player's quests that are still running, main quest first. */
export function activeQuests(world: World, charId: string): QuestInstance[] {
  return world.quests
    .filter((q) => q.characterId === charId && q.status === "active")
    .sort(
      (a, b) =>
        KIND_ORDER[getQuestDef(world, a.questId).kind] -
          KIND_ORDER[getQuestDef(world, b.questId).kind] ||
        a.instanceId.localeCompare(b.instanceId),
    );
}

/** Flags a condition is waiting for (has_flag anywhere inside it). */
export function flagsWanted(cond: Condition): string[] {
  if (cond.type === "has_flag") return [cond.flag];
  if (cond.type === "all" || cond.type === "any") return cond.of.flatMap(flagsWanted);
  return [];
}

/**
 * Who can grant one of these flags (an offer they still have for this player), and where their
 * plan for today takes them. Other people's homes and sleep are left out. Ordered: there now,
 * later today, then earlier today; places the player knows first.
 */
export function suggestionsFor(
  world: World,
  charId: string,
  flags: string[],
  minute: number,
): Suggestion[] {
  const me = world.characters[charId]!;
  const out: Suggestion[] = [];
  for (const id of Object.keys(world.characters).sort()) {
    if (id === charId) continue;
    const c = world.characters[id]!;
    if (c.regionId !== me.regionId) continue;
    const offers = charDef(world, id).offers.filter(
      (o) => flags.includes(o.grantsFlag) && findOffer(world, c, charId, o.kind)?.id === o.id,
    );
    if (!offers.length) continue;
    const rel = peekRel(world, id, charId);
    // The engine's hard rule: a competitive rival chasing the same break says no.
    const rival = offers.every(
      (o) =>
        c.traits.includes("competitive") &&
        rel.warmth < 30 &&
        c.goals.some(
          (g) => g.status === "active" && g.kind === "seek_opportunity" && g.opportunity === o.kind,
        ),
    );
    if (rival) continue;
    const trusted = offers.some((o) => rel.trust >= o.minTrust);
    const seen = new Map<string, Suggestion>();
    for (const seg of c.plan) {
      if (seg.activity === "sleep") continue;
      const loc = getLocation(world, seg.locationId);
      if (loc.type === "home" && seg.locationId !== me.homeId) continue;
      const prev = seen.get(seg.locationId);
      const now = minute >= seg.from && minute < seg.to;
      const later = seg.from > minute;
      // Keep the most useful stretch per place: now > later today > earlier today.
      const rank = (s: { now: boolean; later: boolean }): number => (s.now ? 0 : s.later ? 1 : 2);
      const cand: Suggestion = {
        charId: id,
        name: c.name,
        locationId: seg.locationId,
        from: seg.from,
        to: seg.to,
        known: Boolean(me.knownLocations[seg.locationId]),
        now,
        later,
        trusted,
      };
      if (!prev || rank(cand) < rank(prev)) seen.set(seg.locationId, cand);
      else if (prev.to === seg.from && rank(cand) === rank(prev)) prev.to = seg.to;
    }
    out.push(...seen.values());
  }
  // Chats about a break are likelier at the buka and the music venue (as in the engine).
  const lively = (s: Suggestion): boolean => {
    const type = getLocation(world, s.locationId).type;
    return type === "buka" || type === "music_venue";
  };
  const rank = (s: Suggestion): number =>
    (s.now ? 0 : s.later ? 10 : 20) + (s.known ? 0 : 5) + (s.trusted ? 0 : 3) + (lively(s) ? 0 : 1);
  return out.sort(
    (a, b) => rank(a) - rank(b) || a.from - b.from || a.locationId.localeCompare(b.locationId),
  );
}

/** What the current step of the player's top quest needs, in a form the HUD can show. */
export function stepGuide(world: World, charId: string, minute: number): StepGuide | null {
  const q = activeQuests(world, charId)[0];
  if (!q) return null;
  const def = getQuestDef(world, q.questId);
  const step = def.steps.find((s) => s.id === q.stepId);
  if (!step) return null;
  const me = world.characters[charId]!;
  const t = questTarget(world, q);
  const target: PlaceTarget | null = t
    ? {
        locationId: t.locationId,
        window: t.window,
        known: Boolean(me.knownLocations[t.locationId]),
      }
    : null;
  const cond = step.kind === "condition" ? step.completeWhen : step.attemptWhen;
  const suggestions = target ? [] : suggestionsFor(world, charId, flagsWanted(cond), minute);
  return {
    questInstance: q.instanceId,
    questTitle: def.title,
    objective: step.objective,
    target,
    suggestions,
  };
}

/** The place the HUD arrow and "Show me" point at: the step's place, or the best suggestion. */
export function focusPlace(g: StepGuide | null): string | null {
  if (!g) return null;
  if (g.target) return g.target.known ? g.target.locationId : null;
  return g.suggestions.find((s) => s.known)?.locationId ?? null;
}

export interface Hint {
  /** Key into ui/web.json. */
  key: string;
  vars: Record<string, string | number>;
  /** Where the hint wants you to go, if anywhere. */
  locationId: string | null;
}

const hhmm = (m: number): string =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * One gentle, concrete suggestion for what to do next. `walk` gives walking minutes to a place
 * (null if unknown). Returns null when there is nothing sensible to suggest (asleep, talking).
 */
export function nextHint(
  world: World,
  charId: string,
  minute: number,
  walk: (locationId: string) => number | null,
): Hint | null {
  const me = world.characters[charId]!;
  if (me.activity === "sleep" && !me.travel) return null;
  if (world.encounters.some((e) => e.awaiting.includes(charId))) return null;
  const g = stepGuide(world, charId, minute);
  if (!g) return { key: "hint.explore", vars: {}, locationId: null };
  const mins = (id: string): number => Math.max(1, Math.round(walk(id) ?? 0));
  if (g.target) {
    const id = g.target.locationId;
    const place = getLocation(world, id).name;
    if (!g.target.known) return { key: "hint.unknownPlace", vars: { place }, locationId: null };
    if (isAt(me, id)) {
      return g.target.window && !isWithin(minute, g.target.window[0], g.target.window[1])
        ? { key: "hint.waitHere", vars: { place, from: hhmm(g.target.window[0]) }, locationId: id }
        : { key: "hint.atTarget", vars: { place }, locationId: id };
    }
    if (g.target.window && !isWithin(minute, g.target.window[0], g.target.window[1]))
      return {
        key: "hint.beThereAt",
        vars: { place, from: hhmm(g.target.window[0]), mins: mins(id) },
        locationId: id,
      };
    if (!isOpen(getLocation(world, id), minute))
      return { key: "hint.closed", vars: { place }, locationId: id };
    return { key: "hint.goTo", vars: { place, mins: mins(id) }, locationId: id };
  }
  const s = g.suggestions.find((x) => x.known);
  if (s) {
    const place = getLocation(world, s.locationId).name;
    if (isAt(me, s.locationId) && s.now)
      return { key: "hint.waitFor", vars: { name: s.name, place }, locationId: s.locationId };
    if (s.now)
      return {
        key: "hint.meetNow",
        vars: { name: s.name, place, mins: mins(s.locationId) },
        locationId: s.locationId,
      };
    return {
      key: "hint.meetLater",
      vars: { name: s.name, place, from: hhmm(s.from), mins: mins(s.locationId) },
      locationId: s.locationId,
    };
  }
  const anyone = g.suggestions[0];
  if (anyone) return { key: "hint.askAround", vars: { name: anyone.name }, locationId: null };
  return { key: "hint.explore", vars: {}, locationId: null };
}

/** Steps of a quest the player has already done, oldest first (from the ledger). */
export function doneSteps(world: World, inst: QuestInstance): string[] {
  const def = getQuestDef(world, inst.questId);
  const out: string[] = [];
  for (const ev of world.ledger) {
    if (ev.type !== "quest_step" || ev.data.instanceId !== inst.instanceId) continue;
    const step = def.steps.find((s) => s.id === ev.data.completedStep);
    if (step) out.push(step.objective);
  }
  return out;
}

export { hhmm };
