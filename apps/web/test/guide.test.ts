import { describe, expect, it } from "vitest";
import type { World } from "@liag/engine";
import {
  chooseReply,
  minuteOfDay,
  pendingChoices,
  sceneFlag,
  stepTick,
  tickAt,
} from "@liag/engine";
import { ambientMix, daylight, falloff } from "../src/audio/mix";
import { loadSoundSettings } from "../src/audio/sound";
import {
  doneSteps,
  flagsWanted,
  focusPlace,
  nextHint,
  stepGuide,
  suggestionsFor,
} from "../src/game/guide";
import { NEW_GAME_TICK, PLAYER_ID, Session } from "../src/game/session";

const ME = "c_tobi";
const LEAD_FLAGS = ["lead:gig_live_spot", "lead:gig_duet"];
const walk = (): number => 7;

/** A new game, past the first-morning scene (answered in a friendly way). */
function afterScene(seed = 3): Session {
  const s = Session.newGame(null, seed);
  for (let i = 0; i < 5 && !s.pending(); i++) s.step();
  const p = s.pending()!;
  s.reply(p.encounterId, "friendly");
  return s;
}

/** Run with the player on autopilot to a given day/minute. */
function runTo(w: World, tick: number): void {
  const pl = w.players[PLAYER_ID]!;
  pl.autopilot = true;
  while (w.tick < tick) stepTick(w);
  pl.autopilot = false;
}

describe("new game start", () => {
  it("opens on day 1 at 06:40 with Tobi up at home", () => {
    const s = Session.newGame(null, 5);
    const w = s.world;
    expect(w.tick).toBe(NEW_GAME_TICK);
    expect(minuteOfDay(w.tick - 1)).toBe(6 * 60 + 40);
    const tobi = w.characters[ME]!;
    expect(tobi.locationId).toBe(tobi.homeId);
    expect(tobi.activity).not.toBe("sleep");
    expect(w.players[PLAYER_ID]!.autopilot).toBe(false);
    expect(s.asleep).toBe(false);
  });

  it("plays the neighbour's welcome on the next tick, through the engine and the ledger", () => {
    for (const seed of [1, 2, 3, 42]) {
      const s = Session.newGame(null, seed);
      s.step();
      const p = s.pending();
      expect(p?.scene, `seed ${seed}`).toBe("welcome_ada");
      expect(p!.otherId).toBe("c_ada");
      const events = chooseReply(s.world, PLAYER_ID, p!.encounterId, "friendly");
      expect(events.some((e) => e.type === "encounter_resolved" && e.data.scene)).toBe(true);
      const tobi = s.world.characters[ME]!;
      expect(tobi.flags[sceneFlag("welcome_ada")]).toBeDefined();
      expect(tobi.knownLocations["loc_yaba_livespot"]).toBeDefined();
    }
  });
});

