import { hashSeed } from "@liag/engine";

/** Stable 32-bit hash of any key (same function the engine uses). */
export function hash(key: string): number {
  return hashSeed(key);
}

/** Stable value in [0, 1) for a key. */
export function hash01(key: string): number {
  return hashSeed(key) / 4294967296;
}

/**
 * Small seeded generator for things that are only decoration (traffic, walkers, rain).
 * The simulation never sees these numbers.
 */
export class Rand {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}
