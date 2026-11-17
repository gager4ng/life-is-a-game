import type { GrooveMode, NoteEvent } from "./groove";
import { ARRANGEMENTS, Sequencer, barSeconds } from "./groove";

/**
 * Music sources. Every source plays into an output node and can be faded; a source is either
 * the generated Afrobeats-style groove or licensed tracks dropped into `public/music/` and listed
 * in `public/music/tracks.json` (they take over from the generator for that mode).
 */
export interface MusicSource {
  setMode(mode: GrooveMode): void;
  /** Called a few times a second; `active` false lets the source go quiet and save work. */
  update(active: boolean): void;
  stop(): void;
}

const midiHz = (n: number): number => 440 * 2 ** ((n - 69) / 12);

/** How far ahead notes are scheduled (s); covers slow phones and throttled timers. */
const AHEAD = 0.6;

/**
 * The generated groove: log drum, kick, shaker, bell, rim, bass, warm chords and light
 * percussion, all synthesised. Shared filters per instrument keep the node count low.
 */
export class GeneratedMusic implements MusicSource {
  private seq: Sequencer;
  private origin: number;
  private mode: GrooveMode;
  private readonly bus: GainNode;
  private readonly noise: AudioBuffer;
  private readonly shakerHp: BiquadFilterNode;
  private readonly rimBp: BiquadFilterNode;
  private readonly chordLp: BiquadFilterNode;
  private readonly logLp: BiquadFilterNode;
  private readonly tone: BiquadFilterNode;
  private running = false;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    mode: GrooveMode,
    private readonly seed: number,
  ) {
    this.mode = mode;
    this.seq = new Sequencer(ARRANGEMENTS[mode], seed);
    this.origin = ctx.currentTime + 0.1;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.9;
    // A gentle overall tone control: darker at night.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = mode === "night" ? 2600 : 9000;
    this.bus.connect(this.tone);
    this.tone.connect(out);
    const mk = (type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      n.connect(this.bus);
      return n;
    };
    this.shakerHp = mk("highpass", 6500);
    this.rimBp = mk("bandpass", 1900, 3);
    this.chordLp = mk("lowpass", 1500, 0.4);
    this.logLp = mk("lowpass", 900, 4);
    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  setMode(mode: GrooveMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // Switch at the next bar line so the groove doesn't stumble.
    const now = this.ctx.currentTime - this.origin;
    const bar = barSeconds(this.seq.arrangement.bpm);
    const nextBar = Math.ceil((now + AHEAD) / bar) * bar;
    for (const e of this.seq.take(nextBar)) this.play(e); // finish the current bar
    this.origin += nextBar;
    this.seq = new Sequencer(ARRANGEMENTS[mode], this.seed + this.seq.bar);
    this.tone.frequency.setTargetAtTime(mode === "night" ? 2600 : 9000, this.ctx.currentTime, 1);
  }

  update(active: boolean): void {
    const now = this.ctx.currentTime;
    if (!active) {
      this.running = false;
      return;
    }
    if (!this.running) {
      // (Re)start on a fresh bar a moment from now.
      this.running = true;
      this.seq = new Sequencer(ARRANGEMENTS[this.mode], this.seed + Math.floor(now));
      this.origin = now + 0.1;
    }
    for (const e of this.seq.take(now - this.origin + AHEAD)) this.play(e);
  }

  stop(): void {
    this.running = false;
    this.bus.disconnect();
  }

  // --- Voices ---------------------------------------------------------------

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private osc(
    type: OscillatorType,
    hz: number,
    t: number,
    len: number,
    to: AudioNode,
  ): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    o.connect(to);
    o.start(t);
    o.stop(t + len + 0.05);
    return o;
  }

  private play(e: NoteEvent): void {
    const t = this.origin + e.time;
    if (t < this.ctx.currentTime - 0.02) return;
    const v = e.vel;
    switch (e.inst) {
      case "kick": {
        const g = this.env(t, 0.9 * v, 0.004, 0.28);
        g.connect(this.bus);
        const o = this.osc("sine", 140, t, 0.3, g);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        break;
      }
      case "logdrum": {
        // The log drum: a pitched, resonant bass hit that drops into the note.
        const hz = midiHz(e.notes[0]!);
        const g = this.env(t, 0.55 * v, 0.006, Math.min(0.45, e.dur + 0.1));
        g.connect(this.logLp);
        const o = this.osc("triangle", hz * 1.5, t, e.dur + 0.15, g);
        o.frequency.exponentialRampToValueAtTime(hz, t + 0.05);
        const o2 = this.osc("sine", hz, t, e.dur + 0.15, g);
        o2.detune.value = 6;
        break;
      }
      case "shaker":
      case "rim": {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise;
        const shaker = e.inst === "shaker";
        const g = this.env(t, (shaker ? 0.16 : 0.32) * v, 0.002, shaker ? 0.045 : 0.05);
        src.connect(g);
        g.connect(shaker ? this.shakerHp : this.rimBp);
        src.start(t, Math.random() * 0.3, 0.12);
        break;
      }
      case "bell": {
        // Agogo-style bell: two inharmonic partials.
        const hz = midiHz(e.notes[0] ?? 88);
        const g = this.env(t, 0.09 * v, 0.002, 0.18);
        g.connect(this.bus);
        this.osc("sine", hz, t, 0.2, g);
        this.osc("triangle", hz * 1.48, t, 0.12, g);
        break;
      }
      case "bass": {
        const hz = midiHz(e.notes[0]!);
        const g = this.env(t, 0.42 * v, 0.01, e.dur);
        g.connect(this.bus);
        this.osc("sine", hz, t, e.dur + 0.05, g);
        this.osc("triangle", hz * 2, t, e.dur * 0.5, g).detune.value = -4;
        break;
      }
      case "chord": {
        const pad = e.dur > 1;
        const g = this.ctx.createGain();
        const peak = (pad ? 0.035 : 0.05) * v;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + (pad ? 0.35 : 0.015));
        g.gain.setTargetAtTime(0.0001, t + (pad ? e.dur * 0.7 : 0.08), pad ? 0.5 : 0.08);
        g.connect(this.chordLp);
        for (const n of e.notes) {
          for (const det of [-7, 7]) {
            const o = this.osc("sawtooth", midiHz(n), t, e.dur + (pad ? 1.2 : 0.4), g);
            o.detune.value = det;
          }
        }
        break;
      }
      case "perc": {
        // A conga-ish tom.
        const hz = midiHz(e.notes[0] ?? 60);
        const g = this.env(t, 0.22 * v, 0.003, 0.16);
        g.connect(this.bus);
        const o = this.osc("sine", hz * 1.3, t, 0.2, g);
        o.frequency.exponentialRampToValueAtTime(hz, t + 0.04);
        break;
      }
    }
  }
}

