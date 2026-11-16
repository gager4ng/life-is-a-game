export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const round2 = (v: number): number => Math.round(v * 100) / 100;

export function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

export function sortedKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o).sort();
}

/** Ordered pair key so the same two people always map to one key. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
