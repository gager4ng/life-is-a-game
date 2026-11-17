import type { LedgerEvent, PendingChoice, Tile, World } from "@liag/engine";
import {
  TICKS_PER_DAY,
  chooseReply,
  createWorld,
  loadWorld,
  pendingChoices,
  reachablePlaces,
  runUntil,
  saveWorld,
  setPlayerDestination,
  stepTick,
} from "@liag/engine";
import { loadContent } from "@liag/content";

export const PLAYER_ID = "p1";
export const PLAYER_CHAR = "c_tobi";
export const SAVE_KEY = "liag:save:v2";
/**
 * A new game opens on day 1 at 06:40 with Tobi up at home. The engine's clock starts at
 * midnight (tick 0), so the night before is simulated first, with the player on autopilot.
 * World tick 41 = the 06:40 tick has run; the screen shows 06:40 moving towards 06:50.
 */
export const NEW_GAME_TICK = 41;

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Owns the world for one browser tab: new game, continue, save, step, player actions. */
export class Session {
  /** Events from the latest step or reply, for the views to react to. */
  private listeners: ((events: LedgerEvent[]) => void)[] = [];
  private lastSavedTick = -1;

  private constructor(
    public world: World,
    private readonly storage: Storage | null,
  ) {}

  static newGame(storage: Storage | null, seed: number): Session {
    const world = createWorld(loadContent(), {
      seed,
      players: [{ playerId: PLAYER_ID, characterId: PLAYER_CHAR, autopilot: true }],
    });
    runUntil(world, NEW_GAME_TICK);
    world.players[PLAYER_ID]!.autopilot = false;
    const s = new Session(world, storage);
    s.save();
    return s;
  }

  static hasSave(storage: Storage | null): boolean {
    try {
      return !!storage?.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  /** Continue the saved game, or null if there is none (or it can't be read). */
  static continueGame(storage: Storage | null): Session | null {
    try {
      const raw = storage?.getItem(SAVE_KEY);
      if (!raw) return null;
      return new Session(loadWorld(raw), storage);
    } catch {
      return null;
    }
  }

  onEvents(fn: (events: LedgerEvent[]) => void): void {
    this.listeners.push(fn);
  }

  private emit(events: LedgerEvent[]): void {
    if (events.length) for (const fn of this.listeners) fn(events);
  }

  get playerCharId(): string {
    return this.world.players[PLAYER_ID]!.characterId;
  }

  /** The encounter waiting on the player, if any. */
  pending(): PendingChoice | null {
    return pendingChoices(this.world, PLAYER_ID)[0] ?? null;
  }

  /** Simulate one tick. Returns false (and does nothing) while the player owes a reply. */
  step(): boolean {
    if (this.pending()) return false;
    const r = stepTick(this.world);
    this.emit(r.events);
    // Autosave every game hour.
    if (this.world.tick - this.lastSavedTick >= 6) this.save();
    return true;
  }

  reply(encounterId: string, optionId: string): LedgerEvent[] {
    const events = chooseReply(this.world, PLAYER_ID, encounterId, optionId);
    this.emit(events);
    this.save();
    return events;
  }

  /** Can the player head to this place now? null = yes, else the reason ("unknown" | "closed" | "here"). */
  canGo(locationId: string): null | "unknown" | "closed" | "here" {
    const c = this.world.characters[this.playerCharId]!;
    if (!c.knownLocations[locationId]) return "unknown";
    if (reachablePlaces(this.world, PLAYER_ID).includes(locationId)) return null;
    if (c.locationId === locationId && !c.travel && !c.street) return "here";
    return "closed";
  }

  /** The player character is asleep (indoors, not on the way anywhere). */
  get asleep(): boolean {
    const c = this.world.characters[this.playerCharId]!;
    return c.activity === "sleep" && !c.travel && !c.street;
  }

  goTo(target: string | Tile): LedgerEvent {
    const ev = setPlayerDestination(
      this.world,
      PLAYER_ID,
      target,
      typeof target === "string" ? 2 : 1,
    );
    this.emit([ev]);
    return ev;
  }

  save(): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, saveWorld(this.world));
      this.lastSavedTick = this.world.tick;
      return true;
    } catch {
      return false; // quota or private mode: keep playing, just unsaved
    }
  }

  get day(): number {
    return Math.floor(this.world.tick / TICKS_PER_DAY) + 1;
  }
}
