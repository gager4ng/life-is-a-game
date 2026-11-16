import type { OfferDef, Tone } from "./content-types";
import { available, openDebts } from "./economy";
import { peekRel } from "./effects";
import { memoryOpinion } from "./memory";
import { intBetween, weighted } from "./rng";
import type {
  CharacterState,
  Encounter,
  EncounterReply,
  EncounterRole,
  ReplyOption,
  World,
} from "./types";
import { charDef, getChar, hasTrait } from "./world";

/** Rules for how computer-run characters talk and decide. Chance only adds a little noise. */

export function roleOf(enc: Encounter, charId: string): EncounterRole {
  if (enc.kind === "passing") return "chat";
  return enc.askerId === charId ? "asker" : "giver";
}

export function otherOf(enc: Encounter, charId: string): string {
  return enc.askerId === charId ? enc.giverId : enc.askerId;
}

/** The opportunity this giver could pass to this asker, if any is left. */
export function findOffer(
  world: World,
  giver: CharacterState,
  askerId: string,
  kind: string,
): OfferDef | null {
  for (const o of charDef(world, giver.id).offers) {
    if (o.kind !== kind) continue;
    if ((giver.offerUses[o.id] ?? 0) >= o.uses) continue;
    if (giver.offersGiven[`${o.id}>${askerId}`]) continue;
    return o;
  }
  return null;
}

export function npcTone(
  world: World,
  c: CharacterState,
  otherId: string,
  role: EncounterRole,
): Tone {
  const rel = peekRel(world, c.id, otherId);
  let friendly = 3;
  let firm = 1;
  let funny = 1;
  let walk = role === "chat" ? 0.2 : role === "asker" ? 0.1 : 0;
  if (hasTrait(c, "warm") || hasTrait(c, "generous") || hasTrait(c, "sociable")) friendly += 2;
  if (hasTrait(c, "no_nonsense") || hasTrait(c, "proud")) firm += 2.5;
  if (hasTrait(c, "playful") || hasTrait(c, "talkative")) funny += 2.5;
  if (hasTrait(c, "hot_tempered") && c.needs.mood < 35) firm += 2;
  if (role !== "giver") {
    if (hasTrait(c, "shy") && rel.familiarity < 10) walk += 1.5;
    if (c.needs.energy < 15) walk += 2;
    if (role === "asker" && hasTrait(c, "proud")) walk += 1;
    if (rel.tension > 40) walk += 1;
  }
  return weighted<Tone>(world.rng, [
    ["friendly", friendly],
    ["firm", firm],
    ["funny", funny],
    ["walk_away", walk],
  ]);
}

/** How well a tone lands with this listener. */
export function toneAffinity(listener: CharacterState, tone: Tone): number {
  switch (tone) {
    case "friendly":
      return 6 + (hasTrait(listener, "warm") || hasTrait(listener, "generous") ? 4 : 0);
    case "firm":
      return (
        (hasTrait(listener, "no_nonsense") ? 8 : 0) -
        (hasTrait(listener, "proud") ? 8 : 0) -
        (hasTrait(listener, "hot_tempered") ? 6 : 0)
      );
    case "funny":
      return (
        (hasTrait(listener, "playful") ? 10 : 0) +
        (hasTrait(listener, "sociable") ? 4 : 0) -
        (hasTrait(listener, "no_nonsense") ? 10 : 0) -
        (hasTrait(listener, "proud") ? 4 : 0)
      );
    case "walk_away":
      return -20;
  }
}

const BASE_WILLINGNESS: Record<string, number> = {
  umbrella: 55,
  transport_money: 44,
  chop_money: 40,
  directions: 72,
  gig_lead: 38,
  business_tip: 40,
  job_contact: 35,
};

export interface Decision {
  agree: boolean;
  reason: string;
  score: number;
}

/**
 * Whether a computer-run giver agrees. Hard rules first (can't afford it, a rival for the same
 * break, too exhausted), then a score from relationship, traits, tone, memories and needs.
 */
