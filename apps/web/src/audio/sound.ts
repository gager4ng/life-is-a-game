import type { GrooveMode } from "./groove";
import type { Layer, Mix } from "./mix";
import type { MusicSource, TrackList } from "./music";
import { GeneratedMusic, TrackMusic, parseTrackList } from "./music";

/**
 * Web Audio for the prototype. Starts on the first tap (browsers only allow sound after a user
 * gesture). Rain, wind, night insects, buka sizzle, thunder, every UI sound and the
 * Afrobeats-style music (background and the live spot) are generated in code; traffic, voices
 * and horns are small CC0 files (see docs/ASSETS.md), fetched only after the city is on screen.
 * Licensed tracks listed in public/music/tracks.json replace the generated music for a mode.
 * Settings (mute, volume, music) are remembered in localStorage.
 */

export interface SoundSettings {
  muted: boolean;
  /** 0..1 */
  volume: number;
  music: boolean;
}

export type UiSound = "tap" | "walk" | "chime" | "quest" | "moneyUp" | "moneyDown";

const SETTINGS_KEY = "liag:sound";
const DEFAULTS: SoundSettings = { muted: false, volume: 0.8, music: true };

/** Base loudness of each layer at mix 1 (they are mixed against each other here). */
const LEVEL: Record<Layer, number> = {
  traffic: 0.32,
  market: 0.3,
  park: 0.22,
  buka: 0.22,
  live: 0.42,
  insects: 0.1,
  rain: 0.4,
  wind: 0.14,
  music: 0.22,
};

const FILES = ["traffic", "chatter", "horn1", "horn2"] as const;
type FileName = (typeof FILES)[number];

