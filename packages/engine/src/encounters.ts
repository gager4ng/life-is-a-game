import type { LocationDef, LocationType, OpportunityKind, Tone } from "./content-types";
import { autoReply, findOffer, npcDecide } from "./decisions";
import { available, createDebt, openDebts, repayDebt } from "./economy";
import type { Sink } from "./effects";
import { adjustMood, adjustRel, learnLocation, openSink, peekRel, setFlag } from "./effects";
import { appendEvent } from "./ledger";
import { SHAREABLE, addMemory } from "./memory";
import { chance } from "./rng";
import { TICK_MINUTES, isNight, minuteOfDay } from "./time";
import type {
  CharacterState,
  DialogueLine,
  Encounter,
  EncounterKind,
  EncounterReply,
  EncounterSubtype,
  World,
} from "./types";
import { clamp, pairKey } from "./util";
import { currentWeather, isRain, rainEndsAt, weatherEventId } from "./weather";
import { getChar, getLocation, hasItem, hasTrait, isAsleep, sortedCharacterIds } from "./world";

// ---------------------------------------------------------------------------
// Collision of worlds: who is in the same place at the same time, and does anything happen?
// ---------------------------------------------------------------------------

const PASSING_BASE: Record<LocationType, number> = {
  home: 0.03,
  workplace: 0.012,
  market: 0.01,
  buka: 0.04,
  transport_hub: 0.02,
  music_venue: 0.04,
  school: 0.02,
};

const COOLDOWN_TICKS = { passing: 48, help: 72, opportunity: 288 };

type Need =
  | { kind: "help"; subtype: "transport_money" | "chop_money"; amount: number; causeId: string }
  | { kind: "help"; subtype: "umbrella"; causeId: string }
  | { kind: "help"; subtype: "directions"; target: string; causeId: string }
  | { kind: "opportunity"; subtype: OpportunityKind; causeId: string };

function isFree(world: World, c: CharacterState): boolean {
  if (isAsleep(c) || c.busyUntil > world.tick) return false;
  return !world.encounters.some((e) => e.askerId === c.id || e.giverId === c.id);
}

function needsOf(world: World, c: CharacterState, loc: LocationDef): Need[] {
  const out: Need[] = [];
  if (c.shortOf && c.shortOf.locationId === loc.id) {
    out.push({
      kind: "help",
      subtype: c.shortOf.kind,
      amount: c.shortOf.amount,
      causeId: c.shortOf.eventId,
    });
  }
  const w = currentWeather(world, c.regionId);
  if (loc.outdoor && isRain(w) && !hasItem(c, "umbrella") && c.shelteredUntil <= world.tick) {
    out.push({ kind: "help", subtype: "umbrella", causeId: weatherEventId(world, c.regionId) });
  }
  if (c.seeking) {
    out.push({
      kind: "help",
      subtype: "directions",
      target: c.seeking.locationId,
      causeId: c.seeking.causeId,
    });
  }
  const goals = [...c.goals]
    .filter((g) => g.status === "active")
    .sort((a, b) => b.priority - a.priority);
  for (const g of goals) {
    if (g.kind === "learn_place" && g.location && !c.knownLocations[g.location]) {
      out.push({ kind: "help", subtype: "directions", target: g.location, causeId: g.eventId });
    }
    if (g.kind === "seek_opportunity" && g.opportunity) {
      out.push({ kind: "opportunity", subtype: g.opportunity, causeId: g.eventId });
    }
  }
  return out;
}

function canHelp(world: World, helper: CharacterState, asker: CharacterState, need: Need): boolean {
  switch (need.subtype) {
    case "transport_money":
    case "chop_money":
      return !helper.shortOf;
    case "umbrella":
      return hasItem(helper, "umbrella");
    case "directions":
      return Boolean(helper.knownLocations[need.target]);
    default:
      return findOffer(world, helper, asker.id, need.subtype) !== null;
  }
}

