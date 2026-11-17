import type { Effect, LedgerEvent, Relationship, World } from "@liag/engine";
import { getLocation } from "@liag/engine";

export type Say = (key: string, vars?: Record<string, string | number>) => string;

/** Bookkeeping flags that never mean anything to the player (e.g. "this scene has played"). */
export const HIDDEN_FLAG = /^scene:/;

const DIMS_SHOWN = ["trust", "warmth", "respect", "tension"] as const;

/**
 * The short "what changed" list on the card after an encounter, in plain words: how the other
 * person feels about you now, money, what you learned. Built from the ledger effects of the
 * events the reply produced.
 */
export function resultLines(
  world: World,
  events: LedgerEvent[],
  meId: string,
  say: Say,
  money: (n: number) => string,
  known: (key: string) => boolean = () => true,
): string[] {
  const out: string[] = [];
  const rel = new Map<string, Map<string, number>>();
  let moneyDelta = 0;
  let mood = 0;
  const seen = new Set<string>();
  const add = (s: string): void => {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };
  const name = (id: string): string => world.characters[id]?.name ?? id;
  const effects: Effect[] = events.flatMap((e) => e.effects);
  for (const e of effects) {
    switch (e.kind) {
      case "relationship":
        if (e.to === meId && e.from !== meId) {
          const m = rel.get(e.from) ?? new Map<string, number>();
          m.set(e.dim, (m.get(e.dim) ?? 0) + e.delta);
          rel.set(e.from, m);
        }
        break;
      case "money":
        if (e.who === meId) moneyDelta += e.delta;
        break;
      case "mood":
        if (e.who === meId) mood += e.delta;
        break;
      case "knows_location":
        if (e.who === meId) {
          let place = e.locationId;
          try {
            place = getLocation(world, e.locationId).name;
          } catch {
            // keep the id
          }
          add(say("fx.knows", { place }));
        }
        break;
      case "flag":
        // Flags are internal ids: show only the readable line content gives them (never the id).
        if (e.who === meId && !HIDDEN_FLAG.test(e.flag) && known(`flag.${e.flag}`))
          add(say(`flag.${e.flag}`));
        break;
      case "debt": {
        const d = world.debts.find((x) => x.id === e.debtId);
        if (!d || (d.debtor !== meId && d.creditor !== meId)) break;
        const other = d.debtor === meId ? d.creditor : d.debtor;
        if (e.status === "open" && d.debtor === meId)
          add(say("fx.debt", { name: name(other), amount: money(e.amount) }));
        if (e.status === "repaid") add(say("fx.repaid", { name: name(other) }));
        break;
      }
      default:
        break;
    }
  }
  for (const [who, dims] of rel) {
    for (const dim of DIMS_SHOWN) {
      const d = dims.get(dim) ?? 0;
      if (d === 0) continue;
      add(say(`rel.${dim}.${d > 0 ? "up" : "down"}`, { name: name(who) }));
    }
    if ((dims.get("familiarity") ?? 0) > 0 && !DIMS_SHOWN.some((k) => dims.get(k)))
      add(say("rel.familiarity.up", { name: name(who) }));
  }
  if (moneyDelta !== 0) out.unshift(`${moneyDelta > 0 ? "+" : "−"}${money(Math.abs(moneyDelta))}`);
  if (Math.round(mood) !== 0) add(say(mood > 0 ? "fx.mood.up" : "fx.mood.down"));
  return out;
}

/**
 * Wording hooks for the shared journal (Gist "what changed"): readable placeholder text for
 * flags and goals, never their ids; bookkeeping flags and flags with no wording are left out.
 */
export function journalWording(
  world: World,
  meId: string,
  say: Say,
  known: (key: string) => boolean,
): {
  flagText: (flag: string, whoId: string) => string | null;
  goalText: (goalId: string, whoId: string) => string | null;
} {
  const name = (id: string): string => world.characters[id]?.name ?? "";
  return {
    flagText: (flag, who) => {
      if (HIDDEN_FLAG.test(flag) || !known(`flag.${flag}`)) return null;
      return who === meId ? say(`flag.${flag}`) : say("fx.flagOther", { name: name(who) });
    },
    goalText: (_goal, who) =>
      who === meId ? say("fx.goalMine") : say("fx.goalOther", { name: name(who) }),
  };
}

/** One phrase for how someone feels about the player, from their side of the relationship. */
export function feelingKey(rel: Relationship | undefined): string {
  if (!rel || rel.familiarity < 8) return "feel.stranger";
  if (rel.tension >= 40) return "feel.tense";
  const score = rel.trust + rel.warmth + rel.respect / 2;
  if (score >= 70) return "feel.close";
  if (score >= 20) return "feel.friendly";
  if (score > -15) return "feel.neutral";
  if (score > -50) return "feel.wary";
  return "feel.hostile";
}