describe("what to do next", () => {
  it("finds who can give a gig lead, and where their day takes them", () => {
    const s = afterScene();
    const w = s.world;
    expect(
      flagsWanted({ type: "any", of: LEAD_FLAGS.map((flag) => ({ type: "has_flag", flag })) }),
    ).toEqual(LEAD_FLAGS);
    const list = suggestionsFor(w, ME, LEAD_FLAGS, 10 * 60);
    const tunde = list.filter((x) => x.charId === "c_tunde");
    expect(tunde.map((x) => x.locationId)).toContain("loc_yaba_livespot");
    // Nobody's own home, and never Tobi himself.
    expect(list.every((x) => x.charId !== ME)).toBe(true);
    expect(list.some((x) => x.locationId === "loc_home_alagomeji")).toBe(false);
    // Places he knows come before ones he doesn't, at the same time of day.
    const live = tunde.find((x) => x.locationId === "loc_yaba_livespot")!;
    expect(live.known).toBe(true);
    expect(live.later).toBe(true);
  });

  it("leaves out people whose offer is used up", () => {
    const s = afterScene();
    const tunde = s.world.characters["c_tunde"]!;
    tunde.offerUses["bluelight_slot"] = 99;
    const list = suggestionsFor(s.world, ME, LEAD_FLAGS, 10 * 60);
    expect(list.some((x) => x.charId === "c_tunde")).toBe(false);
  });

  it("follows the engine's rule that a competitive rival won't share the break", () => {
    const s = afterScene();
    const w = s.world;
    // Ada wants a stage too and is competitive: no suggestion while she isn't close to Tobi.
    expect(suggestionsFor(w, ME, LEAD_FLAGS, 10 * 60).some((x) => x.charId === "c_ada")).toBe(
      false,
    );
    w.relationships["c_ada>c_tobi"]!.warmth = 40;
    const ada = suggestionsFor(w, ME, LEAD_FLAGS, 10 * 60).filter((x) => x.charId === "c_ada");
    expect(ada.length).toBeGreaterThan(0);
    expect(ada[0]!.trusted).toBe(w.relationships["c_ada>c_tobi"]!.trust >= 15);
  });

  it("guides a step with no fixed place by suggestion, and a fixed one by place", () => {
    const s = afterScene();
    const g = stepGuide(s.world, ME, 10 * 60)!;
    expect(g.target).toBeNull();
    expect(g.suggestions.length).toBeGreaterThan(0);
    expect(focusPlace(g)).not.toBeNull();

    // Pretend Tobi got the lead: the audition step has a fixed place and an evening window.
    const w = s.world;
    const q = w.quests.find((x) => x.questId === "q_first_gig")!;
    q.stepId = "audition";
    const g2 = stepGuide(w, ME, 10 * 60)!;
    expect(g2.target?.locationId).toBe("loc_yaba_livespot");
    expect(g2.target?.window).toEqual([18 * 60, 23 * 60]);
    expect(focusPlace(g2)).toBe("loc_yaba_livespot");
    const h = nextHint(w, ME, 10 * 60, walk)!;
    expect(h.key).toBe("hint.beThereAt");
    expect(h.vars.from).toBe("18:00");
    expect(nextHint(w, ME, 19 * 60, walk)!.key).toBe("hint.goTo");
  });

  it("gives a concrete idle hint, and none while asleep or mid-conversation", () => {
    const s = afterScene();
    const w = s.world;
    const h = nextHint(w, ME, minuteOfDay(w.tick), walk)!;
    expect(["hint.meetNow", "hint.meetLater", "hint.waitFor"]).toContain(h.key);
    expect(h.locationId).not.toBeNull();
    expect(String(h.vars.name)).toMatch(/\w/);

    runTo(w, tickAt(1, 2 * 60)); // day 2, 02:00
    expect(w.characters[ME]!.activity).toBe("sleep");
    expect(nextHint(w, ME, 2 * 60, walk)).toBeNull();

    const fresh = Session.newGame(null, 3);
    fresh.step();
    expect(pendingChoices(fresh.world, PLAYER_ID).length).toBe(1);
    expect(nextHint(fresh.world, ME, 6 * 60 + 50, walk)).toBeNull();
  });

  it("lists the steps already done from the ledger", () => {
    const s = afterScene();
    const w = s.world;
    const q = w.quests.find((x) => x.questId === "q_first_gig")!;
    expect(doneSteps(w, q)).toEqual([]);
    w.characters[ME]!.flags["lead:gig_live_spot"] = w.ledger.at(-1)!.id;
    runTo(w, w.tick + 1);
    expect(doneSteps(w, q)).toEqual(["Find someone who can get you on a stage."]);
  });
});

describe("sound mix", () => {
  const base = {
    weather: "dry" as const,
    listener: { x: 14, y: 23 },
    zoom: 1.3,
    sources: [
      { layer: "market" as const, x: 14, y: 23 },
      { layer: "live" as const, x: 39, y: 13 },
    ],
    roadDistance: 2,
  };

  it("follows time of day, distance and weather", () => {
    expect(falloff(0)).toBe(1);
    expect(falloff(12)).toBeLessThan(0.25);
    expect(daylight(12 * 60)).toBe(1);
    expect(daylight(2 * 60)).toBe(0);
    const noon = ambientMix({ ...base, minute: 12 * 60 });
    const night = ambientMix({ ...base, minute: 2 * 60 });
    expect(noon.market).toBeGreaterThan(0.5);
    expect(night.market).toBe(0);
    expect(night.insects).toBeGreaterThan(noon.insects);
    expect(night.traffic).toBeLessThan(noon.traffic);
    expect(noon.live).toBe(0);
    const evening = ambientMix({ ...base, minute: 20 * 60 });
    const nearLive = ambientMix({ ...base, minute: 20 * 60, listener: { x: 39, y: 13 } });
    expect(nearLive.live).toBeGreaterThan(evening.live);
    expect(ambientMix({ ...base, minute: 12 * 60, weather: "heavy_rain" }).rain).toBe(1);
  });

  it("remembers settings and survives bad saved data", () => {
    expect(loadSoundSettings(null)).toEqual({ muted: false, volume: 0.8, music: true });
    const store = { getItem: () => JSON.stringify({ muted: true, volume: 3, music: false }) };
    expect(loadSoundSettings(store)).toEqual({ muted: true, volume: 1, music: false });
    expect(loadSoundSettings({ getItem: () => "{oops" }).muted).toBe(false);
  });
});
