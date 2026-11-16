import type { RelDim } from "./content-types";
import { REL_DIMS } from "./content-types";
import { available } from "./economy";
import { seqOf } from "./ledger";
import { MEMORY_CAP } from "./memory";
import type { World } from "./types";
import { REL_BOUNDS } from "./types";
import { getQuestDef, occupants } from "./world";

/** Things that must always be true. Returns a list of violations (empty = healthy). */
export function checkInvariants(world: World): string[] {
  const errs: string[] = [];
  for (const rel of Object.values(world.relationships)) {
    for (const dim of REL_DIMS as readonly RelDim[]) {
      const [lo, hi] = REL_BOUNDS[dim];
      const v = rel[dim];
      if (!Number.isInteger(v) || v < lo || v > hi)
        errs.push(`relationship ${rel.from}>${rel.to} ${dim}=${v}`);
    }
  }
  const locIds = new Set(world.content.locations.map((l) => l.id));
  for (const c of Object.values(world.characters)) {
    const { energy, money, mood } = c.needs;
    if (energy < 0 || energy > 100) errs.push(`${c.id} energy ${energy}`);
    if (mood < 0 || mood > 100) errs.push(`${c.id} mood ${mood}`);
    if (!Number.isInteger(money) || money < 0) errs.push(`${c.id} money ${money}`);
    if (available(world, c) < 0) errs.push(`${c.id} has committed more than they have`);
    if (!locIds.has(c.locationId)) errs.push(`${c.id} is at unknown location ${c.locationId}`);
    if (c.travel && c.street) errs.push(`${c.id} is both travelling and standing on the street`);
    if (c.travel && c.travel.arriveTick < c.travel.departTick)
      errs.push(`${c.id} arrives before leaving`);
    if (c.memories.length > MEMORY_CAP) errs.push(`${c.id} has too many memories`);
    for (const m of c.memories) {
      if (m.strength < 0 || m.strength > 100)
        errs.push(`${c.id} memory ${m.id} strength ${m.strength}`);
    }
  }
  for (const loc of world.content.locations) {
    const n = occupants(world, loc.id).length;
    // Capacity is enforced on arrival; homes and characters starting there are exempt.
    if (n > loc.capacity && loc.type !== "home")
      errs.push(`${loc.id} over capacity (${n}/${loc.capacity})`);
  }
  let prevTick = 0;
  world.ledger.forEach((ev, i) => {
    if (ev.seq !== i + 1 || ev.id !== `e${i + 1}`) errs.push(`ledger id out of order at ${i}`);
    if (ev.tick < prevTick) errs.push(`ledger tick goes backwards at ${ev.id}`);
    prevTick = ev.tick;
    if (i > 0 && ev.causes.length === 0) errs.push(`${ev.id} (${ev.type}) has no causes`);
    for (const cause of ev.causes) {
      if (seqOf(cause) >= ev.seq) errs.push(`${ev.id} cites a later event ${cause}`);
    }
  });
  for (const q of world.quests) {
    const def = getQuestDef(world, q.questId);
    if (q.status === "active" && !def.steps.some((s) => s.id === q.stepId))
      errs.push(`quest ${q.instanceId} on unknown step ${q.stepId}`);
  }
  for (const d of world.debts) {
    if (d.amount <= 0) errs.push(`debt ${d.id} amount ${d.amount}`);
  }
  for (const e of world.encounters) {
    if (e.awaiting.length === 0) errs.push(`encounter ${e.id} pending with nobody to answer`);
  }
  return errs;
}
