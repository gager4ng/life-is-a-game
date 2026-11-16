import { describe, expect, it } from "vitest";
import type { ContentBundle } from "../src/content-types";
import { checkInvariants } from "../src/invariants";
import { findPath, journey, positionOnJourney, DRIVE_COST } from "../src/map";
import { saveWorld } from "../src/save";
import { runUntil, setPlayerDestination, stepTick } from "../src/sim";
import { TICKS_PER_DAY, tickAt } from "../src/time";
import { validateContentRefs } from "../src/validate";
import { getChar, occupants } from "../src/world";
import { TESTVILLE_MAP, fixture } from "./fixture";
import { testWorld } from "./helpers";

/** Testville plus an off-map office reached by a 30-minute ride from the park. */
function withOffice(): ContentBundle {
  const c = fixture();
  c.locations.push({
    id: "t_office",
    regionId: "testville",
    areaId: "centre",
    name: "Office",
    type: "workplace",
    hours: null,
    capacity: 20,
    outdoor: false,
  });
  c.maps[0]!.offMap.push({ locationId: "t_office", via: "t_park", rideMinutes: 30 });
  return c;
}

describe("path-finding", () => {
  it("keeps to sidewalks and only crosses the road when it must", () => {
    const path = findPath(TESTVILLE_MAP, [1, 3], [5, 1])!;
    expect(path[0]).toEqual([1, 3]);
    expect(path.at(-1)).toEqual([5, 1]);
    expect(path).toHaveLength(7);
    expect(path).not.toContainEqual([5, 2]); // the road tile is avoided
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1]!;
      const [bx, by] = path[i]!;
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1); // 4-way steps only
    }
  });

  it("is deterministic and refuses blocked tiles", () => {
    expect(findPath(TESTVILLE_MAP, [1, 1], [9, 5])).toEqual(
      findPath(TESTVILLE_MAP, [1, 1], [9, 5]),
    );
    expect(findPath(TESTVILLE_MAP, [1, 1], [0, 0])).toBeNull();
    expect(findPath(TESTVILLE_MAP, [1, 1], [5, 2], DRIVE_COST)).toBeNull();
  });

  it("turns path length into minutes and whole ticks, riding to off-map places", () => {
    const c = withOffice();
    const walk = journey(c, "testville", { locationId: "t_home" }, { locationId: "t_park" });
    expect(walk.path).toHaveLength(9);
    expect(walk.totalMinutes).toBe(20);
    expect(walk.ticks).toBe(2);
    const ride = journey(c, "testville", { locationId: "t_home" }, { locationId: "t_office" });
    expect(ride.walkMinutes).toBe(20);
    expect(ride.rideAfter).toBe(30);
    expect(ride.ticks).toBe(5);
    expect(positionOnJourney(ride, 10)).toMatchObject({ x: 5, y: 3 });
    expect(positionOnJourney(ride, 35)).toBeNull(); // on the danfo
    const unmapped = journey(c, "otherland", { locationId: "o_home" }, { locationId: "o_home" });
    expect(unmapped.ticks).toBe(1);
    expect(validateContentRefs(c)).toEqual([]);
  });

  it("rejects maps whose places can't be reached", () => {
    const c = fixture();
    c.maps[0] = { ...TESTVILLE_MAP, places: [...TESTVILLE_MAP.places] };
    c.maps[0].places[1] = { ...c.maps[0].places[1]!, door: [0, 0] };
    expect(validateContentRefs(c).join()).toMatch(/door of t_buka is not walkable/);
  });
});

