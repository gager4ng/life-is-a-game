import { describe, expect, it } from "vitest";
import { traceCauses } from "../src/ledger";
import { evaluateQuests } from "../src/quests";
import { chooseReply, pendingChoices, stepTick } from "../src/sim";
import { TICKS_PER_DAY } from "../src/time";
import type { World } from "../src/types";
import { getChar } from "../src/world";
import { lastOf, meet, testWorld } from "./helpers";

const P = "p1";
const player = (): World => testWorld({ players: [{ playerId: P, characterId: "t_player" }] });
const inst = (w: World, questId: string) => w.quests.find((q) => q.questId === questId)!;
const flag = (w: World, f: string): void => {
  getChar(w, "t_player").flags[f] = w.rootEventId;
};

describe("quests", () => {
  it("starts main quests straight away", () => {
    const w = player();
    evaluateQuests(w, P);
    expect(inst(w, "tq_branch").status).toBe("active");
    expect(inst(w, "tq_branch").stepId).toBe("lead");
  });

  it("branches on world state: a venue lead and a duet lead go to different steps", () => {
    const a = player();
    flag(a, "lead:venue");
    evaluateQuests(a, P);
    expect(inst(a, "tq_branch").stepId).toBe("venue");

    const b = player();
    flag(b, "lead:duet");
    evaluateQuests(b, P); // first attempt fails; the step waits for its retry
    expect(inst(b, "tq_branch").stepId).toBe("duet");
    evaluateQuests(b, P); // second attempt fails too
    // The duet check always fails in the fixture, so after two attempts the quest fails.
    expect(inst(b, "tq_branch").status).toBe("failed");
    const checks = b.ledger.filter((e) => e.type === "quest_check");
    expect(checks.map((e) => e.data.success)).toEqual([false, false]);
    expect(lastOf(b, "quest_failed").data.reason).toBe("check_failed");
  });

  it("completes with rewards when the final step's condition holds", () => {
    const w = player();
    const before = getChar(w, "t_player").needs.money;
    flag(w, "lead:venue");
    flag(w, "done");
    evaluateQuests(w, P);
    expect(inst(w, "tq_branch").status).toBe("completed");
    expect(getChar(w, "t_player").needs.money).toBe(before + 1000 + 5000);
    expect(getChar(w, "t_player").flags.rewarded).toBeDefined();
  });

  it("fails when a fail condition becomes true", () => {
    const w = player();
    evaluateQuests(w, P);
    flag(w, "bad");
    evaluateQuests(w, P);
    expect(inst(w, "tq_branch").status).toBe("failed");
    expect(lastOf(w, "quest_failed").data.reason).toBe("condition");
  });

  it("fails when its deadline passes, and only starts once its prerequisite holds", () => {
    const w = testWorld({ players: [{ playerId: P, characterId: "t_player", autopilot: true }] });
    evaluateQuests(w, P);
    expect(w.quests.some((q) => q.questId === "tq_deadline")).toBe(false);
    flag(w, "start_deadline");
    evaluateQuests(w, P);
    expect(inst(w, "tq_deadline").status).toBe("active");
    while (w.tick <= TICKS_PER_DAY + 1) stepTick(w);
    expect(inst(w, "tq_deadline").status).toBe("failed");
    expect(lastOf(w, "quest_failed").data.reason).toBe("deadline");
  });

  it("an emergent quest appears only when the world supports it (a debt) and traces back to it", () => {
    const w = player();
    evaluateQuests(w, P);
    expect(w.quests.some((q) => q.questId === "tq_debt")).toBe(false);
    getChar(w, "t_player").needs.money = 0;
    meet(w, "t_player", "t_giver", "help", "transport_money", { amount: 500 });
    chooseReply(w, P, pendingChoices(w, P)[0]!.encounterId, "friendly");
    const debtQuest = inst(w, "tq_debt");
    expect(debtQuest.status).toBe("active");
    expect(debtQuest.bindings.creditor).toBe("t_giver");
    const started = w.ledger.find(
      (e) => e.type === "quest_started" && e.data.questId === "tq_debt",
    )!;
    expect(traceCauses(w, started.id).some((e) => e.type === "encounter_resolved")).toBe(true);
  });
});
