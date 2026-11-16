import { describe, expect, it } from "vitest";
import { REL_DIMS } from "../src/content-types";
import { adjustRel, openSink } from "../src/effects";
import { appendEvent } from "../src/ledger";
import { createRng, intBetween } from "../src/rng";
import { REL_BOUNDS } from "../src/types";
import { testWorld } from "./helpers";

describe("relationships", () => {
  it("keeps every dimension inside its bounds, and records the change actually applied", () => {
    const w = testWorld();
    const r = createRng("rel-bounds");
    for (let i = 0; i < 400; i++) {
      const sink = openSink(w);
      const deltas = Object.fromEntries(REL_DIMS.map((d) => [d, intBetween(r, -300, 300)]));
      adjustRel(w, sink, "t_player", "t_giver", deltas);
      appendEvent(w, {
        type: "encounter_resolved",
        actors: [],
        location: null,
        causes: [w.rootEventId],
        effects: sink.effects,
      });
      const rel = w.relationships["t_player>t_giver"]!;
      for (const d of REL_DIMS) {
        const [lo, hi] = REL_BOUNDS[d];
        expect(rel[d]).toBeGreaterThanOrEqual(lo);
        expect(rel[d]).toBeLessThanOrEqual(hi);
      }
      for (const e of sink.effects) {
        if (e.kind === "relationship") expect(rel[e.dim]).toBe(e.value);
      }
    }
  });

  it("tracks each direction separately", () => {
    const w = testWorld();
    const sink = openSink(w);
    adjustRel(w, sink, "t_player", "t_giver", { trust: 10 });
    expect(w.relationships["t_player>t_giver"]!.trust).toBe(10);
    expect(w.relationships["t_giver>t_player"]).toBeUndefined();
  });
});