/** Licensed tracks for one mode, played in turn (each loops until the mode changes). */
export class TrackMusic implements MusicSource {
  private src: AudioBufferSourceNode | null = null;
  private index = 0;
  private playing = false;
  private readonly out: GainNode;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    private readonly tracks: AudioBuffer[],
  ) {
    this.out = ctx.createGain();
    this.out.connect(out);
  }

  setMode(): void {
    /* one TrackMusic per mode; the engine picks which to use */
  }

  update(active: boolean): void {
    if (active && !this.playing && this.tracks.length) {
      this.playing = true;
      const s = this.ctx.createBufferSource();
      s.buffer = this.tracks[this.index % this.tracks.length]!;
      this.index++;
      s.connect(this.out);
      s.onended = () => {
        if (this.src === s) this.playing = false;
      };
      s.start();
      this.src = s;
    } else if (!active && this.playing) {
      this.playing = false;
      this.src?.stop();
      this.src = null;
    }
  }

  stop(): void {
    this.update(false);
    this.out.disconnect();
  }
}

/** `public/music/tracks.json`: file names (in `public/music/`) per mode. Empty = generated. */
export interface TrackList {
  day: string[];
  night: string[];
  live: string[];
}

export function parseTrackList(raw: unknown): TrackList {
  const pick = (k: string): string[] => {
    const v = (raw as Record<string, unknown> | null)?.[k];
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
  };
  return { day: pick("day"), night: pick("night"), live: pick("live") };
}
