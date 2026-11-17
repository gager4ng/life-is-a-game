import type { WeatherKind } from "@liag/engine";
import { PALETTE, mix } from "./color";

/**
 * Light for a time of day and weather: how dark it is, the sky colour, and where the sun is.
 * Pure, so it is unit-tested; the 3D view turns it into lights, fog and glows.
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
  /** Colour of the light on the city (sun and sky together). */
  tint: number;
  /** How strongly lamps and windows glow, 0..1. */
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

export interface Sun {
  /** Unit vector from the ground towards the sun (or the moon at night). World: x east, y up. */
  dir: [number, number, number];
  /** 0..1 strength of direct light. */
  strength: number;
  color: number;
}

/**
 * The sun rises in the east (+x) at about 06:00, is high at noon and sets in the west at about
 * 18:30; at night a weak, bluish moon light from a fixed direction. Clouds and haze soften it.
 */
export function sunAt(minute: number, weather: WeatherKind): Sun {
  const rise = 6 * 60;
  const set = 18.5 * 60;
  const t = (minute - rise) / (set - rise);
  const cloud =
    weather === "heavy_rain" ? 0.25 : weather === "rain" ? 0.45 : weather === "harmattan" ? 0.6 : 1;
  if (t <= 0 || t >= 1) {
    return { dir: [-0.35, 0.8, 0.45], strength: 0.18 * cloud, color: 0x8fa6ff };
  }
  const a = t * Math.PI;
  const x = Math.cos(a);
  const y = Math.sin(a);
  // A little to the south (Lagos is north of the equator), so walls facing +z get light too.
  const z = 0.35;
  const len = Math.hypot(x, y, z);
  const low = 1 - Math.min(1, y * 2.2);
  return {
    dir: [x / len, y / len, z / len],
    strength: Math.min(1, 0.25 + y) * cloud,
    color: mix(0xfff4e0, 0xffa060, low),
  };
}