describe("travel time", () => {
  it("takes as long as the walk, and nobody meets anyone on the way", () => {
    const w = testWorld({ seed: 2 });
    const leave = tickAt(0, 7 * 60); // routine: park from 07:00
    runUntil(w, leave + 1);
    const p = getChar(w, "t_player");
    expect(p.travel).not.toBeNull();
    expect(p.travel!.arriveTick).toBe(leave + 2);
    expect(p.activity).toBe("travel");
    expect(occupants(w, "t_home").map((c) => c.id)).not.toContain("t_player");
    expect(occupants(w, "t_park").map((c) => c.id)).not.toContain("t_player");
    runUntil(w, leave + 3);
    expect(p.travel).toBeNull();
    expect(p.locationId).toBe("t_park");
    const arrival = w.ledger.find((e) => e.type === "arrived" && e.actors[0] === "t_player")!;
    expect(arrival.tick).toBe(leave + 2);
    expect(arrival.data).toMatchObject({ from: "t_home", departedTick: leave, minutes: 20 });
    expect(arrival.causes).toContain(p.planEventId);
  });

  it("rides to off-map places and back", () => {
    const c = withOffice();
    const tobi = c.characters.find((x) => x.id === "t_player")!;
    tobi.knownLocations.push("t_office");
    const w = testWorld({ content: c, players: [{ playerId: "p1", characterId: "t_player" }] });
    runUntil(w, tickAt(0, 8 * 60) + 1); // at the park
    setPlayerDestination(w, "p1", "t_office", 3);
    const go = w.tick;
    stepTick(w);
    expect(getChar(w, "t_player").travel?.arriveTick).toBe(go + 3); // 30-minute ride
    runUntil(w, go + 4);
    expect(getChar(w, "t_player").locationId).toBe("t_office");
    expect(checkInvariants(w)).toEqual([]);
  });

  it("lets a player walk to a spot on the street and change course on the way", () => {
    const w = testWorld({ players: [{ playerId: "p1", characterId: "t_player" }] });
    runUntil(w, tickAt(0, 6 * 60));
    const p = getChar(w, "t_player");
    p.activity = "rest";
    const choice = setPlayerDestination(w, "p1", [9, 5], 2);
    stepTick(w);
    expect(p.travel?.to).toEqual({ tile: [9, 5] });
    // Change of mind half-way: go to the buka instead, from wherever he is.
    setPlayerDestination(w, "p1", "t_buka", 2);
    stepTick(w);
    expect(p.travel?.to).toEqual({ locationId: "t_buka" });
    expect(p.travel?.from).toHaveProperty("tile");
    runUntil(w, w.tick + 4);
    expect(p.locationId).toBe("t_buka");
    expect(p.street).toBeNull();
    expect(choice.data.street).toEqual([9, 5]);
    expect(() => setPlayerDestination(w, "p1", [0, 0])).toThrow(/walk/);
  });

  it("stays on the street spot until the choice runs out", () => {
    const w = testWorld({
      players: [{ playerId: "p1", characterId: "t_player", autopilot: true }],
    });
    runUntil(w, tickAt(0, 9 * 60));
    setPlayerDestination(w, "p1", [5, 3], 1);
    runUntil(w, w.tick + 4);
    const p = getChar(w, "t_player");
    expect(p.street).toEqual([5, 3]);
    expect(occupants(w, "t_park").map((c) => c.id)).not.toContain("t_player");
    const arrival = w.ledger
      .filter((e) => e.type === "arrived" && e.actors[0] === "t_player")
      .pop()!;
    expect(arrival.location).toBeNull();
    expect(arrival.data.street).toEqual([5, 3]);
    runUntil(w, w.tick + 6); // the hour is up: back to the routine (park)
    expect(p.street).toBeNull();
    expect(p.locationId).toBe("t_park");
  });

  it("stays deterministic with travel and street choices", () => {
    const run = (): string => {
      const w = testWorld({
        seed: 9,
        content: fixture({ wet: true }),
        players: [{ playerId: "p1", characterId: "t_player", autopilot: true }],
      });
      runUntil(w, tickAt(0, 10 * 60));
      setPlayerDestination(w, "p1", [9, 1], 1);
      runUntil(w, 2 * TICKS_PER_DAY);
      expect(checkInvariants(w)).toEqual([]);
      return saveWorld(w);
    };
    expect(run()).toBe(run());
  });
});
