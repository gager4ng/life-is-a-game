import { describe, expect, it } from "vitest";
import { createRng, intBetween, nextFloat, weighted } from "../src/rng";

describe("rng", () => {
  it("gives the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 50 }, () => nextFloat(a));
    const ys = Array.from({ length: 50 }, () => nextFloat(b));
    expect(xs).toEqual(ys);
  });

  it("gives different sequences for different seeds", () => {
    const a = createRng(42);
    const b = createRng(43);
    expect(nextFloat(a)).not.toEqual(nextFloat(b));
  });

  it("keeps integers in range and respects zero weights", () => {
    const r = createRng("bounds");
    for (let i = 0; i < 2000; i++) {
      const n = intBetween(r, -3, 7);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(7);
      expect(
        weighted(r, [
          ["never", 0],
          ["always", 1],
        ] as const),
      ).toBe("always");
    }
  });
});
