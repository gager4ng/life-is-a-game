import { describe, expect, it } from "vitest";
import { createWorld, runDays } from "@liag/engine";
import { loadContent, loadDialogue } from "@liag/content";
import { Journal, Text, collectGist } from "../src/index";

describe("gist feed", () => {
  it("lists what happened around town, newest first, with the why", () => {
    const w = createWorld(loadContent(), {
      seed: 42,
      players: [{ playerId: "p1", characterId: "c_tobi", autopilot: true }],
    });
    runDays(w, 1);
    const journal = new Journal(w, new Text(loadDialogue()), {
      playerCharId: "c_tobi",
      verbose: false,
      currency: "₦",
    });
    const feed = collectGist(journal, w.ledger, 40);
    expect(feed.length).toBeGreaterThan(5);
    for (let i = 1; i < feed.length; i++)
      expect(feed[i - 1]!.tick).toBeGreaterThanOrEqual(feed[i]!.tick);
    const enc = feed.filter((e) => e.kind === "encounter");
    expect(enc.length).toBeGreaterThan(0);
    for (const e of enc) {
      expect(e.why).toBeTruthy();
      for (const l of e.lines) expect(l.text.startsWith("[PH] ")).toBe(true);
    }
    expect(feed.some((e) => e.mine)).toBe(true);
    const money = feed.find((e) => /₦\d/.test(`${e.headline} ${e.changed ?? ""}`));
    expect(money).toBeDefined();
  });
});