export function loadSoundSettings(store: Pick<Storage, "getItem"> | null): SoundSettings {
  try {
    const raw = store?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      muted: typeof s.muted === "boolean" ? s.muted : DEFAULTS.muted,
      volume: typeof s.volume === "number" ? Math.max(0, Math.min(1, s.volume)) : DEFAULTS.volume,
      music: typeof s.music === "boolean" ? s.music : DEFAULTS.music,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

interface Channel {
  gain: GainNode;
  pan: StereoPannerNode;
  src: AudioBufferSourceNode | null;
}

export class SoundEngine {
  settings: SoundSettings;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private readonly channels = new Map<Layer, Channel>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private mix: Mix | null = null;
  private pans: Partial<Record<Layer, number>> = {};
  private nextHorn = 0;
  private nextThunder = 0;
  private nextClank = 0;
  private nextCall = 0;
  private filesRequested = false;
  /** Quieter ambience while an encounter is on screen. */
  private duck = 1;
  private musicMode: GrooveMode = "day";
  private bgMusic: MusicSource | null = null;
  private liveMusic: MusicSource | null = null;
  private tracks: TrackList = { day: [], night: [], live: [] };
  private readonly trackBuffers = new Map<string, AudioBuffer>();
  /** Which music is playing: "generated", or "tracks" when licensed files are in use. */
  musicKind: { background: "generated" | "tracks"; live: "generated" | "tracks" } = {
    background: "generated",
    live: "generated",
  };

  constructor(
    private readonly store: Pick<Storage, "getItem" | "setItem"> | null,
    private readonly baseUrl = "/",
  ) {
    this.settings = loadSoundSettings(store);
  }

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Call from a user gesture (first tap). Safe to call again. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.ambBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.uiBus = ctx.createGain();
    for (const b of [this.ambBus, this.musicBus, this.uiBus]) b.connect(this.master);
    this.applySettings();
    this.buildGenerated();
    for (const layer of Object.keys(LEVEL) as Layer[]) this.channel(layer);
    this.startGeneratedLoops();
    this.startMusic();
    this.loadFiles();
  }

  /** Day or night arrangement for the background music. */
  setMusicMode(mode: Exclude<GrooveMode, "live">): void {
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    if (this.musicKind.background === "tracks" && this.ctx) {
      // Switch playlists if this mode has its own tracks.
      this.bgMusic?.stop();
      this.bgMusic = this.makeMusic(mode, this.channel("music").gain);
    } else this.bgMusic?.setMode(mode);
  }

  private makeMusic(mode: GrooveMode, out: AudioNode): MusicSource {
    const names = this.tracks[mode].length
      ? this.tracks[mode]
      : mode === "night"
        ? this.tracks.day
        : [];
    const bufs = names.map((n) => this.trackBuffers.get(n)).filter((b): b is AudioBuffer => !!b);
    if (bufs.length) return new TrackMusic(this.ctx!, out, bufs);
    return new GeneratedMusic(this.ctx!, out, mode, mode === "live" ? 7 : 3);
  }

  private startMusic(): void {
    this.bgMusic = this.makeMusic(this.musicMode, this.channel("music").gain);
    this.liveMusic = this.makeMusic("live", this.channel("live").gain);
    // Licensed tracks, if any were dropped into public/music/.
    void fetch(`${this.baseUrl}music/tracks.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(async (raw: unknown) => {
        if (!raw || !this.ctx) return;
        this.tracks = parseTrackList(raw);
        const all = [...new Set([...this.tracks.day, ...this.tracks.night, ...this.tracks.live])];
        await Promise.all(
          all.map(async (name) => {
            try {
              const r = await fetch(`${this.baseUrl}music/${encodeURIComponent(name)}`);
              if (!r.ok) return;
              this.trackBuffers.set(name, await this.ctx!.decodeAudioData(await r.arrayBuffer()));
            } catch {
              /* a bad file is skipped */
            }
          }),
        );
        if (this.tracks.day.length || this.tracks.night.length) {
          this.bgMusic?.stop();
          this.bgMusic = this.makeMusic(this.musicMode, this.channel("music").gain);
          this.musicKind.background = this.bgMusic instanceof TrackMusic ? "tracks" : "generated";
        }
        if (this.tracks.live.length) {
          this.liveMusic?.stop();
          this.liveMusic = this.makeMusic("live", this.channel("live").gain);
          this.musicKind.live = this.liveMusic instanceof TrackMusic ? "tracks" : "generated";
        }
      })
      .catch(() => {
        /* no track list: generated music */
      });
  }

  set(s: Partial<SoundSettings>): void {
    this.settings = { ...this.settings, ...s };
    try {
      this.store?.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* private mode: just don't remember */
    }
    this.applySettings();
  }

  setDucked(on: boolean): void {
    this.duck = on ? 0.35 : 1;
  }

  private applySettings(): void {
    if (!this.ctx || !this.master || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const v = this.settings.muted ? 0 : this.settings.volume;
    this.master.gain.setTargetAtTime(v * v, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music ? 1 : 0, t, 0.2);
  }

  // ---------------------------------------------------------------------------
  // Ambience
  // ---------------------------------------------------------------------------

  private channel(layer: Layer): Channel {
    let ch = this.channels.get(layer);
    if (ch || !this.ctx) return ch!;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    gain.connect(pan);
    pan.connect(layer === "music" ? this.musicBus! : this.ambBus!);
    ch = { gain, pan, src: null };
    this.channels.set(layer, ch);
    return ch;
  }

  /** Start (or replace) the looping source of a layer, through an optional filter. */
  private loop(layer: Layer, buf: AudioBuffer, filter?: BiquadFilterNode, offset = 0): void {
    if (!this.ctx) return;
    const ch = this.channel(layer);
    ch.src?.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    if (filter) {
      src.connect(filter);
      filter.connect(ch.gain);
    } else src.connect(ch.gain);
    src.start(0, offset % buf.duration);
    ch.src = src;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** Apply a new mix (called a few times a second). `pans` places point sources left/right. */
  update(mix: Mix, pans: Partial<Record<Layer, number>>): void {
    this.mix = mix;
    this.pans = pans;
    if (!this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    for (const [layer, ch] of this.channels) {
      const duck = layer === "music" ? 1 : this.duck;
      ch.gain.gain.setTargetAtTime(mix[layer] * LEVEL[layer] * duck, t, 0.4);
      ch.pan.pan.setTargetAtTime(pans[layer] ?? 0, t, 0.4);
    }
    // Music sources only do work while they can be heard.
    const audible = !this.settings.muted && this.settings.volume > 0;
    this.bgMusic?.update(audible && this.settings.music && mix.music > 0.02);
    this.liveMusic?.update(audible && mix.live * this.duck > 0.02);
    this.randomEvents(t);
  }

  /** Horns on busy roads, thunder in heavy rain, pots at the buka, calls at the park. */
  private randomEvents(t: number): void {
    const m = this.mix!;
    const r = Math.random;
    if (t > this.nextHorn) {
      this.nextHorn = t + 2 + r() * 9;
      const horn = this.buffers.get(r() < 0.6 ? "horn1" : "horn2");
      if (horn && r() < m.traffic * 1.1)
        this.oneShot(
          horn,
          0.12 + 0.18 * m.traffic * this.duck,
          (r() - 0.5) * 1.4,
          0.85 + r() * 0.3,
        );
    }
    if (t > this.nextThunder) {
      this.nextThunder = t + 14 + r() * 30;
      if (m.rain >= 1 && r() < 0.8) this.thunder();
    }
    if (t > this.nextClank) {
      this.nextClank = t + 3 + r() * 6;
      if (m.buka > 0.2) this.clank(m.buka * this.duck, this.pans.buka ?? 0);
    }
    if (t > this.nextCall) {
      this.nextCall = t + 4 + r() * 7;
      const v = this.buffers.get("chatter");
      if (v && m.park > 0.15) {
        // A short burst of voices near the park, like a conductor calling out.
        this.oneShot(v, 0.35 * m.park * this.duck, this.pans.park ?? 0, 1.05 + r() * 0.15, {
          offset: r() * (v.duration - 2),
          duration: 1.2 + r() * 0.8,
          band: 1100,
        });
      }
    }
  }

  private oneShot(
    buf: AudioBuffer,
    vol: number,
    pan: number,
    rate = 1,
    opts: { offset?: number; duration?: number; band?: number } = {},
  ): void {
    if (!this.ctx || !this.ambBus) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const dur = opts.duration ?? buf.duration / rate;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + Math.max(0.05, dur - 0.15));
    g.gain.linearRampToValueAtTime(0, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    if (opts.band) {
      const f = this.filter("bandpass", opts.band, 0.9);
      src.connect(f);
      f.connect(g);
    } else src.connect(g);
    g.connect(p);
    p.connect(this.ambBus);
    src.start(t, opts.offset ?? 0, dur + 0.05);
  }

  private thunder(): void {
    const ctx = this.ctx!;
    const buf = this.buffers.get("brown")!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = this.filter("lowpass", 260);
    const g = ctx.createGain();
    const t = ctx.currentTime + 0.3 + Math.random();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * this.duck, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.ambBus!);
    src.start(t, Math.random() * 2, 3.6);
  }

  /** A pot lid or spoon: a few inharmonic partials that ring out briefly. */
  private clank(level: number, pan: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.gain.setValueAtTime(0.05 * level, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.35);
    g.connect(p);
    p.connect(this.ambBus!);
    const base = 700 + Math.random() * 500;
    for (const k of [1, 2.76, 5.4]) {
      const o = ctx.createOscillator();
      o.frequency.value = base * k;
      o.connect(g);
      o.start(t);
      o.stop(t + 0.4);
    }
  }

  // ---------------------------------------------------------------------------
  // Generated buffers
  // ---------------------------------------------------------------------------

  private makeBuffer(seconds: number, fill: (d: Float32Array, rate: number) => void): AudioBuffer {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, Math.floor(seconds * ctx.sampleRate), ctx.sampleRate);
    fill(b.getChannelData(0), ctx.sampleRate);
    return b;
  }

  private buildGenerated(): void {
    // Pink-ish noise (rain, wind) and brown noise (thunder, traffic fallback), 4 s loops.
    this.buffers.set(
      "pink",
      this.makeBuffer(4, (d) => {
        let b0 = 0;
        let b1 = 0;
        let b2 = 0;
        for (let i = 0; i < d.length; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.997 * b0 + w * 0.029591;
          b1 = 0.985 * b1 + w * 0.032534;
          b2 = 0.95 * b2 + w * 0.048056;
          d[i] = (b0 + b1 + b2 + w * 0.05) * 2.2;
        }
      }),
    );
    this.buffers.set(
      "brown",
      this.makeBuffer(4, (d) => {
        let last = 0;
        for (let i = 0; i < d.length; i++) {
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          d[i] = last * 3.5;
        }
      }),
    );
    // Crickets: short pulse trains at a few pitches, 3 s loop.
    this.buffers.set(
      "crickets",
      this.makeBuffer(3, (d, rate) => {
        for (const [freq, every, phase] of [
          [4600, 0.55, 0.0],
          [5100, 0.8, 0.21],
          [4300, 0.65, 0.4],
        ] as const) {
          for (let start = phase; start < 3 - 0.2; start += every) {
            for (let p = 0; p < 3; p++) {
              const s0 = Math.floor((start + p * 0.035) * rate);
              const len = Math.floor(0.018 * rate);
              for (let i = 0; i < len && s0 + i < d.length; i++) {
                const env = Math.sin((Math.PI * i) / len);
                d[s0 + i]! += 0.25 * env * Math.sin((2 * Math.PI * freq * i) / rate);
              }
            }
          }
        }
      }),
    );
    // Frying: fizzy high noise with crackles, 3 s loop.
    this.buffers.set(
      "sizzle",
      this.makeBuffer(3, (d) => {
        let prev = 0;
        for (let i = 0; i < d.length; i++) {
          const w = Math.random() * 2 - 1;
          const hp = w - prev;
          prev = w;
          d[i] = hp * 0.12 + (Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.9 : 0);
        }
      }),
    );
  }

  private startGeneratedLoops(): void {
    this.loop("rain", this.buffers.get("pink")!, this.filter("bandpass", 2400, 0.5));
    this.loop("wind", this.buffers.get("pink")!, this.filter("bandpass", 500, 1.2), 1.7);
    this.loop("insects", this.buffers.get("crickets")!);
    this.loop("buka", this.buffers.get("sizzle")!, this.filter("highpass", 2500));
    // Until the recording loads, traffic is a low rumble.
    this.loop("traffic", this.buffers.get("brown")!, this.filter("lowpass", 400));
  }

  private loadFiles(): void {
    if (this.filesRequested || !this.ctx) return;
    this.filesRequested = true;
    const ctx = this.ctx;
    for (const name of FILES) {
      void fetch(`${this.baseUrl}audio/${name}.ogg`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => ctx.decodeAudioData(data))
        .then((buf) => {
          this.buffers.set(name, buf);
          this.onFile(name, buf);
        })
        .catch(() => {
          /* missing or undecodable: that layer stays silent or generated */
        });
    }
  }

  private onFile(name: FileName, buf: AudioBuffer): void {
    if (name === "traffic") this.loop("traffic", buf, this.filter("lowpass", 3000));
    if (name === "chatter") {
      this.loop("market", buf, this.filter("lowpass", 2200));
    }
  }

  /** Which files have loaded (for tests and the status line). */
  loaded(): string[] {
    return FILES.filter((f) => this.buffers.has(f));
  }

  // ---------------------------------------------------------------------------
  // UI sounds (all generated)
  // ---------------------------------------------------------------------------

  ui(kind: UiSound): void {
    if (!this.ctx || !this.uiBus || this.ctx.state !== "running") return;
    const notes: Record<UiSound, [number, number, OscillatorType, number][]> = {
      // [frequency, start offset s, wave, length s]
      tap: [[880, 0, "sine", 0.05]],
      walk: [
        [523, 0, "triangle", 0.09],
        [784, 0.08, "triangle", 0.12],
      ],
      chime: [
        [880, 0, "sine", 0.6],
        [1320, 0.12, "sine", 0.6],
        [1760, 0.24, "sine", 0.8],
      ],
      quest: [
        [523, 0, "triangle", 0.18],
        [659, 0.12, "triangle", 0.18],
        [784, 0.24, "triangle", 0.18],
        [1046, 0.36, "triangle", 0.5],
      ],
      moneyUp: [
        [1318, 0, "square", 0.07],
        [1760, 0.07, "square", 0.22],
      ],
      moneyDown: [
        [440, 0, "sawtooth", 0.12],
        [330, 0.1, "sawtooth", 0.12],
        [220, 0.2, "sawtooth", 0.25],
      ],
    };
    const vol = kind === "tap" ? 0.12 : kind.startsWith("money") ? 0.08 : 0.16;
    const t0 = this.ctx.currentTime + 0.01;
    for (const [f, off, wave, len] of notes[kind]) {
      const o = this.ctx.createOscillator();
      o.type = wave;
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t0 + off);
      g.gain.linearRampToValueAtTime(vol, t0 + off + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + off + len);
      o.connect(g);
      g.connect(this.uiBus);
      o.start(t0 + off);
      o.stop(t0 + off + len + 0.05);
    }
  }
}
