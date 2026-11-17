import type { WeatherKind } from "@liag/engine";

/**
 * How loud each ambient layer should be, from the time of day, the weather and how far the
 * camera is from each sound source. Pure, so it is unit-tested; the audio code only applies it.
 */

export type Layer =
  "traffic" | "market" | "park" | "buka" | "live" | "insects" | "rain" | "wind" | "music";

export type Mix = Record<Layer, number>;

export interface SourcePos {
  layer: "market" | "park" | "buka" | "live";
  /** Tile units. */
  x: number;
  y: number;
}

export interface MixInput {
  /** Minute of day (fractional ok). */
  minute: number;
  weather: WeatherKind;
  /** Listener (camera centre) in tile units. */
  listener: { x: number; y: number };
  /** Camera zoom: zoomed out = listening from higher up, so everything is further away. */
  zoom: number;
  sources: SourcePos[];
  /** Distance in tiles to the nearest road. */
  roadDistance: number;
}

/** 1 next to the source, about 0.5 at 6 tiles, fading towards 0 further away. */
export function falloff(distTiles: number): number {
  return 1 / (1 + (distTiles / 6) ** 2);
}

const between = (m: number, from: number, to: number): boolean => m >= from && m < to;

/** 0 at night, 1 by day, with soft edges around dawn and dusk. */
export function daylight(minute: number): number {
  const m = ((minute % 1440) + 1440) % 1440;
  if (m < 5 * 60 || m >= 21 * 60) return 0;
  if (m < 6.5 * 60) return (m - 5 * 60) / 90;
  if (m >= 19.5 * 60) return 1 - (m - 19.5 * 60) / 90;
  return 1;
}

export function ambientMix(i: MixInput): Mix {
  const m = ((i.minute % 1440) + 1440) % 1440;
  const day = daylight(m);
  const height = 4 / Math.max(0.3, i.zoom);
  const near = (layer: SourcePos["layer"]): number => {
    let best = 0;
    for (const s of i.sources) {
      if (s.layer !== layer) continue;
      const d = Math.hypot(s.x - i.listener.x, s.y - i.listener.y, height);
      best = Math.max(best, falloff(d));
    }
    return best;
  };
  const rush = between(m, 7 * 60, 9.5 * 60) || between(m, 17 * 60, 19.5 * 60) ? 1.25 : 1;
  const road = falloff(Math.hypot(i.roadDistance, height) * 0.6);
  const rainy = i.weather === "rain" || i.weather === "heavy_rain";
  const traffic = Math.min(1, (0.25 + 0.75 * day) * rush * (0.35 + 0.65 * road));
  const market = between(m, 6.5 * 60, 19.5 * 60) ? near("market") * (rainy ? 0.5 : 1) : 0;
  const park = between(m, 5 * 60, 22 * 60) ? near("park") * (0.4 + 0.6 * day) : 0;
  const buka = between(m, 6.5 * 60, 21.5 * 60) ? near("buka") : 0;
  const evening = between(m, 18 * 60, 24 * 60) ? 1 : between(m, 16 * 60, 18 * 60) ? 0.35 : 0;
  const live = near("live") * evening;
  const insects = (1 - day) * (rainy ? 0.3 : 1);
  const rain = i.weather === "heavy_rain" ? 1 : i.weather === "rain" ? 0.55 : 0;
  const wind = i.weather === "harmattan" ? 0.6 : i.weather === "heavy_rain" ? 0.35 : 0.08;
  // Background music stays low; it gives way where the live spot is playing.
  const music = 0.6 * (1 - Math.min(1, live * 1.5));
  return { traffic, market, park, buka, live, insects, rain, wind, music };
}

/** Left/right placement of a source relative to the listener, -1..1 (screen x of iso tiles). */
export function panFor(src: { x: number; y: number }, listener: { x: number; y: number }): number {
  const sx = src.x - src.y - (listener.x - listener.y);
  return Math.max(-1, Math.min(1, sx / 16));
}