export function npcDecide(
  world: World,
  giver: CharacterState,
  asker: CharacterState,
  enc: Encounter,
  askerTone: Tone,
): Decision {
  const rel = peekRel(world, giver.id, asker.id);
  const money = enc.subtype === "transport_money" || enc.subtype === "chop_money";
  if (money && available(world, giver) < (enc.amount ?? 0) + 500) {
    return { agree: false, reason: "broke", score: 0 };
  }
  if (enc.subtype === "directions" && giver.needs.energy < 10) {
    return { agree: false, reason: "too_tired", score: 0 };
  }
  let offer: OfferDef | null = null;
  if (enc.kind === "opportunity") {
    offer = findOffer(world, giver, asker.id, enc.subtype);
    if (!offer) return { agree: false, reason: "nothing_to_offer", score: 0 };
    const rival = giver.goals.some(
      (g) =>
        g.status === "active" && g.kind === "seek_opportunity" && g.opportunity === enc.subtype,
    );
    if (rival && hasTrait(giver, "competitive") && rel.warmth < 30) {
      return { agree: false, reason: "rival", score: 0 };
    }
  }
  let score = BASE_WILLINGNESS[enc.subtype] ?? 40;
  score += rel.trust * 0.3 + rel.warmth * 0.3 + rel.respect * 0.1 + rel.familiarity * 0.1;
  score -= rel.tension * 0.4;
  if (hasTrait(giver, "generous")) score += 20;
  if (hasTrait(giver, "warm")) score += 10;
  if (hasTrait(giver, "stingy") && (money || enc.subtype === "umbrella")) score -= 25;
  if (hasTrait(giver, "shy")) score -= 5;
  if (hasTrait(giver, "competitive") && enc.kind === "opportunity") score -= 10;
  score += toneAffinity(giver, askerTone);
  score += memoryOpinion(giver, asker.id);
  if (giver.needs.energy < 20) score -= 15;
  if (giver.needs.mood < 30) score -= 10;
  if (giver.needs.mood > 70) score += 5;
  if (offer && rel.trust < offer.minTrust) score -= offer.minTrust - rel.trust;
  if (money && openDebts(world, asker.id, giver.id).length > 0) score -= 30;
  score += intBetween(world.rng, -10, 10);
  const agree = score >= 50;
  return { agree, reason: agree ? "willing" : "unwilling", score: Math.round(score) };
}

/** The replies a player can pick from (2–4, plus paying back a debt when that's possible). */
export function optionsFor(world: World, enc: Encounter, charId: string): ReplyOption[] {
  const role = roleOf(enc, charId);
  const scope = enc.kind === "passing" ? "chat" : enc.subtype;
  const tones: Tone[] = ["friendly", "firm", "funny", "walk_away"];
  const opts: ReplyOption[] = tones.map((tone) => ({
    id: tone,
    tone,
    action: "none",
    labelKey: `option.${scope}.${role}.${tone}`,
  }));
  if (enc.kind === "passing") {
    const c = getChar(world, charId);
    const debt = openDebts(world, charId, otherOf(enc, charId))[0];
    if (debt && available(world, c) >= debt.amount) {
      opts.unshift({
        id: "repay",
        tone: "friendly",
        action: "repay",
        labelKey: "option.chat.chat.repay",
      });
    }
  }
  return opts;
}

/**
 * The reply a computer-run character gives, also used to answer for a player on autopilot.
 * Givers on autopilot decide with the same rules as computer-run givers.
 */
export function autoReply(world: World, enc: Encounter, charId: string): EncounterReply {
  const c = getChar(world, charId);
  const otherId = otherOf(enc, charId);
  const role = roleOf(enc, charId);
  if (role === "chat") {
    const debt = openDebts(world, charId, otherId)[0];
    if (debt && available(world, c) >= debt.amount + 300) {
      return { tone: "friendly", action: "repay", eventId: null };
    }
    return { tone: npcTone(world, c, otherId, role), action: "none", eventId: null };
  }
  if (role === "giver" && c.controlledBy) {
    const askerTone = enc.replies[enc.askerId]?.tone ?? "friendly";
    const d = npcDecide(world, c, getChar(world, enc.askerId), enc, askerTone);
    if (!d.agree) return { tone: "walk_away", action: "none", eventId: null };
    const t = npcTone(world, c, otherId, role);
    return { tone: t === "walk_away" ? "friendly" : t, action: "none", eventId: null };
  }
  return { tone: npcTone(world, c, otherId, role), action: "none", eventId: null };
}
