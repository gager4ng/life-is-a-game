/** Colour helpers on 0xRRGGBB numbers. */

export function hex(s: string): number {
  return parseInt(s.replace("#", ""), 16);
}

function ch(c: number, shift: number): number {
  return (c >> shift) & 0xff;
}

function pack(r: number, g: number, b: number): number {
  const k = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return (k(r) << 16) | (k(g) << 8) | k(b);
}

/** Multiply brightness (f < 1 darker, f > 1 lighter). */
export function shade(c: number, f: number): number {
  return pack(ch(c, 16) * f, ch(c, 8) * f, ch(c, 0) * f);
}

export function mix(a: number, b: number, t: number): number {
  return pack(
    ch(a, 16) + (ch(b, 16) - ch(a, 16)) * t,
    ch(a, 8) + (ch(b, 8) - ch(a, 8)) * t,
    ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t,
  );
}

export function css(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

/** Lagos street palette: painted walls, zinc and tile roofs, signboards. */
export const PALETTE = {
  walls: [
    0xf4d58d, 0xf7b267, 0xf79d84, 0x9ad1d4, 0xc3e8bd, 0xf6e7cb, 0xe0bbe4, 0xa0c4ff, 0xffd6a5,
    0xd8e2dc, 0xb5ead7, 0xfcd5ce,
  ],
  roofs: [0x8d5a3b, 0x9e9e9e, 0x6d4c41, 0xa0522d, 0x7f8c8d, 0xb0623f],
  signs: [0xd62828, 0x1d3557, 0x2a9d8f, 0xf77f00, 0x6a4c93, 0x118ab2, 0x06d6a0, 0xef476f],
  road: 0x4a4a4f,
  roadLine: 0xe9e4d4,
  sidewalk: 0xc9c2b4,
  kerb: 0xa39e92,
  yard: 0xd8c3a0,
  grass: 0x7fb069,
  water: 0x4f7d8c,
  lot: 0x9b8f7a,
  danfo: 0xf6c90e,
  skyDay: 0x9fc9e6,
  skyNight: 0x0f1630,
  skyRain: 0x6b7680,
  skyHaze: 0xd9c6a0,
} as const;

export const SKIN = [0xf0c8a0, 0xd9a173, 0xb67a4b, 0x8d5524, 0x6b3e1f, 0x4a2a14];
