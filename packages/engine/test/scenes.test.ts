import { describe, expect, it } from "vitest";
import type { ContentBundle, SceneDef } from "../src/content-types";
import { sceneFlag } from "../src/encounters";
import { checkInvariants } from "../src/invariants";
import { saveWorld } from "../src/save";
import { chooseReply, pendingChoices, runUntil, stepTick } from "../src/sim";
import { tickAt } from "../src/time";
import type { PendingChoice, World } from "../src/types";
import { validateContentRefs } from "../src/validate";
import { getChar } from "../src/world";
import { fixture } from "./fixture";
import { testWorld } from "./helpers";

const SCENE: SceneDef = {
  id: "hello",
  asker: "t_giver",
  at: "home",
  forCharacter: "t_player",
  days: { from: 1, to: 1 },
  from: "14:30",
  to: "16:00",
  effects: {
    flags: ["tip:test"],
    relationships: [{ with: "$asker", dim: "warmth", delta: 2 }],
  },
};

function withScene(scene: SceneDef = SCENE): ContentBundle {
  const c = fixture();
  c.scenes = [scene];
  return c;
}

/** Play from 14:20 on day 1, answering other chats in a friendly way, until the scene shows. */
function untilScene(w: World): PendingChoice | null {
  const player = w.players.p1!;
  player.autopilot = true;
  runUntil(w, tickAt(0, 14 * 60 + 20));
  player.autopilot = false;
  while (w.tick < tickAt(0, 16 * 60)) {
    const p = pendingChoices(w, "p1")[0];
    if (p?.scene) return p;
    if (p) chooseReply(w, "p1", p.encounterId, "friendly");
    else stepTick(w);
  }
  return null;
}

describe("scripted scenes", () => {
  it("starts once, through the normal encounter code and the ledger", () => {
    const w = testWorld({
      content: withScene(),
      players: [{ playerId: "p1", characterId: "t_player" }],
    });
    const p = untilScene(w);
    expect(p).not.toBeNull();
    expect(p!.otherId).toBe("t_giver");
    expect(p!.kind).toBe("passing");
    const started = w.ledger.find((e) => e.type === "encounter_started" && e.data.scene)!;
    expect(started.location).toBe("t_home");
    expect(started.causes.length).toBeGreaterThan(0);

    const events = chooseReply(w, "p1", p!.encounterId, "friendly");
    const resolved = events.find((e) => e.type === "encounter_resolved")!;
    expect(resolved.data.scene).toBe("hello");
    const keys = (resolved.data.lines as { key: string }[]).map((l) => l.key);
    expect(keys).toEqual(["scene.hello.open", "passing.reply.friendly", "scene.hello.tip"]);
    const me = getChar(w, "t_player");
    expect(me.flags["tip:test"]).toBeDefined();
    expect(me.flags[sceneFlag("hello")]).toBeDefined();
    expect(resolved.effects).toContainEqual(
      expect.objectContaining({ kind: "flag", who: "t_player", flag: "tip:test" }),
    );

    // Never again.
    for (let i = 0; i < 10; i++) {
      const q = pendingChoices(w, "p1")[0];
      expect(q?.scene ?? null).toBeNull();
      if (q) chooseReply(w, "p1", q.encounterId, "friendly");
      else stepTick(w);
    }
    expect(checkInvariants(w)).toEqual([]);
  });

  it("gives nothing but marks it done when the player walks off", () => {
    const w = testWorld({
      content: withScene(),
      players: [{ playerId: "p1", characterId: "t_player" }],
    });
    const p = untilScene(w)!;
    const events = chooseReply(w, "p1", p.encounterId, "walk_away");
    const resolved = events.find((e) => e.type === "encounter_resolved")!;
    const keys = (resolved.data.lines as { key: string }[]).map((l) => l.key);
    expect(keys).toEqual(["scene.hello.open", "passing.reply.walk_away"]);
    const me = getChar(w, "t_player");
    expect(me.flags["tip:test"]).toBeUndefined();
    expect(me.flags[sceneFlag("hello")]).toBeDefined();
  });

  it("does not start outside its window or for someone else", () => {
    const late = withScene({ ...SCENE, days: { from: 2, to: 2 } });
    const w = testWorld({ content: late, players: [{ playerId: "p1", characterId: "t_player" }] });
    expect(untilScene(w)).toBeNull();
    const other = withScene({ ...SCENE, forCharacter: "t_friend" });
    const w2 = testWorld({
      content: other,
      players: [{ playerId: "p1", characterId: "t_player" }],
    });
    expect(untilScene(w2)).toBeNull();
  });

  it("is validated and stays deterministic", () => {
    const bad = withScene({ ...SCENE, asker: "nobody", at: "nowhere" });
    expect(validateContentRefs(bad).join("\n")).toMatch(/unknown asker[\s\S]*unknown location/);
    expect(validateContentRefs(withScene())).toEqual([]);
    const run = (): string => {
      const w = testWorld({
        content: withScene(),
        players: [{ playerId: "p1", characterId: "t_player", autopilot: true }],
        seed: 9,
      });
      runUntil(w, tickAt(1, 0));
      expect(getChar(w, "t_player").flags[sceneFlag("hello")]).toBeDefined();
      return saveWorld(w);
    };
    expect(run()).toBe(run());
  });
});
