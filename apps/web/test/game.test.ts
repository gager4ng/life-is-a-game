import { describe, expect, it } from "vitest";
import { createWorld } from "@liag/engine";
import type { LedgerEvent, Relationship } from "@liag/engine";
import { loadContent } from "@liag/content";
import { Clock, MS_PER_TICK } from "../src/game/clock";
import { feelingKey, resultLines } from "../src/game/results";
import { Session, type Storage } from "../src/game/session";
import { lightingFor, nightFactor } from "../src/render/weather-view";

class MemStore implements Storage {
  m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

describe("clock", () => {
  it("runs one tick every 5 seconds at 1x, faster at 4x, never while paused or held", () => {
    const c = new Clock();
    let ticks = 0;
    for (let i = 0; i < 600; i++) if (c.advance(50)) ticks++; // 30 s
    expect(ticks).toBe(30_000 / MS_PER_TICK);
    c.speed = 4;
    ticks = 0;
    for (let i = 0; i < 100; i++) if (c.advance(50)) ticks++; // 5 s at 4x
    expect(ticks).toBe(4);
    c.held = true;
    expect(c.advance(10_000)).toBe(false);
    c.held = false;
    c.speed = 0;
    expect(c.advance(10_000)).toBe(false);
  });
});

describe("session", () => {
  it("saves to storage and continues the same world", () => {
    const store = new MemStore();
    const s = Session.newGame(store, 7);
    for (let i = 0; i < 40 && s.step(); i++);
    s.save();
    expect(Session.hasSave(store)).toBe(true);
    const again = Session.continueGame(store)!;
    expect(again.world.tick).toBe(s.world.tick);
    expect(JSON.stringify(again.world)).toBe(JSON.stringify(s.world));
  });

  it("says why the player can not go somewhere", () => {
    const s = Session.newGame(null, 1);
    expect(s.canGo("loc_yaba_livespot")).toBe("unknown");
    expect(s.canGo("loc_yaba_park")).toBe(null);
  });

  it("ignores a broken save", () => {
    const store = new MemStore();
    store.setItem("liag:save:v2", "{not json");
    expect(Session.continueGame(store)).toBeNull();
  });
});

describe("result card and feelings", () => {
  const say = (k: string, v: Record<string, string | number> = {}): string =>
    `${k}:${Object.values(v).join(",")}`;
  const naira = (n: number): string => `N${n}`;

  it("says what changed for you in plain words", () => {
    const w = createWorld(loadContent(), {
      seed: 1,
      players: [{ playerId: "p1", characterId: "c_tobi" }],
    });
    const ev = {
      effects: [
        { kind: "relationship", from: "c_tunde", to: "c_tobi", dim: "trust", delta: 4, value: 10 },
        {
          kind: "relationship",
          from: "c_tunde",
          to: "c_tobi",
          dim: "tension",
          delta: -2,
          value: 0,
        },
        { kind: "relationship", from: "c_tobi", to: "c_tunde", dim: "trust", delta: 9, value: 9 },
        { kind: "money", who: "c_tobi", delta: 15000, value: 16200 },
        { kind: "knows_location", who: "c_tobi", locationId: "loc_yaba_livespot" },
      ],
    } as unknown as LedgerEvent;
    const lines = resultLines(w, [ev], "c_tobi", say, naira);
    expect(lines[0]).toBe("+N15000");
    expect(lines).toContain("rel.trust.up:Uncle Tunde");
    expect(lines).toContain("rel.tension.down:Uncle Tunde");
    expect(lines).toContain("fx.knows:Bluelight Live Spot");
    expect(lines.filter((l) => l.startsWith("rel.trust"))).toHaveLength(1); // only how they see you
  });

  it("turns a relationship into one phrase", () => {
    const rel = (o: Partial<Relationship>): Relationship => ({
      from: "a",
      to: "b",
      trust: 0,
      familiarity: 30,
      respect: 0,
      warmth: 0,
      tension: 0,
      lastEventId: "e1",
      ...o,
    });
    expect(feelingKey(undefined)).toBe("feel.stranger");
    expect(feelingKey(rel({ familiarity: 2 }))).toBe("feel.stranger");
    expect(feelingKey(rel({ trust: 40, warmth: 40 }))).toBe("feel.close");
    expect(feelingKey(rel({ tension: 60 }))).toBe("feel.tense");
    expect(feelingKey(rel({ trust: -40, warmth: -30 }))).toBe("feel.hostile");
  });
});

describe("lighting", () => {
  it("is dark at night, light by day, and gloomy in heavy rain", () => {
    expect(nightFactor(2 * 60)).toBe(1);
    expect(nightFactor(12 * 60)).toBe(0);
    expect(nightFactor(19 * 60)).toBeGreaterThan(0);
    expect(lightingFor(12 * 60, "heavy_rain").night).toBeGreaterThan(
      lightingFor(12 * 60, "dry").night,
    );
  });
});
