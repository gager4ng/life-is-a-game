import { describe, expect, it } from "vitest";
import {
  createWorld,
  findPath,
  regionMap,
  runUntil,
  setPlayerDestination,
  tickAt,
} from "@liag/engine";
import type { World } from "@liag/engine";
import { loadContent } from "@liag/content";
import { buildCity, placeAt, spotFor } from "../src/render/city-model";
import { facingOf, personView, tripProgress } from "../src/render/people-model";
import { angleDiff, buildingHeight, tileCentre, worldToTile, yawFor } from "../src/three/coords";

const content = loadContent();
const map = regionMap(content, "lagos")!;
const city = buildCity(map, content.locations);

function world(): World {
  return createWorld(content, {
    seed: 42,
    players: [{ playerId: "p1", characterId: "c_tobi", autopilot: true }],
  });
}

describe("3D coordinates", () => {
  it("maps tiles to world units and back, and turns figures the way they walk", () => {
    for (const [x, y] of [
      [0, 0],
      [3, 7],
      [40, 2],
    ] as const) {
      const c = tileCentre(x, y);
      expect(worldToTile(c.x, c.z)).toEqual({ tx: x, ty: y });
    }
    // Figures are built facing +z: walking +z is yaw 0, +x a quarter turn.
    expect(yawFor(0, 1)).toBeCloseTo(0);
    expect(yawFor(1, 0)).toBeCloseTo(Math.PI / 2);
    expect(angleDiff(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(buildingHeight({ style: { floors: 3 } } as never)).toBeGreaterThan(
      buildingHeight({ style: { floors: 1 } } as never),
    );
  });
});

describe("city model", () => {
  it("puts every on-map place on the map with somewhere to stand", () => {
    const onMap = map.places.map((p) => p.locationId).sort();
    expect(city.places.map((p) => p.locationId).sort()).toEqual(onMap);
    for (const p of city.places) {
      expect(placeAt(city, p.door[0], p.door[1])?.locationId).toBe(p.locationId);
      expect(p.spots.length, p.locationId).toBeGreaterThan(0);
    }
  });

  it("fills every remaining lot with filler buildings that never overlap", () => {
    const seen = new Set<string>();
    for (const b of city.boxes) {
      for (let y = b.y; y < b.y + b.h; y++)
        for (let x = b.x; x < b.x + b.w; x++) {
          const k = `${x},${y}`;
          expect(seen.has(k), k).toBe(false);
          seen.add(k);
          expect(map.tiles[y]![x]).toBe("#");
        }
    }
    let lots = 0;
    for (const row of map.tiles) for (const c of row) if (c === "#") lots++;
    expect(seen.size).toBe(lots);
    expect(city.boxes.filter((b) => !b.locationId).length).toBeGreaterThan(40);
    expect(city.streetLights.length).toBeGreaterThan(10);
  });

  it("is the same every time (no randomness)", () => {
    expect(JSON.stringify(buildCity(map, content.locations))).toBe(JSON.stringify(city));
  });
});

describe("path-finding on the Yaba map", () => {
  it("links every place on foot, keeping road tiles to the crossings", () => {
    const doors = city.places.map((p) => p.door);
    for (const a of doors)
      for (const b of doors) {
        const path = findPath(map, a, b);
        expect(path, `${a} -> ${b}`).not.toBeNull();
        const roads = path!.filter(([x, y]) => map.tiles[y]![x] === "R").length;
        expect(roads).toBeLessThanOrEqual(2);
      }
  });
});

describe("engine state to sprites", () => {
  it("hides people asleep indoors and shows them at their place when awake", () => {
    const w = world();
    expect(personView(w, city, "c_tobi", 0).visible).toBe(false);
    expect(personView(w, city, "c_tobi", 0).hiddenBecause).toBe("asleep");
    runUntil(w, tickAt(0, 9 * 60));
    expect(w.characters.c_tobi!.locationId).toBe("loc_yaba_market");
    const v = personView(w, city, "c_tobi", w.tick - 1);
    expect(v.visible).toBe(true);
    expect(v.isPlayer).toBe(true);
    expect(v.moving).toBe(false);
    const market = city.places.find((p) => p.locationId === "loc_yaba_market")!;
    expect(v).toMatchObject(spotFor(market, "c_tobi"));
  });

  it("walks travellers along their path as the clock runs, facing the way they go", () => {
    const w = world();
    runUntil(w, tickAt(0, 9 * 60));
    setPlayerDestination(w, "p1", "loc_yaba_park", 1);
    runUntil(w, w.tick + 1);
    const c = w.characters.c_tobi!;
    expect(c.travel).not.toBeNull();
    const t0 = c.travel!.departTick;
    const span = c.travel!.arriveTick - t0;
    const start = personView(w, city, "c_tobi", t0);
    const mid = personView(w, city, "c_tobi", t0 + span / 2);
    const end = personView(w, city, "c_tobi", t0 + span);
    expect(mid.moving).toBe(true);
    expect([start.x, start.y]).toEqual([13, 23]); // the market door
    expect([end.x, end.y]).toEqual([27, 23]); // the park door
    expect(Math.hypot(mid.x - start.x, mid.y - start.y)).toBeGreaterThan(1);
    expect(tripProgress(c, t0 + span / 2)).toBeCloseTo(0.5);
    expect(["se", "sw", "ne", "nw"]).toContain(mid.facing);
  });

  it("hides people at the off-map Island office", () => {
    const w = world();
    runUntil(w, tickAt(0, 12 * 60));
    expect(w.characters.c_chiamaka!.locationId).toBe("loc_island_office");
    const v = personView(w, city, "c_chiamaka", w.tick - 1);
    expect(v.visible).toBe(false);
    expect(v.hiddenBecause).toBe("offmap");
  });

  it("maps grid steps to the four screen directions", () => {
    expect(facingOf(1, 0)).toBe("se");
    expect(facingOf(-1, 0)).toBe("nw");
    expect(facingOf(0, 1)).toBe("sw");
    expect(facingOf(0, -1)).toBe("ne");
    expect(facingOf(0, 0, "ne")).toBe("ne");
  });
});