function needChance(
  world: World,
  asker: CharacterState,
  helper: CharacterState,
  need: Need,
  loc: LocationDef,
): number {
  const base: Record<string, number> = {
    transport_money: 0.5,
    chop_money: 0.35,
    umbrella: currentWeather(world, asker.regionId) === "heavy_rain" ? 0.45 : 0.35,
    directions: 0.4,
  };
  let p = base[need.subtype] ?? 0.05;
  const fam = peekRel(world, asker.id, helper.id).familiarity;
  p *= 1 + fam / 50;
  if (hasTrait(asker, "shy")) p *= 0.6;
  if (hasTrait(asker, "sociable")) p *= 1.2;
  if (need.kind === "help" && need.subtype !== "directions" && hasTrait(asker, "proud")) p *= 0.6;
  if (need.subtype === "directions" && hasTrait(asker, "curious")) p *= 1.3;
  if (need.kind === "opportunity") {
    if (hasTrait(asker, "ambitious")) p *= 1.5;
    if (loc.type === "buka" || loc.type === "music_venue") p *= 1.5;
  }
  if (helper.needs.energy < 15) p *= 0.5;
  return clamp(p, 0, 0.9);
}

function passingChance(
  world: World,
  a: CharacterState,
  b: CharacterState,
  loc: LocationDef,
  crowd: number,
  boost: number,
): number {
  let p = PASSING_BASE[loc.type];
  const fam = Math.max(
    peekRel(world, a.id, b.id).familiarity,
    peekRel(world, b.id, a.id).familiarity,
  );
  p *= fam >= 20 ? 2 : fam > 0 ? 1.2 : 0.5;
  for (const x of [a, b]) {
    if (hasTrait(x, "sociable")) p *= 1.3;
    if (hasTrait(x, "talkative")) p *= 1.2;
    if (hasTrait(x, "shy")) p *= 0.6;
  }
  if (a.needs.energy < 20 || b.needs.energy < 20) p *= 0.4;
  if ((a.needs.mood + b.needs.mood) / 2 < 30) p *= 0.6;
  const w = currentWeather(world, a.regionId);
  if (loc.outdoor && w === "heavy_rain") p *= 1.4; // huddled under the same shelter
  if (loc.outdoor && isNight(minuteOfDay(world.tick)) && loc.type !== "music_venue") p *= 0.6;
  if (crowd > loc.capacity * 0.5) p *= 1.3;
  p *= boost;
  return clamp(p, 0, 0.5);
}

function onCooldown(world: World, a: string, b: string, subtype: string): boolean {
  return (world.cooldowns[`${pairKey(a, b)}|${subtype}`] ?? -1) > world.tick;
}

function setCooldown(world: World, a: string, b: string, subtype: string, ticks: number): void {
  world.cooldowns[`${pairKey(a, b)}|${subtype}`] = world.tick + ticks;
}

/** Why both people are here at all: their arrivals, the rain holding them, a world event. */
function contextCauses(
  world: World,
  loc: LocationDef,
  people: CharacterState[],
  boostCauses: string[],
): string[] {
  const out: string[] = [];
  for (const p of people) {
    out.push(p.arrivalEventId);
    if (p.delay?.eventId && world.tick < p.delay.untilTick) out.push(p.delay.eventId);
  }
  const regionId = people[0]!.regionId;
  if (loc.outdoor && isRain(currentWeather(world, regionId)))
    out.push(weatherEventId(world, regionId));
  return [...out, ...boostCauses];
}

