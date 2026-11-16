import type { World } from "./types";
import { WORLD_VERSION } from "./types";

/** The whole world (content, RNG state, ledger and all) as JSON text. */
export function saveWorld(world: World, pretty = false): string {
  return JSON.stringify(world, null, pretty ? 2 : undefined);
}

export function loadWorld(json: string): World {
  const raw = JSON.parse(json) as Partial<World>;
  if (!raw || typeof raw !== "object") throw new Error("Save file is not a world");
  if (raw.version !== WORLD_VERSION) {
    throw new Error(
      `Save version ${String(raw.version)} is not supported (expected ${WORLD_VERSION})`,
    );
  }
  const required: (keyof World)[] = [
    "seed",
    "rng",
    "tick",
    "startDate",
    "content",
    "characters",
    "relationships",
    "players",
    "ledger",
    "counters",
  ];
  for (const k of required) {
    if (raw[k] === undefined) throw new Error(`Save file is missing "${k}"`);
  }
  return raw as World;
}
