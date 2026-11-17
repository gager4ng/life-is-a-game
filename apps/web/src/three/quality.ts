/**
 * Graphics settings. Low is for mid-range phones (target 30 fps or better), Medium and High add
 * resolution, more rain and real shadows. The first visit picks Low on weak or mobile devices;
 * the player can change it in the menu (remembered in localStorage).
 */

export type QualityLevel = "low" | "medium" | "high";
export const QUALITY_LEVELS: readonly QualityLevel[] = ["low", "medium", "high"];

export interface Quality {
  level: QualityLevel;
  /** Cap on devicePixelRatio. */
  pixelRatio: number;
  antialias: boolean;
  /** Real shadow maps from the sun (otherwise baked blob and footprint shadows). */
  shadows: boolean;
  rainDrops: number;
  /** Background people and vehicles. */
  walkers: number;
  vehicles: number;
  /** Glowing halos around streetlights at night. */
  halos: boolean;
}

export const QUALITY: Record<QualityLevel, Quality> = {
  low: {
    level: "low",
    pixelRatio: 1,
    antialias: false,
    shadows: false,
    rainDrops: 350,
    walkers: 14,
    vehicles: 8,
    halos: true,
  },
  medium: {
    level: "medium",
    pixelRatio: 1.5,
    antialias: false,
    shadows: false,
    rainDrops: 800,
    walkers: 22,
    vehicles: 12,
    halos: true,
  },
  high: {
    level: "high",
    pixelRatio: 2,
    antialias: true,
    shadows: true,
    rainDrops: 1400,
    walkers: 28,
    vehicles: 14,
    halos: true,
  },
};

export interface DeviceInfo {
  /** navigator.hardwareConcurrency */
  cores?: number;
  /** navigator.deviceMemory (GB), Chrome only */
  memoryGb?: number;
  mobile: boolean;
}

/** Low on phones and weak machines, Medium otherwise (High only when chosen). */
export function defaultQuality(d: DeviceInfo): QualityLevel {
  if (d.mobile) return "low";
  if ((d.cores ?? 4) <= 4 || (d.memoryGb ?? 8) <= 4) return "low";
  return "medium";
}

const KEY = "liag:gfx";

export function loadQuality(store: Pick<Storage, "getItem"> | null, d: DeviceInfo): QualityLevel {
  try {
    const v = store?.getItem(KEY);
    if (v === "low" || v === "medium" || v === "high") return v;
  } catch {
    /* ignore */
  }
  return defaultQuality(d);
}

export function saveQuality(store: Pick<Storage, "setItem"> | null, q: QualityLevel): void {
  try {
    store?.setItem(KEY, q);
  } catch {
    /* ignore */
  }
}

export function deviceInfo(): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    cores: nav.hardwareConcurrency,
    memoryGb: nav.deviceMemory,
    mobile:
      /Android|iPhone|iPad|Mobile/i.test(nav.userAgent) || matchMedia("(pointer: coarse)").matches,
  };
}
