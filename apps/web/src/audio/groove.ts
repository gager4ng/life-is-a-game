/**
 * An Afrobeats-style groove, generated: patterns, chords and timing only (no audio here), so it
 * can be unit-tested. `music.ts` turns the events into sound with Web Audio.
 *
 * One bar = 16 sixteenth-note steps. Odd steps are pushed late a little (swing). Each bar's
 * pattern comes from a small seeded generator, so a few hits change from bar to bar, there are
 * fills every fourth bar, and whole layers drop out and come back every few bars: it does not
 * loop obviously, but the same seed always gives the same music.
 */

export type Instrument = "kick" | "logdrum" | "shaker" | "bell" | "bass" | "chord" | "perc" | "rim";

export type GrooveMode = "day" | "night" | "live";

export interface Arrangement {
  bpm: number;
  /** 0..1, how far odd sixteenths are pushed late (fraction of a step). */
  swing: number;
  layers: readonly Instrument[];
  /** Overall energy: more hits and fills when higher. */
  energy: number;
}

export const ARRANGEMENTS: Record<GrooveMode, Arrangement> = {
  // Daytime background: the full groove, kept light.
  day: {
    bpm: 104,
    swing: 0.14,
    layers: ["kick", "logdrum", "shaker", "bell", "bass", "chord", "perc", "rim"],
    energy: 0.6,
  },
  // Night: slower, no kick, softer.
  night: {
    bpm: 100,
    swing: 0.12,
    layers: ["shaker", "bell", "bass", "chord", "perc"],
    energy: 0.3,
  },
  // The band at the live spot: a bit faster, everything in.
  live: {
    bpm: 108,
    swing: 0.16,
    layers: ["kick", "logdrum", "shaker", "bell", "bass", "chord", "perc", "rim"],
    energy: 1,
  },
};

export const STEPS_PER_BAR = 16;

export function stepSeconds(bpm: number): number {
  return 60 / bpm / 4;
}

export function barSeconds(bpm: number): number {
  return stepSeconds(bpm) * STEPS_PER_BAR;
}

/** Start time of a step (counted from the beginning of the groove), with swing on odd steps. */
export function stepTime(step: number, a: Pick<Arrangement, "bpm" | "swing">): number {
  const s = stepSeconds(a.bpm);
  return step * s + (step % 2 === 1 ? a.swing * s : 0);
}

export interface NoteEvent {
  /** Seconds from the start of the groove. */
  time: number;
  inst: Instrument;
  /** MIDI note numbers (several for a chord). */
  notes: number[];
  /** 0..1 */
  vel: number;
  /** Seconds. */
  dur: number;
}

/** Chords in A minor, as MIDI notes (warm voicings around middle C). */
const CHORDS: Record<string, number[]> = {
  Am9: [57, 60, 64, 67, 71],
  Dm9: [50, 57, 60, 64, 65],
  G6: [55, 59, 62, 64],
  Cmaj7: [48, 55, 59, 64],
  Fmaj7: [53, 57, 60, 64],
  Em7: [52, 55, 59, 62],
};

/** Four-bar progressions; a phrase picks one. */
export const PROGRESSIONS: readonly (readonly string[])[] = [
  ["Am9", "Dm9", "G6", "Cmaj7"],
  ["Fmaj7", "Em7", "Am9", "Am9"],
  ["Dm9", "G6", "Cmaj7", "Am9"],
];

/** Tiny seeded generator, so a bar's variation depends only on (seed, bar). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function chordFor(bar: number, seed: number): { name: string; notes: number[] } {
  const phrase = Math.floor(bar / 4);
  const r = rng(seed * 7919 + phrase * 104729);
  const prog = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)]!;
  const name = prog[bar % 4]!;
  return { name, notes: CHORDS[name]! };
}

/** Which layers play in this bar: every 8 bars one layer may sit out for a while. */
export function layersFor(bar: number, a: Arrangement, seed: number): Instrument[] {
  const section = Math.floor(bar / 8);
  const r = rng(seed * 31 + section * 977);
  const optional: Instrument[] = ["logdrum", "chord", "perc", "bell"];
  const out = optional[Math.floor(r() * optional.length)]!;
  const sitsOut = r() < 0.55 && bar % 8 < 4;
  return a.layers.filter((l) => !(sitsOut && l === out));
}

