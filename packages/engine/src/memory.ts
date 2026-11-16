import type { Sink } from "./effects";
import type { CharacterState, Memory, MemoryKind, World } from "./types";
import { clamp, round2 } from "./util";
import { getChar } from "./world";

export const MEMORY_CAP = 40;
export const FORGET_BELOW = 5;

/** Memory kinds a character will pass on as gist (rumours). */
export const SHAREABLE: ReadonlySet<MemoryKind> = new Set<MemoryKind>([
  "helped_me",
  "refused_me",
  "got_lead",
  "repaid_me",
  "failed_to_repay",
]);

export interface NewMemory {
  kind: MemoryKind;
  subject: string;
  about: string[];
  valence: number;
  importance: number;
  secondhand?: boolean;
  sourceKind?: MemoryKind | null;
  locationId: string | null;
}

export function addMemory(world: World, sink: Sink, who: string, m: NewMemory): Memory {
  const c = getChar(world, who);
  world.counters.memory += 1;
  const importance = clamp(Math.round(m.importance), 1, 100);
  const memory: Memory = {
    id: `m${world.counters.memory}`,
    eventId: sink.eventId,
    tick: world.tick,
    kind: m.kind,
    subject: m.subject,
    about: [...new Set([m.subject, ...m.about])].filter((x) => x !== who),
    valence: round2(clamp(m.valence, -1, 1)),
    importance,
    strength: importance,
    secondhand: m.secondhand ?? false,
    sourceKind: m.sourceKind ?? null,
    toldTo: [],
    locationId: m.locationId,
  };
  c.memories.push(memory);
  if (c.memories.length > MEMORY_CAP) {
    // Forget the faintest memory (oldest first on ties).
    let weakest = 0;
    for (let i = 1; i < c.memories.length; i++) {
      if (c.memories[i]!.strength < c.memories[weakest]!.strength) weakest = i;
    }
    c.memories.splice(weakest, 1);
  }
  sink.effects.push({
    kind: "memory",
    who,
    memoryId: memory.id,
    memoryKind: m.kind,
    subject: m.subject,
  });
  return memory;
}

/** Daily fading: important memories last longer. Faint ones are forgotten. */
export function decayMemories(world: World): void {
  for (const id of Object.keys(world.characters).sort()) {
    const c = world.characters[id]!;
    for (const m of c.memories) {
      const loss = Math.max(0.5, 12 * (1 - m.importance / 100));
      m.strength = round2(Math.max(0, m.strength - loss));
    }
    c.memories = c.memories.filter((m) => m.strength >= FORGET_BELOW);
  }
}

/** -15..15: how a character's memories colour their view of someone. */
export function memoryOpinion(c: CharacterState, aboutId: string): number {
  let sum = 0;
  for (const m of c.memories) {
    if (m.subject === aboutId) sum += (m.valence * m.strength) / 10;
  }
  return clamp(Math.round(sum), -15, 15);
}
