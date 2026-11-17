import { describe, expect, it } from "vitest";
import { validateContentRefs } from "@liag/engine";
import {
  RegionPackSchema,
  buildBundle,
  contentStatus,
  loadContent,
  loadDialogue,
  parseRegionPack,
  parseWorldEvents,
} from "../src/index";
import lagosJson from "../src/regions/lagos/region.json";

describe("content", () => {
  it("loads and passes schema and reference checks", () => {
    const c = loadContent();
    expect(validateContentRefs(c)).toEqual([]);
    expect(c.characters.length).toBeGreaterThanOrEqual(9);
    expect(c.characters.length).toBeLessThanOrEqual(13);
    expect(c.characters.filter((x) => x.playable).length).toBeGreaterThanOrEqual(1);
    expect(c.quests.map((q) => q.kind).sort()).toEqual(["emergent", "main", "side"]);
    // Every Lagos place is on the Yaba map (or reached by danfo from it).
    const map = c.maps.find((m) => m.regionId === "lagos")!;
    for (const l of c.locations.filter((x) => x.regionId === "lagos")) {
      const on = map.places.some((p) => p.locationId === l.id);
      const off = map.offMap.some((p) => p.locationId === l.id);
      expect(on || off, l.id).toBe(true);
    }
  });

  it("marks every content file as placeholder until the owner approves it", () => {
    for (const f of contentStatus()) expect(f.status, f.file).toBe("PLACEHOLDER");
    expect(loadDialogue().placeholder).toBe(true);
  });

  it("covers the encounter text the engine can ask for", () => {
    const { lines } = loadDialogue();
    for (const tone of ["friendly", "firm", "funny", "walk_away"]) {
      expect(lines[`passing.open.${tone}`]).toBeDefined();
      expect(lines[`passing.reply.${tone}`]).toBeDefined();
      expect(lines[`option.asker.${tone}`]).toBeDefined();
      expect(lines[`option.giver.${tone}`]).toBeDefined();
    }
    for (const sc of loadContent().scenes ?? []) {
      for (const k of [`prompt.scene.${sc.id}`, `scene.${sc.id}.open`, `scene.${sc.id}.tip`])
        expect(lines[k], k).toBeDefined();
    }
    for (const sub of ["umbrella", "transport_money", "chop_money", "directions"]) {
      expect(lines[`help.${sub}.withdraw`]).toBeDefined();
      expect(lines[`narrate.help.${sub}.helped`]).toBeDefined();
    }
  });

  it("rejects bad data with a clear error", () => {
    const broken = JSON.parse(JSON.stringify(lagosJson)) as { characters: { traits: string[] }[] };
    broken.characters[0]!.traits.push("telepathic");
    expect(() => RegionPackSchema.parse(broken)).toThrow();
    expect(() =>
      parseWorldEvents({ $meta: { status: "PLACEHOLDER", note: "" }, events: [{ id: "x" }] }),
    ).toThrow();
  });

  it("adds a new region as data only", () => {
    const lagos = parseRegionPack(lagosJson);
    const abuja = parseRegionPack({
      $meta: { status: "PLACEHOLDER", note: "test-only region" },
      region: {
        ...lagos.region,
        id: "abuja",
        name: "Abuja",
        areas: [{ id: "wuse", name: "Wuse" }],
      },
      locations: [
        {
          id: "loc_wuse_home",
          regionId: "abuja",
          areaId: "wuse",
          name: "Wuse flat",
          type: "home",
          hours: null,
          capacity: 4,
          outdoor: false,
        },
      ],
      characters: [
        {
          ...lagos.characters[1]!,
          id: "c_abuja_test",
          regionId: "abuja",
          homeId: "loc_wuse_home",
          job: null,
          knownLocations: [],
          offers: [],
          goals: [],
          routine: {
            weekday: [{ from: "00:00", at: "home", activity: "sleep" }],
            weekend: [{ from: "00:00", at: "home", activity: "sleep" }],
            variations: [],
          },
        },
      ],
      relationships: [],
    });
    const base = loadContent();
    const bundle = buildBundle([lagos, abuja], base.quests, base.worldEvents);
    expect(bundle.regions.map((r) => r.id)).toEqual(["lagos", "abuja"]);
  });
});
