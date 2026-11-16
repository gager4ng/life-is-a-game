import { describe, expect, it } from "vitest";
import { loadContent, loadDialogue } from "@liag/content";
import { createWorld, runDays } from "@liag/engine";
import { playInteractive } from "../src/interactive";
import { Journal } from "../src/journal";
import { Text } from "../src/text";

describe("journal and interactive play", () => {
  it("renders a day of journal with no missing text", () => {
    const w = createWorld(loadContent(), {
      seed: 42,
      players: [{ playerId: "p1", characterId: "c_tobi", autopilot: true }],
    });
    const text = new Text(loadDialogue());
    const journal = new Journal(w, text, { playerCharId: "c_tobi", verbose: true });
    const lines: string[] = [];
    runDays(w, 2, (r) => lines.push(...journal.render(r.events)));
    const all = lines.join("\n");
    expect(all).toContain("=== Day 1");
    expect(all).toContain("why:");
    expect(all).toContain("[PH]");
    expect(all).not.toContain("[missing text");
  });

  it("lets a player answer encounters by number", async () => {
    const w = createWorld(loadContent(), {
      seed: 42,
      players: [{ playerId: "p1", characterId: "c_tobi" }],
    });
    const text = new Text(loadDialogue());
    const journal = new Journal(w, text, { playerCharId: "c_tobi", verbose: false, focus: true });
    const out: string[] = [];
    let asked = 0;
    const ask = async (prompt: string): Promise<string | null> => {
      asked += 1;
      if (asked > 400) return null;
      return prompt.includes("Your reply") ? "1" : "h";
    };
    const how = await playInteractive(w, "p1", 144, text, journal, ask, (l) => out.push(l));
    expect(how).toBe("done");
    expect(w.ledger.some((e) => e.type === "player_replied" && e.data.auto === false)).toBe(true);
    expect(out.join("\n")).toContain("Around you:");
  });
});
