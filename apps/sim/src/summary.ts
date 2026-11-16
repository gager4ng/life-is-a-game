import type { Relationship, World } from "@liag/engine";
import { REL_DIMS, getQuestDef, peekRel } from "@liag/engine";
import { naira } from "./text";

const pad = (s: string, n: number): string =>
  s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
const num = (v: number): string => String(v).padStart(5);

function relRow(world: World, r: Readonly<Relationship>): string {
  const from = world.characters[r.from]?.name ?? r.from;
  const to = world.characters[r.to]?.name ?? r.to;
  return `  ${pad(`${from} -> ${to}`, 30)}${REL_DIMS.map((d) => num(r[d])).join(" ")}`;
}

const HEADER = `  ${pad("", 30)}${REL_DIMS.map((d) => d.slice(0, 5).padStart(5)).join(" ")}`;

export function relationshipSummary(
  world: World,
  playerCharId: string | null,
  limit = 12,
): string[] {
  const out: string[] = ["", "=== Relationships ==="];
  if (playerCharId) {
    const others = Object.keys(world.characters)
      .filter((id) => id !== playerCharId)
      .filter(
        (id) =>
          world.relationships[`${playerCharId}>${id}`] ||
          world.relationships[`${id}>${playerCharId}`],
      )
      .sort();
    out.push(`  You (${world.characters[playerCharId]?.name}) and the people you've met:`);
    out.push(HEADER);
    for (const id of others) {
      out.push(relRow(world, peekRel(world, playerCharId, id)));
      out.push(relRow(world, peekRel(world, id, playerCharId)));
    }
  }
  const changed = Object.values(world.relationships)
    .filter((r) => r.lastEventId !== world.rootEventId)
    .filter((r) => r.from !== playerCharId && r.to !== playerCharId)
    .sort(
      (a, b) =>
        b.familiarity - a.familiarity || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    )
    .slice(0, limit);
  if (changed.length) {
    out.push("", `  Other bonds that changed (top ${changed.length} by familiarity):`);
    out.push(HEADER);
    for (const r of changed) out.push(relRow(world, r));
  }
  return out;
}

export function questSummary(world: World): string[] {
  const out = ["", "=== Quests ==="];
  if (world.quests.length === 0) out.push("  (none started)");
  for (const q of world.quests) {
    const def = getQuestDef(world, q.questId);
    const step = def.steps.find((s) => s.id === q.stepId);
    const creditor = q.bindings.creditor ? ` (${world.characters[q.bindings.creditor]?.name})` : "";
    const where = q.status === "active" && step ? ` -> ${step.objective}` : "";
    out.push(`  [${q.status}] ${def.title}${creditor} (${def.kind})${where}`);
  }
  return out;
}

export function peopleSummary(world: World, startMoney: Record<string, number>): string[] {
  const out = ["", "=== People ==="];
  for (const id of Object.keys(world.characters).sort()) {
    const c = world.characters[id]!;
    const start = startMoney[id];
    const delta =
      start === undefined
        ? ""
        : ` (${c.needs.money - start >= 0 ? "+" : "-"}${naira(Math.abs(c.needs.money - start))})`;
    out.push(
      `  ${pad(c.name, 13)} money ${pad(naira(c.needs.money) + delta, 24)} mood ${String(Math.round(c.needs.mood)).padStart(3)}  energy ${String(Math.round(c.needs.energy)).padStart(3)}  memories ${c.memories.length}`,
    );
  }
  return out;
}

export function statsLine(world: World): string {
  const count = (t: string) => world.ledger.filter((e) => e.type === t).length;
  return `  Ledger: ${world.ledger.length} events · ${count("encounter_resolved")} encounters · ${count("rumour_shared")} pieces of gist · ${count("debt_repaid")} debts repaid`;
}
