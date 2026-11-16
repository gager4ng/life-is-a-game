import { describe, expect, it } from "vitest";
import { loadContent } from "@liag/content";
import type { World } from "@liag/engine";
import {
  REL_DIMS,
  TICKS_PER_DAY,
  checkInvariants,
  createWorld,
  loadWorld,
  runDays,
  saveWorld,
  traceCauses,
} from "@liag/engine";

const content = loadContent();
const newWorld = (seed: number | string = 42): World =>
  createWorld(content, {
    seed,
    players: [{ playerId: "p1", characterId: "c_tobi", autopilot: true }],
  });

// One shared 3-day run keeps the suite light on memory.
const threeDays = newWorld();
runDays(threeDays, 3);
const threeDaysJson = saveWorld(threeDays);

describe("Lagos world", () => {
  it("is deterministic: the same seed and inputs give the same world", () => {
    const again = newWorld();
    runDays(again, 3);
    expect(saveWorld(again)).toBe(threeDaysJson);
    const other = newWorld(43);
    runDays(other, 3);
    expect(saveWorld(other)).not.toBe(threeDaysJson);
  });

  it("can trace every event back to the start through its causes", () => {
    const w = threeDays;
    for (const ev of w.ledger) {
      if (ev.type === "world_created") continue;
      expect(ev.causes.length, `${ev.id} ${ev.type}`).toBeGreaterThan(0);
      for (const c of ev.causes) expect(Number(c.slice(1))).toBeLessThan(ev.seq);
    }
    // Spot-check deep chains: every resolved encounter traces to the arrivals that caused it.
    const resolved = w.ledger.filter((e) => e.type === "encounter_resolved");
    expect(resolved.length).toBeGreaterThan(20);
    for (const ev of resolved) {
      const chain = traceCauses(w, ev.id);
      expect(chain[0]!.type).toBe("world_created");
      expect(chain.some((e) => e.type === "encounter_started")).toBe(true);
    }
    for (const ev of w.ledger.filter((e) => e.type === "quest_completed")) {
      expect(traceCauses(w, ev.id).some((e) => e.type === "encounter_resolved")).toBe(true);
    }
  });

  it("records every naira and every relationship change in the ledger", () => {
    const w = threeDays;
    const money: Record<string, number> = Object.fromEntries(
      content.characters.map((c) => [c.id, c.start.money]),
    );
    const rel: Record<string, number> = {};
    for (const s of content.relationships) {
      for (const [a, b] of s.mutual
        ? [
            [s.from, s.to],
            [s.to, s.from],
          ]
        : [[s.from, s.to]]) {
        for (const d of REL_DIMS) rel[`${a}>${b}.${d}`] = s[d];
      }
    }
    for (const ev of w.ledger) {
      for (const e of ev.effects) {
        if (e.kind === "money") money[e.who] = (money[e.who] ?? 0) + e.delta;
        if (e.kind === "relationship") {
          const k = `${e.from}>${e.to}.${e.dim}`;
          rel[k] = (rel[k] ?? 0) + e.delta;
        }
      }
    }
    for (const c of Object.values(w.characters)) expect(money[c.id], c.id).toBe(c.needs.money);
    for (const r of Object.values(w.relationships)) {
      for (const d of REL_DIMS)
        expect(rel[`${r.from}>${r.to}.${d}`] ?? 0, `${r.from}>${r.to}.${d}`).toBe(r[d]);
    }
  });

  it("round-trips save and load, and a loaded world carries on exactly as before", () => {
    const w = newWorld();
    runDays(w, 2);
    const saved = saveWorld(w);
    const loaded = loadWorld(saved);
    expect(saveWorld(loaded)).toBe(saved);
    runDays(loaded, 1);
    expect(saveWorld(loaded)).toBe(threeDaysJson);
  });

  it("produces collisions, help, gist and quest progress in three days", () => {
    const types = new Set(threeDays.ledger.map((e) => e.type));
    for (const t of [
      "encounter_resolved",
      "rumour_shared",
      "quest_started",
      "weather_set",
      "world_event_started",
    ]) {
      expect(types.has(t as never), t).toBe(true);
    }
    const kinds = new Set(
      threeDays.ledger
        .filter((e) => e.type === "encounter_resolved")
        .map((e) => String(e.data.kind)),
    );
    expect([...kinds].sort()).toEqual(["help", "opportunity", "passing"]);
  });

  it("survives a 30-day soak with no errors or broken invariants", () => {
    const w = newWorld("soak");
    for (let day = 1; day <= 30; day++) {
      runDays(w, 1);
      expect(checkInvariants(w), `day ${day}`).toEqual([]);
    }
    expect(w.tick).toBe(30 * TICKS_PER_DAY);
  });
});
