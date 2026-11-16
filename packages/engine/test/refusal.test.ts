import { describe, expect, it } from "vitest";
import { chooseReply, pendingChoices } from "../src/sim";
import type { World } from "../src/types";
import { getChar } from "../src/world";
import { lastOf, meet, testWorld } from "./helpers";

const P = "p1";
const world = (): World => testWorld({ players: [{ playerId: P, characterId: "t_player" }] });
const reply = (w: World, tone = "friendly"): void => {
  chooseReply(w, P, pendingChoices(w, P)[0]!.encounterId, tone);
};

describe("computer-run characters can refuse", () => {
  it("someone with no money refuses to lend, however nicely asked", () => {
    const w = world();
    meet(w, "t_player", "t_broke", "help", "transport_money", { amount: 500 });
    reply(w);
    const ev = lastOf(w, "encounter_resolved");
    expect(ev.data.outcome).toBe("refused");
    expect(ev.data.reason).toBe("broke");
  });

  it("a competitive rival chasing the same break will not hand it over", () => {
    const w = world();
    meet(w, "t_player", "t_rival", "opportunity", "gig_lead");
    reply(w);
    const ev = lastOf(w, "encounter_resolved");
    expect(ev.data.outcome).toBe("refused");
    expect(ev.data.reason).toBe("rival");
    expect(getChar(w, "t_player").flags["lead:duet"]).toBeUndefined();
  });

  it("someone who distrusts you refuses even a small favour", () => {
    const w = world();
    w.relationships["t_giver>t_player"] = {
      from: "t_giver",
      to: "t_player",
      trust: -100,
      familiarity: 50,
      respect: -50,
      warmth: -100,
      tension: 100,
      lastEventId: w.rootEventId,
    };
    meet(w, "t_player", "t_giver", "help", "umbrella");
    reply(w);
    expect(lastOf(w, "encounter_resolved").data.outcome).toBe("refused");
  });

  it("the same person helps when the relationship and need are right", () => {
    const w = world();
    meet(w, "t_player", "t_giver", "opportunity", "gig_lead");
    reply(w);
    const ev = lastOf(w, "encounter_resolved");
    expect(ev.data.outcome).toBe("given");
    expect(getChar(w, "t_player").flags["lead:venue"]).toBeDefined();
    expect(getChar(w, "t_player").knownLocations.t_venue).toBeDefined();
  });

  it("lets the player refuse too", () => {
    const w = world();
    getChar(w, "t_friend").needs.money = 0;
    meet(w, "t_friend", "t_player", "help", "transport_money", { amount: 500 });
    const choice = pendingChoices(w, P)[0]!;
    expect(choice.role).toBe("giver");
    expect(choice.options.map((o) => o.tone)).toEqual(["friendly", "firm", "funny", "walk_away"]);
    reply(w, "walk_away");
    const ev = lastOf(w, "encounter_resolved");
    // The friend may lose their nerve and not ask; either way, no money moves.
    expect(["refused", "withdrawn"]).toContain(ev.data.outcome);
    expect(getChar(w, "t_friend").needs.money).toBe(0);
  });
});
