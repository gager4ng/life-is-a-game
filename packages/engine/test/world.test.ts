import { describe, expect, it } from "vitest";
import { getEvent } from "../src/ledger";
import { checkInvariants } from "../src/invariants";
import { loadWorld, saveWorld } from "../src/save";
import { chooseReply, hasBlockingChoices, pendingChoices, runDays, stepTick } from "../src/sim";
import { getChar } from "../src/world";
import { fixture } from "./fixture";
import { meet, testWorld } from "./helpers";

describe("world", () => {
  it("is deterministic: same seed and inputs give the same world", () => {
    const run = (seed: number): string => {
      const w = testWorld({
        seed,
        content: fixture({ wet: true }),
        players: [{ playerId: "p1", characterId: "t_player", autopilot: true }],
      });
      runDays(w, 2);
      return saveWorld(w);
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it("supports any number of players, each answering their own encounters", () => {
    const w = testWorld({
      players: [
        { playerId: "p1", characterId: "t_player" },
        { playerId: "p2", characterId: "t_friend" },
      ],
    });
    meet(w, "t_player", "t_friend", "passing", "small_talk");
    expect(hasBlockingChoices(w)).toBe(true);
    expect(() => stepTick(w)).toThrow(/must reply/);
    const c1 = pendingChoices(w, "p1");
    const c2 = pendingChoices(w, "p2");
    expect(c1).toHaveLength(1);
    expect(c2).toHaveLength(1);
    chooseReply(w, "p1", c1[0]!.encounterId, "funny");
    expect(hasBlockingChoices(w)).toBe(true);
    chooseReply(w, "p2", c2[0]!.encounterId, "friendly");
    expect(hasBlockingChoices(w)).toBe(false);
    const resolved = w.ledger.filter((e) => e.type === "encounter_resolved").pop()!;
    expect(resolved.data.askerTone).toBe("funny");
    expect(resolved.data.giverTone).toBe("friendly");
    expect(resolved.causes).toHaveLength(3); // the start plus both players' replies
  });

  it("keeps a second region running as plain data, with its own weather", () => {
    const w = testWorld({ content: fixture({ wet: true }) });
    runDays(w, 1);
    expect(Object.keys(w.regionWeather).sort()).toEqual(["otherland", "testville"]);
    expect(getChar(w, "o_person").locationId).toBe("o_home");
    expect(checkInvariants(w)).toEqual([]);
  });

  it("lets rain hold people back, citing the weather as the cause", () => {
    const w = testWorld({ seed: 3, content: fixture({ wet: true }) });
    runDays(w, 10);
    const delays = w.ledger.filter((e) => e.type === "delayed");
    expect(delays.length).toBeGreaterThan(0);
    for (const d of delays) {
      expect(["weather_changed", "weather_set"]).toContain(getEvent(w, d.causes[0]!).type);
    }
  });

  it("round-trips through save and load", () => {
    const w = testWorld({
      players: [{ playerId: "p1", characterId: "t_player", autopilot: true }],
    });
    runDays(w, 1);
    const text = saveWorld(w);
    expect(saveWorld(loadWorld(text))).toBe(text);
    expect(() => loadWorld(JSON.stringify({ version: 999 }))).toThrow(/not supported/);
  });
});
