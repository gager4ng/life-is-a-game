import type { PriceKey, Prices } from "./content-types";
import { addMemory } from "./memory";
import type { Sink } from "./effects";
import { adjustMood, adjustRel, changeMoney, openSink, transferMoney } from "./effects";
import { appendEvent } from "./ledger";
import { intBetween } from "./rng";
import { TICKS_PER_DAY } from "./time";
import type { CharacterState, Debt, World } from "./types";
import { charDef, getChar, getLocation, getRegion, sortedCharacterIds } from "./world";

/** Regional prices after any active world events (e.g. a fuel price rise). */
export function currentPrices(world: World, regionId: string): Prices {
  const base = getRegion(world, regionId).prices;
  const out: Prices = { ...base };
  for (const id of Object.keys(world.activeWorldEvents).sort()) {
    const def = world.content.worldEvents.find((e) => e.id === id);
    if (!def || (def.regionId && def.regionId !== regionId) || !def.prices) continue;
    for (const k of Object.keys(def.prices) as PriceKey[]) {
      out[k] = Math.round(out[k] * (def.prices[k] ?? 1));
    }
  }
  return out;
}

/** World events that changed prices in this region (to cite as causes). */
export function priceEventIds(world: World, regionId: string): string[] {
  return Object.keys(world.activeWorldEvents)
    .sort()
    .filter((id) => {
      const def = world.content.worldEvents.find((e) => e.id === id);
      return def?.prices && (!def.regionId || def.regionId === regionId);
    })
    .map((id) => world.activeWorldEvents[id]!);
}

/** Spending committed today, paid at the end-of-day settlement. */
export function pendingSpend(world: World, c: CharacterState): number {
  const p = currentPrices(world, c.regionId);
  return c.today.trips * p.transportFare + c.today.mealsOut * p.mealOut + c.today.drinks * p.drink;
}

/** Money they can actually use right now. */
export function available(world: World, c: CharacterState): number {
  return c.needs.money - pendingSpend(world, c);
}

/** Round a shortfall up to a believable amount to ask for. */
export function askAmount(amount: number): number {
  return Math.max(500, Math.ceil(amount / 500) * 500);
}

export function openDebts(world: World, debtor: string, creditor?: string): Debt[] {
  return world.debts.filter(
    (d) => d.status === "open" && d.debtor === debtor && (!creditor || d.creditor === creditor),
  );
}

/** Record a debt and the cash moving with it. Effects go into the given sink. */
export function createDebt(
  world: World,
  sink: Sink,
  debtor: string,
  creditor: string,
  amount: number,
): Debt {
  world.counters.debt += 1;
  const debt: Debt = {
    id: `d${world.counters.debt}`,
    debtor,
    creditor,
    amount,
    createdTick: world.tick,
    eventId: sink.eventId,
    status: "open",
    overdue: false,
    settledEventId: null,
  };
  world.debts.push(debt);
  transferMoney(world, sink, creditor, debtor, amount);
  sink.effects.push({ kind: "debt", debtId: debt.id, status: "open", amount });
  return debt;
}

export function repayDebt(
  world: World,
  debt: Debt,
  causeId: string,
  locationId: string | null,
): void {
  const sink = openSink(world);
  transferMoney(world, sink, debt.debtor, debt.creditor, debt.amount);
  adjustRel(world, sink, debt.creditor, debt.debtor, {
    trust: 6,
    warmth: 2,
    tension: debt.overdue ? -4 : 0,
  });
  addMemory(world, sink, debt.creditor, {
    kind: "repaid_me",
    subject: debt.debtor,
    about: [],
    valence: 0.5,
    importance: 35,
    locationId,
  });
  sink.effects.push({ kind: "debt", debtId: debt.id, status: "repaid", amount: debt.amount });
  debt.status = "repaid";
  debt.settledEventId = sink.eventId;
  appendEvent(world, {
    type: "debt_repaid",
    actors: [debt.debtor, debt.creditor],
    location: locationId,
    causes: [causeId, debt.eventId],
    effects: sink.effects,
    data: { debtId: debt.id, amount: debt.amount },
  });
}

export const DEBT_GRACE_DAYS = 5;

/** At day start: unpaid debts past the grace period sour the lender's view. */
export function checkOverdueDebts(world: World): void {
  for (const debt of world.debts) {
    if (debt.status !== "open" || debt.overdue) continue;
    if (world.tick - debt.createdTick < DEBT_GRACE_DAYS * TICKS_PER_DAY) continue;
    const sink = openSink(world);
    debt.overdue = true;
    adjustRel(world, sink, debt.creditor, debt.debtor, { trust: -10, tension: 8, warmth: -3 });
    addMemory(world, sink, debt.creditor, {
      kind: "failed_to_repay",
      subject: debt.debtor,
      about: [],
      valence: -0.7,
      importance: 55,
      locationId: null,
    });
    sink.effects.push({ kind: "debt", debtId: debt.id, status: "overdue", amount: debt.amount });
    appendEvent(world, {
      type: "debt_overdue",
      actors: [debt.debtor, debt.creditor],
      location: null,
      causes: [debt.eventId, world.dayEventId],
      effects: sink.effects,
      data: { debtId: debt.id, amount: debt.amount },
    });
  }
}

/**
 * End of day: wages for time worked, minus fares, meals out and drinks committed during the day,
 * minus a home meal if affordable. One event per character keeps every naira in the ledger.
 */
export function settleDay(world: World): void {
  for (const id of sortedCharacterIds(world)) {
    const c = getChar(world, id);
    const def = charDef(world, id);
    const p = currentPrices(world, c.regionId);
    let income = 0;
    if (def.job && c.today.ticksWorked > 0) {
      const [lo, hi] = def.job.dailyIncome;
      const full = Math.min(1, c.today.ticksWorked / 36); // 6 hours counts as a full day
      let factor = full;
      const workplace = getLocation(world, def.job.workplaceId);
      const weather = world.regionWeather[c.regionId]?.day;
      if (workplace.outdoor && weather?.windows.some((w) => w.heavy)) factor *= 0.8;
      income = Math.round((intBetween(world.rng, lo, hi) * factor) / 50) * 50;
    }
    const fares = c.today.trips * p.transportFare;
    const meals = c.today.mealsOut * p.mealOut;
    const drinks = c.today.drinks * p.drink;
    const spend = fares + meals + drinks;
    const homeMeal = c.needs.money + income - spend >= p.mealHome ? p.mealHome : 0;
    const sink = openSink(world);
    changeMoney(world, sink, id, income - spend - homeMeal);
    if (homeMeal === 0) adjustMood(world, sink, id, -5);
    appendEvent(world, {
      type: "day_settled",
      actors: [id],
      location: null,
      causes: [c.planEventId, ...priceEventIds(world, c.regionId)],
      effects: sink.effects,
      data: { income, fares, meals, drinks, homeMeal, wentHungry: homeMeal === 0 },
    });
    c.today = { ticksWorked: 0, trips: 0, mealsOut: 0, drinks: 0 };

    for (const g of c.goals) {
      if (g.kind === "save_money" && g.status === "active" && g.amount !== null) {
        if (c.needs.money >= g.amount) {
          const gs = openSink(world);
          g.status = "achieved";
          g.eventId = gs.eventId;
          gs.effects.push({ kind: "goal", who: id, goalId: g.id, status: "achieved" });
          adjustMood(world, gs, id, 8);
          appendEvent(world, {
            type: "goal_achieved",
            actors: [id],
            location: null,
            causes: [c.lastMoneyEventId],
            effects: gs.effects,
            data: { goalId: g.id, kind: g.kind },
          });
        }
      }
    }
  }
}