/** Each tick: find co-present, awake, free people and let the rules decide what happens. */
export function detectEncounters(world: World): void {
  const groups = new Map<string, CharacterState[]>();
  for (const id of sortedCharacterIds(world)) {
    const c = world.characters[id]!;
    if (!isFree(world, c)) continue;
    const list = groups.get(c.locationId) ?? [];
    list.push(c);
    groups.set(c.locationId, list);
  }
  for (const locId of [...groups.keys()].sort()) {
    const people = groups.get(locId)!;
    if (people.length < 2) continue;
    const loc = getLocation(world, locId);
    let boost = 1;
    const boostCauses: string[] = [];
    for (const wid of Object.keys(world.activeWorldEvents).sort()) {
      const wev = world.content.worldEvents.find((e) => e.id === wid);
      for (const b of wev?.crowdBoost ?? []) {
        if (b.locationId === locId) {
          boost *= b.factor;
          boostCauses.push(world.activeWorldEvents[wid]!);
        }
      }
    }
    const engaged = new Set<string>();

    // 1. Needs-driven: someone stranded, soaked, lost, or chasing a break looks for the right person.
    for (const asker of people) {
      if (engaged.has(asker.id)) continue;
      for (const need of needsOf(world, asker, loc)) {
        const candidates = people
          .filter(
            (o) =>
              o.id !== asker.id &&
              !engaged.has(o.id) &&
              !onCooldown(world, asker.id, o.id, need.subtype) &&
              canHelp(world, o, asker, need),
          )
          .map((o) => {
            const r = peekRel(world, o.id, asker.id);
            const score =
              r.warmth + r.trust + r.familiarity * 0.5 + (hasTrait(o, "generous") ? 10 : 0);
            return { o, score };
          })
          .sort((x, y) => y.score - x.score || x.o.id.localeCompare(y.o.id));
        const helper = candidates[0]?.o;
        if (!helper) continue;
        if (!chance(world.rng, needChance(world, asker, helper, need, loc))) break;
        const kind: EncounterKind = need.kind;
        startEncounter(world, {
          kind,
          subtype: need.subtype,
          asker,
          giver: helper,
          loc,
          causes: [need.causeId, ...contextCauses(world, loc, [asker, helper], boostCauses)],
          amount: need.kind === "help" && "amount" in need ? need.amount : null,
          targetLocation: need.subtype === "directions" && "target" in need ? need.target : null,
        });
        engaged.add(asker.id).add(helper.id);
        break;
      }
    }

    // 2. Passing: a greeting, small talk, gist.
    for (let i = 0; i < people.length; i++) {
      const a = people[i]!;
      if (engaged.has(a.id)) continue;
      for (let j = i + 1; j < people.length; j++) {
        const b = people[j]!;
        if (engaged.has(b.id) || engaged.has(a.id)) continue;
        if (onCooldown(world, a.id, b.id, "small_talk")) continue;
        if (!chance(world.rng, passingChance(world, a, b, loc, people.length, boost))) continue;
        const aFirst =
          (hasTrait(a, "sociable") ? 1 : 0) + (hasTrait(a, "talkative") ? 1 : 0) >=
          (hasTrait(b, "sociable") ? 1 : 0) + (hasTrait(b, "talkative") ? 1 : 0);
        const [first, second] = aFirst ? [a, b] : [b, a];
        startEncounter(world, {
          kind: "passing",
          subtype: "small_talk",
          asker: first,
          giver: second,
          loc,
          causes: contextCauses(world, loc, [first, second], boostCauses),
          amount: null,
          targetLocation: null,
        });
        engaged.add(a.id).add(b.id);
      }
    }
  }
}

interface EncounterSpec {
  kind: EncounterKind;
  subtype: EncounterSubtype;
  asker: CharacterState;
  giver: CharacterState;
  loc: LocationDef;
  causes: string[];
  amount: number | null;
  targetLocation: string | null;
}

export function startEncounter(world: World, spec: EncounterSpec): Encounter {
  world.counters.encounter += 1;
  const id = `x${world.counters.encounter}`;
  const ev = appendEvent(world, {
    type: "encounter_started",
    actors: [spec.asker.id, spec.giver.id],
    location: spec.loc.id,
    causes: spec.causes,
    data: {
      encounterId: id,
      kind: spec.kind,
      subtype: spec.subtype,
      asker: spec.asker.id,
      giver: spec.giver.id,
      amount: spec.amount,
      targetLocation: spec.targetLocation,
      weather: currentWeather(world, spec.asker.regionId),
    },
  });
  const enc: Encounter = {
    id,
    kind: spec.kind,
    subtype: spec.subtype,
    tick: world.tick,
    locationId: spec.loc.id,
    askerId: spec.asker.id,
    giverId: spec.giver.id,
    startEventId: ev.id,
    awaiting: [],
    replies: {},
    amount: spec.amount,
    targetLocation: spec.targetLocation,
  };
  spec.asker.busyUntil = world.tick + 1;
  spec.giver.busyUntil = world.tick + 1;
  setCooldown(
    world,
    spec.asker.id,
    spec.giver.id,
    spec.subtype,
    COOLDOWN_TICKS[spec.kind === "passing" ? "passing" : spec.kind],
  );
  // Asker answers first so a giver can react to how they were asked.
  for (const c of [spec.asker, spec.giver]) {
    if (c.controlledBy) {
      const player = world.players[c.controlledBy]!;
      if (player.autopilot) {
        const reply = autoReply(world, enc, c.id);
        recordPlayerReply(world, enc, c.id, reply, true);
      } else enc.awaiting.push(c.id);
    } else {
      enc.replies[c.id] = autoReply(world, enc, c.id);
    }
  }
  if (enc.awaiting.length === 0) resolveEncounter(world, enc);
  else world.encounters.push(enc);
  return enc;
}

