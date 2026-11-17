/**
 * Game time on screen. At 1x one engine tick (10 game minutes) passes every 3 real seconds;
 * 2x and 4x shorten that, 0 pauses. While the player sleeps the clock can run in `fast` mode
 * (a tick every 120 ms) to skip the night. The clock only says when the next tick is due and
 * how far we are towards it (for smooth walking); the engine does the simulating.
 */
export const MS_PER_TICK = 3000;
export const FAST_MS_PER_TICK = 120;
export const SPEEDS = [0, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export class Clock {
  speed: Speed = 1;
  /** Skip ahead quickly (night while asleep). Ignores the speed setting, but not pause. */
  fast = false;
  /** Milliseconds of game time run since the last tick, at 1x scale. */
  private acc = 0;
  /** Paused by the game (an encounter, the guide) regardless of the chosen speed. */
  held = false;

  private get period(): number {
    return this.fast ? FAST_MS_PER_TICK : MS_PER_TICK;
  }

  /** Advance by real elapsed ms. Returns true when a tick is due (at most one per call). */
  advance(dtMs: number): boolean {
    if (this.held || this.speed === 0) return false;
    // A long frame (tab in the background) must not fire a burst of ticks.
    this.acc += Math.min(dtMs, 250) * (this.fast ? 1 : this.speed);
    if (this.acc >= this.period) {
      this.acc = Math.min(this.acc - this.period, this.period * 0.5);
      return true;
    }
    return false;
  }

  /** 0..1 progress towards the next tick. */
  get frac(): number {
    return Math.min(1, this.acc / this.period);
  }

  reset(): void {
    this.acc = 0;
  }
}
