import type { Texture } from "pixi.js";
import { Container, Graphics, Sprite } from "pixi.js";
import type { WeatherKind } from "@liag/engine";
import { PALETTE, mix } from "./color";
import { Rand } from "../util/random";

/**
 * Sky colour, darkness, rain and harmattan haze, all in screen space over the city. Rain is a
 * pool of sprites sharing one texture (no per-frame geometry).
 */

/** 0 in daylight, 1 at night, with dawn and dusk ramps. `minute` is minute of the day. */
export function nightFactor(minute: number): number {
  const ramp = (m: number, a: number, b: number): number =>
    Math.max(0, Math.min(1, (m - a) / (b - a)));
  if (minute < 5 * 60 + 30) return 1;
  if (minute < 7 * 60) return 1 - ramp(minute, 5 * 60 + 30, 7 * 60);
  if (minute < 18 * 60 + 15) return 0;
  if (minute < 19 * 60 + 45) return ramp(minute, 18 * 60 + 15, 19 * 60 + 45);
  return 1;
}

export interface Lighting {
  /** Multiply tint for the city. */
  tint: number;
  /** How strongly lights glow. */
  night: number;
  sky: number;
}

export function lightingFor(minute: number, weather: WeatherKind): Lighting {
  const n = nightFactor(minute);
  const dusk = Math.max(0, 1 - Math.abs(minute - 18.8 * 60) / 60) * 0.5;
  let tint = mix(0xffffff, 0x5a6aa8, n * 0.85);
  tint = mix(tint, 0xffb27a, dusk * (1 - n));
  let sky = mix(PALETTE.skyDay, PALETTE.skyNight, n);
  if (weather === "rain" || weather === "heavy_rain") {
    const k = weather === "heavy_rain" ? 0.42 : 0.28;
    tint = mix(tint, 0x6f7c8a, k);
    sky = mix(sky, PALETTE.skyRain, 0.6 * (1 - n * 0.5));
  } else if (weather === "harmattan") {
    tint = mix(tint, 0xe8d5b0, 0.25 * (1 - n));
    sky = mix(sky, PALETTE.skyHaze, 0.7 * (1 - n));
  }
  // Lights come on a little before full dark, and in heavy cloud.
  const gloom = weather === "heavy_rain" ? 0.35 : weather === "rain" ? 0.15 : 0;
  return { tint, night: Math.min(1, n + gloom * (1 - n)), sky };
}

interface Drop {
  s: Sprite;
  vy: number;
}

export class WeatherView {
  readonly root = new Container();
  private readonly haze = new Graphics();
  private readonly rainLayer = new Container();
  private drops: Drop[] = [];
  private readonly rand = new Rand(99);
  private texture: Texture | null = null;
  private w = 0;
  private h = 0;
  private kind: WeatherKind = "dry";

  constructor(private readonly makeTexture: (g: Graphics) => Texture) {
    this.root.addChild(this.rainLayer, this.haze);
    this.root.eventMode = "none";
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.drawHaze();
  }

  set(kind: WeatherKind, night: number): void {
    if (kind !== this.kind) {
      this.kind = kind;
      this.drawHaze();
    }
    this.haze.alpha = kind === "harmattan" ? 0.32 * (1 - night * 0.6) : 0;
    const want = kind === "heavy_rain" ? 260 : kind === "rain" ? 120 : 0;
    while (this.drops.length < want) this.addDrop(true);
    while (this.drops.length > want) this.drops.pop()!.s.destroy();
  }

  private drawHaze(): void {
    this.haze.clear();
    this.haze.rect(0, 0, this.w, this.h).fill(0xd8c08e);
  }

  private addDrop(anywhere: boolean): void {
    if (!this.texture) {
      const g = new Graphics();
      g.rect(0, 0, 1.5, 14).fill({ color: 0xcfe3f5, alpha: 0.75 });
      this.texture = this.makeTexture(g);
      g.destroy();
    }
    const s = new Sprite(this.texture);
    s.rotation = 0.18;
    s.alpha = 0.4 + this.rand.next() * 0.5;
    s.x = this.rand.next() * (this.w + 80) - 40;
    s.y = anywhere ? this.rand.next() * this.h : -20;
    this.rainLayer.addChild(s);
    this.drops.push({ s, vy: 650 + this.rand.next() * 350 });
  }

  /** `dt` in real seconds (rain falls at real speed even when the game is paused, lightly). */
  update(dt: number): void {
    for (const d of this.drops) {
      d.s.y += d.vy * dt;
      d.s.x -= d.vy * dt * 0.18;
      if (d.s.y > this.h + 20) {
        d.s.y = -20 - this.rand.next() * 40;
        d.s.x = this.rand.next() * (this.w + 80) - 40;
      }
    }
  }
}
