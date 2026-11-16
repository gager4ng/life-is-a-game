/**
 * The one seedable RNG (mulberry32). Its whole state is a single uint32 stored in the world,
 * so saving and loading the world also saves and restores the random stream.
 */
export interface RngState {
  s: number;
}

/** Hash any seed (number or string) into a uint32. */
export function hashSeed(seed: number | string): number {
  const str = String(seed);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

export function createRng(seed: number | string): RngState {
  return { s: hashSeed(seed) };
}

/** Uniform float in [0, 1). */
export function nextFloat(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** True with probability p. Probabilities of 0 or 1 do not consume randomness. */
export function chance(r: RngState, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return nextFloat(r) < p;
}

/** Integer in [min, max], inclusive. */
export function intBetween(r: RngState, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(nextFloat(r) * (max - min + 1));
}

export function weighted<T>(r: RngState, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  if (entries.length === 0) throw new Error("weighted() needs at least one entry");
  if (total <= 0) return entries[0]![0];
  let roll = nextFloat(r) * total;
  for (const [value, w] of entries) {
    roll -= Math.max(0, w);
    if (roll < 0) return value;
  }
  return entries[entries.length - 1]![0];
}
