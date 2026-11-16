import { describe, expect, it } from "vitest";
import { appendEvent, traceCauses } from "../src/ledger";
import { runDays } from "../src/sim";
import { testWorld } from "./helpers";

describe("event ledger", () => {
  it("refuses events with no cause, or a cause that is not earlier", () => {
    const w = testWorld();
    expect(() =>
      appendEvent(w, { type: "arrived", actors: [], location: null, causes: [] }),
    ).toThrow(/no causes/);
    expect(() =>
      appendEvent(w, { type: "arrived", actors: [], location: null, causes: ["e99"] }),
    ).toThrow(/later cause/);
  });

  it("traces every event back to the creation of the world", () => {
    const w = testWorld({
      players: [{ playerId: "p1", characterId: "t_player", autopilot: true }],
    });
    runDays(w, 2);
    expect(w.ledger.length).toBeGreaterThan(50);
    for (const ev of w.ledger) {
      const chain = traceCauses(w, ev.id);
      expect(chain[0]!.type).toBe("world_created");
      for (const c of ev.causes) expect(Number(c.slice(1))).toBeLessThan(ev.seq);
    }
  });
});
