import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "@liag/engine";
import { WEATHER_KINDS, sceneFlag, stepTick } from "@liag/engine";
import { loadContent } from "@liag/content";
import { Journal } from "@liag/narrative";
import { HIDDEN_FLAG, journalWording, resultLines } from "../src/game/results";
import { PLAYER_CHAR, PLAYER_ID, Session } from "../src/game/session";
import { QUALITY_LEVELS } from "../src/three/quality";
import { UI_KEYS, dialogue, hasText, money, t } from "../src/ui/text";

/**
 * No raw key ever reaches the screen: every interface key the code asks for exists in the
 * content, every flag the content can give has readable wording, and a long run of real play
 * produces result cards and gist with no ids or keys in them.
 */

/** Something that looks like an internal id: "fx.flag", "tip:gig_leads", "welcome_ada". */
const RAW = /\b[a-z]+(?:[._:][a-z0-9]+)*[._:][a-z0-9_]+\b|\b[a-z]+_[a-z_]+\b|\{\w+\}|\[missing/;

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...srcFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Every flag the content can set on a character. */
function grantableFlags(): string[] {
  const c = loadContent();
  const flags = new Set<string>();
  for (const ch of c.characters) for (const o of ch.offers) flags.add(o.grantsFlag);
  for (const q of c.quests) {
    for (const f of [...(q.rewards.flags ?? []), ...(q.failurePenalty.flags ?? [])]) flags.add(f);
    for (const s of q.steps) for (const f of s.effects?.flags ?? []) flags.add(f);
  }
  for (const sc of c.scenes ?? []) {
    for (const f of sc.effects.flags ?? []) flags.add(f);
    flags.add(sceneFlag(sc.id));
  }
  return [...flags].sort();
}

describe("no raw keys on screen", () => {
  it("has wording for every literal interface key the code uses", () => {
    const keys = new Set<string>();
    for (const f of srcFiles(join(__dirname, "../src"))) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/\bt\(\s*"([^"]+)"/g)) keys.add(m[1]!);
      // Hint keys are returned as data, then shown with t().
      for (const m of s.matchAll(/key: "(hint\.[a-zA-Z]+)"/g)) keys.add(m[1]!);
    }
    // Keys built at run time.
    for (const w of WEATHER_KINDS) keys.add(`weather.${w}`);
    for (const q of QUALITY_LEVELS) keys.add(`graphics.${q}`);
    for (const d of ["trust", "warmth", "respect", "tension"])
      for (const dir of ["up", "down"]) keys.add(`rel.${d}.${dir}`);
    for (const f of ["stranger", "close", "friendly", "neutral", "wary", "hostile", "tense"])
      keys.add(`feel.${f}`);
    const missing = [...keys].filter((k) => !UI_KEYS.includes(k));
    expect(missing).toEqual([]);
    expect(keys.size).toBeGreaterThan(60);
  });

  it("gives every flag a player can get a readable line, and hides bookkeeping flags", () => {
    const flags = grantableFlags();
    expect(flags).toContain("tip:gig_leads");
    for (const f of flags) {
      if (HIDDEN_FLAG.test(f)) continue;
      expect(hasText(`flag.${f}`), f).toBe(true);
    }
    const s = Session.newGame(null, 3);
    const ev = (flag: string): LedgerEvent =>
      ({
        effects: [{ kind: "flag", who: PLAYER_CHAR, flag, eventId: "e" }],
      }) as unknown as LedgerEvent;
    expect(resultLines(s.world, [ev("tip:gig_leads")], PLAYER_CHAR, t, money, hasText)).toEqual([
      t("flag.tip:gig_leads"),
    ]);
    expect(resultLines(s.world, [ev("scene:welcome_ada")], PLAYER_CHAR, t, money, hasText)).toEqual(
      [],
    );
    // A flag nobody wrote wording for is left out rather than shown as an id.
    expect(resultLines(s.world, [ev("lead:mystery")], PLAYER_CHAR, t, money, hasText)).toEqual([]);
  });

  it("shows only readable text on result cards and in the gist over days of play", () => {
    const s = Session.newGame(null, 11);
    const w = s.world;
    const journal = new Journal(w, dialogue, {
      playerCharId: PLAYER_CHAR,
      verbose: false,
      currency: "₦",
      ...journalWording(w, PLAYER_CHAR, t, hasText),
    });
    const bad: string[] = [];
    const check = (where: string, text: string): void => {
      // Speech may contain Pidgin and names; ids never contain spaces, so look for id shapes.
      const plain = text.replace(/^\[PH\]\s*/, "");
      if (RAW.test(plain)) bad.push(`${where}: ${text}`);
    };
    // First the scripted welcome, answered by the player.
    s.step();
    const p = s.pending()!;
    const evs = s.reply(p.encounterId, "friendly");
    for (const line of resultLines(w, evs, PLAYER_CHAR, t, money, hasText)) check("card", line);
    // Then four days on autopilot; every batch of events goes through the card and the gist.
    w.players[PLAYER_ID]!.autopilot = true;
    for (let i = 0; i < 144 * 4; i++) {
      const r = stepTick(w);
      for (const line of resultLines(w, r.events, PLAYER_CHAR, t, money, hasText))
        check("card", line);
      for (const ev of r.events) {
        const g = journal.gist(ev);
        if (!g) continue;
        check("gist headline", g.headline);
        for (const l of g.lines) check("gist line", l.text);
        if (g.changed) check("gist changed", g.changed);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});
