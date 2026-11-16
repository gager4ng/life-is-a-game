/**
 * Game time on screen. At 1x one engine tick (10 game minutes) passes every 5 real seconds;
 * 2x and 4x shorten that, 0 pauses. The clock only says when the next tick is due and how far
 * we are towards it (for smooth walking); the engine does the simulating.
 */
export const MS_PER_TICK = 5000;
export const SPEEDS = [0, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export class Clock {
  speed: Speed = 1;
  /** Milliseconds of game time run since the last tick, at 1x scale. */
  private acc = 0;
  /** Paused by the game (an encounter) regardless of the chosen speed. */
  held = false;

  /** Advance by real elapsed ms. Returns true when a tick is due (at most one per call). */
  advance(dtMs: number): boolean {
    if (this.held || this.speed === 0) return false;
    // A long frame (tab in the background) must not fire a burst of ticks.
    this.acc += Math.min(dtMs, 250) * this.speed;
    if (this.acc >= MS_PER_TICK) {
      this.acc = Math.min(this.acc - MS_PER_TICK, MS_PER_TICK * 0.5);
      return true;
    }
    return false;
  }

  /** 0..1 progress towards the next tick. */
  get frac(): number {
    return Math.min(1, this.acc / MS_PER_TICK);
  }

  reset(): void {
    this.acc = 0;
  }
}