export function recordPlayerReply(
  world: World,
  enc: Encounter,
  charId: string,
  reply: EncounterReply,
  auto: boolean,
): void {
  const c = getChar(world, charId);
  const ev = appendEvent(world, {
    type: "player_replied",
    actors: [charId],
    location: enc.locationId,
    causes: [enc.startEventId],
    data: {
      encounterId: enc.id,
      playerId: c.controlledBy,
      tone: reply.tone,
      action: reply.action,
      auto,
    },
  });
  enc.replies[charId] = { ...reply, eventId: ev.id };
  enc.awaiting = enc.awaiting.filter((x) => x !== charId);
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

interface Outcome {
  outcome: string;
  reason: string | null;
  lines: DialogueLine[];
}

export function resolveEncounter(world: World, enc: Encounter): void {
  world.encounters = world.encounters.filter((e) => e.id !== enc.id);
  const a = getChar(world, enc.askerId);
  const g = getChar(world, enc.giverId);
  const ta = enc.replies[a.id]?.tone ?? "friendly";
  const tg = enc.replies[g.id]?.tone ?? "friendly";
  const sink = openSink(world);
  let out: Outcome;
  if (enc.kind === "passing") out = resolvePassing(world, sink, enc, a, g, ta, tg);
  else if (enc.kind === "help") out = resolveHelp(world, sink, enc, a, g, ta, tg);
  else out = resolveOpportunity(world, sink, enc, a, g, ta, tg);

  const causes = [enc.startEventId];
  for (const r of Object.values(enc.replies)) if (r.eventId) causes.push(r.eventId);
  const ev = appendEvent(world, {
    type: "encounter_resolved",
    actors: [a.id, g.id],
    location: enc.locationId,
    causes,
    effects: sink.effects,
    data: {
      encounterId: enc.id,
      kind: enc.kind,
      subtype: enc.subtype,
      asker: a.id,
      giver: g.id,
      askerTone: ta,
      giverTone: tg,
      outcome: out.outcome,
      reason: out.reason,
      amount: enc.amount,
      targetLocation: enc.targetLocation,
      lines: out.lines.map((l) => ({ speaker: l.speaker, key: l.key })),
    },
  });

  if (enc.kind === "passing" && out.outcome === "chatted") {
    settleDebtsInPassing(world, enc, a, g, ev.id);
    shareRumours(world, enc, a, g, ev.id);
  }
}

function resolvePassing(
  world: World,
  sink: Sink,
  enc: Encounter,
  a: CharacterState,
  g: CharacterState,
  ta: Tone,
  tg: Tone,
): Outcome {
  const firstMeeting =
    peekRel(world, a.id, g.id).familiarity === 0 && peekRel(world, g.id, a.id).familiarity === 0;
  for (const [speaker, listener, tone] of [
    [a, g, ta],
    [g, a, tg],
  ] as const) {
    if (tone === "walk_away") {
      const fam = peekRel(world, listener.id, speaker.id).familiarity;
      adjustRel(world, sink, listener.id, speaker.id, {
        familiarity: 1,
        warmth: fam > 20 ? -2 : 0,
        tension: fam > 20 ? 2 : 0,
      });
      continue;
    }
    const d: Record<string, number> = { familiarity: firstMeeting ? 5 : 3 };
    if (tone === "friendly") d.warmth = hasTrait(listener, "warm") ? 3 : 2;
    if (tone === "funny") {
      if (hasTrait(listener, "playful")) d.warmth = 3;
      else if (hasTrait(listener, "no_nonsense")) {
        d.respect = -1;
        d.tension = 1;
      } else d.warmth = 1;
    }
    if (tone === "firm") {
      d.respect = 1;
      if (hasTrait(listener, "hot_tempered")) d.tension = 1;
    }
    adjustRel(world, sink, listener.id, speaker.id, d);
  }
  const chatted = ta !== "walk_away" && tg !== "walk_away";
  if (chatted) {
    adjustMood(world, sink, a.id, 2);
    adjustMood(world, sink, g.id, 2);
    if (firstMeeting) {
      for (const [x, y] of [
        [a, g],
        [g, a],
      ] as const) {
        addMemory(world, sink, x.id, {
          kind: "met",
          subject: y.id,
          about: [],
          valence: 0.2,
          importance: 15,
          locationId: enc.locationId,
        });
      }
    }
  }
  // If the first person walks on, there is nothing to reply to.
  const lines: DialogueLine[] = [{ speaker: a.id, key: `passing.open.${ta}` }];
  if (ta !== "walk_away") lines.push({ speaker: g.id, key: `passing.reply.${tg}` });
  return { outcome: chatted ? "chatted" : "brushed_off", reason: null, lines };
}

function giverAgrees(
  world: World,
  enc: Encounter,
  a: CharacterState,
  g: CharacterState,
  ta: Tone,
  tg: Tone,
): { agree: boolean; reason: string } {
  if (g.controlledBy) {
    if (tg === "walk_away") return { agree: false, reason: "declined" };
    const money = enc.subtype === "transport_money" || enc.subtype === "chop_money";
    if (money && available(world, g) < (enc.amount ?? 0)) return { agree: false, reason: "broke" };
    if (enc.kind === "opportunity" && !findOffer(world, g, a.id, enc.subtype))
      return { agree: false, reason: "nothing_to_offer" };
    return { agree: true, reason: "willing" };
  }
  const d = npcDecide(world, g, a, enc, ta);
  return { agree: d.agree, reason: d.reason };
}

function resolveHelp(
  world: World,
  sink: Sink,
  enc: Encounter,
  a: CharacterState,
  g: CharacterState,
  ta: Tone,
  tg: Tone,
): Outcome {
  const sub = enc.subtype;
  if (ta === "walk_away") {
    return {
      outcome: "withdrawn",
      reason: null,
      lines: [{ speaker: a.id, key: `help.${sub}.withdraw` }],
    };
  }
  const { agree, reason } = giverAgrees(world, enc, a, g, ta, tg);
  const lines: DialogueLine[] = [{ speaker: a.id, key: `help.${sub}.ask.${ta}` }];
  if (!agree) {
    lines.push({ speaker: g.id, key: `help.${sub}.no.${reason}` });
    adjustRel(world, sink, a.id, g.id, { warmth: -4, tension: 3, familiarity: 1 });
    adjustMood(world, sink, a.id, -3);
    addMemory(world, sink, a.id, {
      kind: "refused_me",
      subject: g.id,
      about: [],
      valence: -0.5,
      importance: sub === "directions" ? 20 : 45,
      locationId: enc.locationId,
    });
    addMemory(world, sink, g.id, {
      kind: "i_refused",
      subject: a.id,
      about: [],
      valence: -0.1,
      importance: 15,
      locationId: enc.locationId,
    });
    return { outcome: "refused", reason, lines };
  }
  lines.push({ speaker: g.id, key: `help.${sub}.yes.${tg === "walk_away" ? "friendly" : tg}` });
  let importance = 55;
  if (sub === "transport_money" || sub === "chop_money") {
    importance = 65;
    createDebt(world, sink, a.id, g.id, enc.amount ?? 0);
    if (a.shortOf) {
      if (a.shortOf.kind === "transport_money") a.today.trips += 1;
      else a.today.mealsOut += 1;
      a.shortOf = null;
    }
    adjustRel(world, sink, a.id, g.id, { trust: 8, warmth: 6, familiarity: 4 });
    adjustRel(world, sink, g.id, a.id, { familiarity: 3, warmth: 1 });
    adjustMood(world, sink, a.id, 6);
    addMemory(world, sink, g.id, {
      kind: "lent_money",
      subject: a.id,
      about: [],
      valence: 0.1,
      importance: 40,
      locationId: enc.locationId,
    });
  } else if (sub === "umbrella") {
    const st = world.regionWeather[a.regionId];
    const end = st ? rainEndsAt(st.day, minuteOfDay(world.tick)) : null;
    const minutesLeft = end === null ? 30 : end - minuteOfDay(world.tick);
    a.shelteredUntil = world.tick + Math.max(1, Math.ceil(minutesLeft / TICK_MINUTES));
    adjustRel(world, sink, a.id, g.id, { trust: 6, warmth: 5, familiarity: 4 });
    adjustRel(world, sink, g.id, a.id, { warmth: 2, familiarity: 3 });
    adjustMood(world, sink, a.id, 5);
    adjustMood(world, sink, g.id, 2);
    addMemory(world, sink, g.id, {
      kind: "i_helped",
      subject: a.id,
      about: [],
      valence: 0.3,
      importance: 25,
      locationId: enc.locationId,
    });
  } else if (sub === "directions" && enc.targetLocation) {
    importance = 30;
    learnPlace(world, sink, a, enc.targetLocation);
    a.seeking = null;
    adjustRel(world, sink, a.id, g.id, { trust: 3, warmth: 3, familiarity: 3 });
    adjustRel(world, sink, g.id, a.id, { familiarity: 2 });
  }
  addMemory(world, sink, a.id, {
    kind: "helped_me",
    subject: g.id,
    about: [],
    valence: 0.8,
    importance,
    locationId: enc.locationId,
  });
  return { outcome: "helped", reason: null, lines };
}

function resolveOpportunity(
  world: World,
  sink: Sink,
  enc: Encounter,
  a: CharacterState,
  g: CharacterState,
  ta: Tone,
  tg: Tone,
): Outcome {
  if (ta === "walk_away") {
    return {
      outcome: "withdrawn",
      reason: null,
      lines: [{ speaker: a.id, key: "opportunity.withdraw" }],
    };
  }
  const lines: DialogueLine[] = [{ speaker: a.id, key: `opportunity.ask.${ta}` }];
  const offer = findOffer(world, g, a.id, enc.subtype);
  const { agree, reason } = giverAgrees(world, enc, a, g, ta, tg);
  if (!agree || !offer) {
    const why = offer ? reason : "nothing_to_offer";
    lines.push({ speaker: g.id, key: `opportunity.no.${why}` });
    adjustRel(world, sink, a.id, g.id, { respect: -3, tension: 4, warmth: -2, familiarity: 1 });
    adjustMood(world, sink, a.id, -4);
    addMemory(world, sink, a.id, {
      kind: "refused_me",
      subject: g.id,
      about: [],
      valence: -0.6,
      importance: 50,
      locationId: enc.locationId,
    });
    addMemory(world, sink, g.id, {
      kind: "i_refused",
      subject: a.id,
      about: [],
      valence: -0.1,
      importance: 20,
      locationId: enc.locationId,
    });
    return { outcome: "refused", reason: why, lines };
  }
  lines.push({ speaker: g.id, key: `opportunity.${enc.subtype}.yes` });
  setFlag(world, sink, a.id, offer.grantsFlag);
  if (offer.revealsLocation) learnPlace(world, sink, a, offer.revealsLocation);
  g.offerUses[offer.id] = (g.offerUses[offer.id] ?? 0) + 1;
  g.offersGiven[`${offer.id}>${a.id}`] = sink.eventId;
  for (const goal of a.goals) {
    if (
      goal.status === "active" &&
      goal.kind === "seek_opportunity" &&
      goal.opportunity === enc.subtype
    ) {
      goal.status = "achieved";
      goal.eventId = sink.eventId;
      sink.effects.push({ kind: "goal", who: a.id, goalId: goal.id, status: "achieved" });
    }
  }
  adjustRel(world, sink, a.id, g.id, { trust: 6, respect: 6, warmth: 4, familiarity: 3 });
  adjustRel(world, sink, g.id, a.id, { respect: 2, familiarity: 3 });
  adjustMood(world, sink, a.id, 8);
  addMemory(world, sink, a.id, {
    kind: "got_lead",
    subject: g.id,
    about: [],
    valence: 0.8,
    importance: 75,
    locationId: enc.locationId,
  });
  addMemory(world, sink, g.id, {
    kind: "gave_lead",
    subject: a.id,
    about: [],
    valence: 0.3,
    importance: 35,
    locationId: enc.locationId,
  });
  return { outcome: "given", reason: offer.id, lines };
}

/** Learn a place, and tick off any goal of finding it. */
export function learnPlace(world: World, sink: Sink, c: CharacterState, locationId: string): void {
  learnLocation(world, sink, c.id, locationId);
  for (const goal of c.goals) {
    if (goal.status === "active" && goal.kind === "learn_place" && goal.location === locationId) {
      goal.status = "achieved";
      goal.eventId = sink.eventId;
      sink.effects.push({ kind: "goal", who: c.id, goalId: goal.id, status: "achieved" });
    }
  }
}

function settleDebtsInPassing(
  world: World,
  enc: Encounter,
  a: CharacterState,
  g: CharacterState,
  causeId: string,
): void {
  for (const [debtor, creditor] of [
    [a, g],
    [g, a],
  ] as const) {
    const debt = openDebts(world, debtor.id, creditor.id)[0];
    if (!debt) continue;
    const reply = enc.replies[debtor.id];
    const wants = reply?.action === "repay";
    if (wants && available(world, debtor) >= debt.amount)
      repayDebt(world, debt, causeId, enc.locationId);
  }
}

/** Gist: computer-run characters pass on what they remember about other people. */
function shareRumours(
  world: World,
  enc: Encounter,
  a: CharacterState,
  g: CharacterState,
  causeId: string,
): void {
  for (const [speaker, listener] of [
    [a, g],
    [g, a],
  ] as const) {
    if (speaker.controlledBy) continue;
    const best = speaker.memories
      .filter(
        (m) =>
          !m.secondhand &&
          SHAREABLE.has(m.kind) &&
          m.strength >= 25 &&
          m.subject !== listener.id &&
          m.subject !== speaker.id &&
          !m.toldTo.includes(listener.id),
      )
      .sort(
        (x, y) => y.strength * y.importance - x.strength * x.importance || x.id.localeCompare(y.id),
      )[0];
    if (!best) continue;
    let p = 0.35;
    if (hasTrait(speaker, "talkative")) p *= 1.8;
    if (hasTrait(speaker, "shy")) p *= 0.5;
    if (!chance(world.rng, Math.min(0.9, p))) continue;
    const sink = openSink(world);
    addMemory(world, sink, listener.id, {
      kind: "heard_rumour",
      subject: best.subject,
      about: [speaker.id],
      valence: best.valence * 0.6,
      importance: best.importance * 0.6,
      secondhand: true,
      sourceKind: best.kind,
      locationId: best.locationId,
    });
    if (best.valence > 0)
      adjustRel(world, sink, listener.id, best.subject, { warmth: 2, respect: 2 });
    else adjustRel(world, sink, listener.id, best.subject, { trust: -3, tension: 2 });
    adjustRel(world, sink, listener.id, speaker.id, { familiarity: 1 });
    best.toldTo.push(listener.id);
    appendEvent(world, {
      type: "rumour_shared",
      actors: [speaker.id, listener.id, best.subject],
      location: enc.locationId,
      causes: [causeId, best.eventId],
      effects: sink.effects,
      data: {
        speaker: speaker.id,
        listener: listener.id,
        subject: best.subject,
        memoryKind: best.kind,
        originalEventId: best.eventId,
        place: best.locationId,
      },
    });
  }
}
