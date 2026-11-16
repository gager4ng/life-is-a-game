import type { ClimateWeights, WeatherKind } from "./content-types";
import { appendEvent } from "./ledger";
import { chance, intBetween, weighted } from "./rng";
import { calendar, dayIndex, minuteOfDay } from "./time";
import type { DayWeather, World } from "./types";
import { getRegion } from "./world";

/**
 * Roll a day's weather from the region's monthly climate. Rain comes in spells (windows)
 * rather than all day, which is what makes "the rain held me at the danfo park" possible.
 * Wet days make the next day a little more likely to be wet.
 */
export function rollDayWeather(
  world: World,
  climate: ClimateWeights,
  prev: DayWeather | null,
): DayWeather {
  const w = { ...climate };
  if (prev && prev.windows.length > 0) {
    if (w.rain > 0) w.rain += 0.1;
    if (w.heavy_rain > 0) w.heavy_rain += 0.05;
  }
  const kind = weighted<WeatherKind>(world.rng, [
    ["dry", w.dry],
    ["rain", w.rain],
    ["heavy_rain", w.heavy_rain],
    ["harmattan", w.harmattan],
  ]);
  if (kind === "dry" || kind === "harmattan") return { base: kind, windows: [] };

  const heavy = kind === "heavy_rain";
  const spells = chance(world.rng, 0.3) ? 2 : 1;
  const windows: DayWeather["windows"] = [];
  for (let i = 0; i < spells; i++) {
    const from = 5 * 60 + 10 * intBetween(world.rng, 0, 96); // 05:00–21:00
    const length = 10 * (heavy ? intBetween(world.rng, 6, 18) : intBetween(world.rng, 6, 24));
    windows.push({ from, to: Math.min(1440, from + length), heavy: heavy && i === 0 });
  }
  windows.sort((a, b) => a.from - b.from);
  const merged: DayWeather["windows"] = [];
  for (const win of windows) {
    const last = merged[merged.length - 1];
    if (last && win.from <= last.to) {
      last.to = Math.max(last.to, win.to);
      last.heavy = last.heavy || win.heavy;
    } else merged.push({ ...win });
  }
  return { base: "dry", windows: merged };
}

export function weatherAt(day: DayWeather, minute: number): WeatherKind {
  for (const w of day.windows) {
    if (minute >= w.from && minute < w.to) return w.heavy ? "heavy_rain" : "rain";
  }
  return day.base;
}

/** Minute the current rain spell ends, or null if it isn't raining. */
export function rainEndsAt(day: DayWeather, minute: number): number | null {
  for (const w of day.windows) {
    if (minute >= w.from && minute < w.to) return w.to;
  }
  return null;
}

export const isRain = (w: WeatherKind): boolean => w === "rain" || w === "heavy_rain";

export function currentWeather(world: World, regionId: string): WeatherKind {
  return world.regionWeather[regionId]?.current ?? "dry";
}

export function weatherEventId(world: World, regionId: string): string {
  return world.regionWeather[regionId]?.eventId ?? world.dayEventId;
}

/** At day start: roll and log each region's weather pattern. */
export function setDayWeather(world: World): void {
  const cal = calendar(world.startDate, dayIndex(world.tick));
  for (const region of [...world.content.regions].sort((a, b) => a.id.localeCompare(b.id))) {
    const prev = world.regionWeather[region.id]?.day ?? null;
    const day = rollDayWeather(world, region.climate[cal.month - 1]!, prev);
    const ev = appendEvent(world, {
      type: "weather_set",
      actors: [],
      location: null,
      causes: [world.dayEventId],
      data: {
        regionId: region.id,
        base: day.base,
        windows: day.windows.map((w) => ({ from: w.from, to: w.to, heavy: w.heavy })),
      },
    });
    world.regionWeather[region.id] = {
      day,
      current: weatherAt(day, 0),
      setEventId: ev.id,
      eventId: ev.id,
    };
  }
}

/** Each tick: log a weather_changed event whenever the sky changes. */
export function updateWeather(world: World): void {
  const minute = minuteOfDay(world.tick);
  for (const regionId of Object.keys(world.regionWeather).sort()) {
    const st = world.regionWeather[regionId]!;
    const now = weatherAt(st.day, minute);
    if (now === st.current) continue;
    getRegion(world, regionId);
    const ev = appendEvent(world, {
      type: "weather_changed",
      actors: [],
      location: null,
      causes: [st.setEventId],
      data: { regionId, from: st.current, to: now },
    });
    st.current = now;
    st.eventId = ev.id;
  }
}