const BASE: Partial<Record<Instrument, number[]>> = {
  kick: [0, 6, 8],
  rim: [3, 6, 10, 12],
  bell: [0, 3, 6, 10, 12],
  bass: [0, 7, 10],
  logdrum: [0, 3, 7, 10, 14],
  perc: [2, 7, 11, 13],
};

/** All the notes of one bar, with times relative to the groove start. */
export function barEvents(bar: number, a: Arrangement, seed: number): NoteEvent[] {
  const r = rng(seed * 1009 + bar * 65537);
  const layers = layersFor(bar, a, seed);
  const chord = chordFor(bar, seed);
  const root = chord.notes[0]! % 12;
  const s = stepSeconds(a.bpm);
  const at = (step: number): number => stepTime(bar * STEPS_PER_BAR + step, a);
  const fill = bar % 4 === 3;
  const out: NoteEvent[] = [];
  const add = (
    inst: Instrument,
    step: number,
    notes: number[],
    vel: number,
    steps: number,
  ): void => {
    out.push({ time: at(step), inst, notes, vel: Math.max(0, Math.min(1, vel)), dur: steps * s });
  };
  for (const inst of layers) {
    switch (inst) {
      case "shaker":
        for (let i = 0; i < 16; i++) {
          if (a.energy < 0.4 && i % 2 === 1 && r() < 0.5) continue;
          add("shaker", i, [], i % 4 === 2 ? 0.7 : i % 2 === 0 ? 0.35 : 0.5, 1);
        }
        break;
      case "chord":
        // A soft pad on the downbeat and two short stabs on the offbeats.
        add("chord", 0, chord.notes, 0.35, 16);
        for (const st of [3, 10])
          if (r() < 0.6 + a.energy * 0.3) add("chord", st, chord.notes, 0.5, 2);
        break;
      case "bass": {
        const steps = [...BASE.bass!];
        if (r() < 0.4) steps.push(14);
        for (const st of steps)
          add("bass", st, [36 + root], st === 0 ? 0.9 : 0.7, st === 0 ? 5 : 3);
        break;
      }
      case "logdrum": {
        const pitches = [root, root + 7, root + 12, root + 10, root + 5];
        for (const [i, st] of BASE.logdrum!.entries()) {
          if (i > 0 && r() < 0.25) continue;
          add("logdrum", st, [36 + pitches[i % pitches.length]!], 0.8, 3);
        }
        if (fill) add("logdrum", 15, [36 + root + 12], 0.7, 1);
        break;
      }
      default: {
        const steps = [...(BASE[inst] ?? [])];
        if (inst === "kick" && r() < 0.3) steps.push(14);
        if (inst === "perc" && fill) steps.push(12, 14, 15);
        for (const st of steps) {
          if (inst !== "kick" && r() < 0.12 * (1 - a.energy)) continue;
          const note = inst === "bell" ? [88] : inst === "perc" ? [st % 2 ? 62 : 57] : [];
          add(inst, st, note, inst === "kick" ? 0.9 : 0.55 + r() * 0.2, 1);
        }
      }
    }
  }
  return out.sort((x, y) => x.time - y.time || x.inst.localeCompare(y.inst));
}

/**
 * Look-ahead scheduling: each call returns the notes that start before `until` and were not
 * returned before. Time 0 is when the groove started.
 */
export class Sequencer {
  private nextBar = 0;
  private pending: NoteEvent[] = [];

  constructor(
    public arrangement: Arrangement,
    private readonly seed = 1,
  ) {}

  /** Notes starting in [previous until, until). */
  take(until: number): NoteEvent[] {
    while (this.nextBar * barSeconds(this.arrangement.bpm) < until) {
      this.pending.push(...barEvents(this.nextBar, this.arrangement, this.seed));
      this.nextBar++;
    }
    const due = this.pending.filter((e) => e.time < until);
    this.pending = this.pending.filter((e) => e.time >= until);
    return due;
  }

  get bar(): number {
    return this.nextBar;
  }
}
