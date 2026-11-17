import { describe, expect, it } from "vitest";
import {
  ARRANGEMENTS,
  STEPS_PER_BAR,
  Sequencer,
  barEvents,
  barSeconds,
  chordFor,
  layersFor,
  stepSeconds,
  stepTime,
} from "../src/audio/groove";
import { parseTrackList } from "../src/audio/music";
import { QUALITY, defaultQuality, loadQuality } from "../src/three/quality";
import { layoutBubbles, overlaps } from "../src/ui/bubbles";

describe("speech bubbles", () => {
  const W = 360;
  it("never overlap, even when both people stand close together", () => {
    // Tobi's and Ada's heads 40 px apart: the bubbles would sit on top of each other.
    const [older, newer] = layoutBubbles(
      [
        { anchorX: 160, anchorY: 400, w: 220, h: 70 },
        { anchorX: 200, anchorY: 400, w: 220, h: 70 },
      ],
      W,
      120,
    );
    expect(overlaps(older!, newer!)).toBe(false);
    // The one being said now stays over its speaker; the older one moves up out of the way.
    expect(newer!.top).toBe(400 - 70 - 10);
    expect(older!.top + older!.h).toBeLessThanOrEqual(newer!.top);
  });

  it("stays on screen and below the caption, moving sideways when there is no room above", () => {
    const placed = layoutBubbles(
      [
        { anchorX: 20, anchorY: 200, w: 150, h: 80 },
        { anchorX: 340, anchorY: 200, w: 150, h: 80 },
        { anchorX: 180, anchorY: 200, w: 150, h: 80 },
      ],
      W,
      110,
    );
    for (const r of placed) {
      expect(r.left).toBeGreaterThanOrEqual(8);
      expect(r.left + r.w).toBeLessThanOrEqual(W - 8);
      expect(r.top).toBeGreaterThanOrEqual(110);
    }
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(overlaps(placed[i]!, placed[j]!), `${i}/${j}`).toBe(false);
  });

  it("leaves bubbles alone when they don't touch", () => {
    const [a, b] = layoutBubbles(
      [
        { anchorX: 80, anchorY: 400, w: 120, h: 60 },
        { anchorX: 280, anchorY: 400, w: 120, h: 60 },
      ],
      W,
      100,
    );
    expect(a!.top).toBe(330);
    expect(b!.top).toBe(330);
  });
});

describe("Afrobeats-style groove", () => {
  it("keeps time: 16 sixteenths a bar at 100-110 BPM, swing only on the off-beats", () => {
    for (const a of Object.values(ARRANGEMENTS)) {
      expect(a.bpm).toBeGreaterThanOrEqual(100);
      expect(a.bpm).toBeLessThanOrEqual(110);
      expect(barSeconds(a.bpm)).toBeCloseTo(stepSeconds(a.bpm) * STEPS_PER_BAR);
      expect(stepTime(4, a)).toBeCloseTo(4 * stepSeconds(a.bpm));
      expect(stepTime(5, a)).toBeGreaterThan(5 * stepSeconds(a.bpm));
      expect(stepTime(5, a)).toBeLessThan(6 * stepSeconds(a.bpm));
    }
    expect(barSeconds(104)).toBeCloseTo((60 / 104) * 4);
  });

  it("schedules every note exactly once, in order, whatever the look-ahead steps are", () => {
    const a = ARRANGEMENTS.day;
    const seq = new Sequencer(a, 5);
    const got: number[] = [];
    let until = 0;
    for (const step of [0.05, 0.3, 0.01, 1.7, 0.25, 0.6, 2.2, 0.1]) {
      until += step;
      const evs = seq.take(until);
      for (const e of evs) {
        expect(e.time).toBeLessThan(until);
        got.push(e.time);
      }
    }
    const expected = [0, 1, 2, 3, 4, 5]
      .flatMap((b) => barEvents(b, a, 5))
      .map((e) => e.time)
      .filter((t) => t < until);
    expect(got.length).toBe(expected.length);
    for (let i = 1; i < got.length; i++) expect(got[i]!).toBeGreaterThanOrEqual(got[i - 1]!);
  });

  it("has a log drum, shaker, bell, bass, chords and percussion, and varies from bar to bar", () => {
    const a = ARRANGEMENTS.live;
    const insts = new Set(barEvents(0, a, 1).map((e) => e.inst));
    for (const i of ["logdrum", "shaker", "bell", "bass", "chord", "perc", "kick"] as const)
      expect(insts.has(i), i).toBe(true);
    // Not the same bar over and over: patterns, fills and chords change.
    const sig = (b: number): string =>
      barEvents(b, a, 1)
        .map((e) => `${e.inst}@${(e.time - b * barSeconds(a.bpm)).toFixed(3)}`)
        .join(",");
    const distinct = new Set(Array.from({ length: 16 }, (_, b) => sig(b)));
    expect(distinct.size).toBeGreaterThan(4);
    expect(new Set(Array.from({ length: 16 }, (_, b) => chordFor(b, 1).name)).size).toBeGreaterThan(
      1,
    );
    // Same seed, same music.
    expect(sig(7)).toBe(sig(7));
  });

  it("is calmer at night: slower, no kick or log drum, fewer notes", () => {
    const night = ARRANGEMENTS.night;
    const day = ARRANGEMENTS.day;
    expect(night.bpm).toBeLessThan(day.bpm);
    const nightNotes = Array.from({ length: 8 }, (_, b) => barEvents(b, night, 2)).flat();
    const dayNotes = Array.from({ length: 8 }, (_, b) => barEvents(b, day, 2)).flat();
    expect(nightNotes.some((e) => e.inst === "kick" || e.inst === "logdrum")).toBe(false);
    expect(nightNotes.length).toBeLessThan(dayNotes.length);
    // Layers sit out now and then, and come back.
    const counts = Array.from({ length: 32 }, (_, b) => layersFor(b, ARRANGEMENTS.live, 3).length);
    expect(Math.min(...counts)).toBeLessThan(Math.max(...counts));
  });

  it("reads a licensed-track list, ignoring junk", () => {
    expect(parseTrackList({ day: ["a.mp3", 3, ""], night: "x", live: ["b.ogg"] })).toEqual({
      day: ["a.mp3"],
      night: [],
      live: ["b.ogg"],
    });
    expect(parseTrackList(null)).toEqual({ day: [], night: [], live: [] });
  });
});

describe("graphics settings", () => {
  it("defaults to Low on phones and weak machines, and remembers a choice", () => {
    expect(defaultQuality({ mobile: true, cores: 8, memoryGb: 8 })).toBe("low");
    expect(defaultQuality({ mobile: false, cores: 4 })).toBe("low");
    expect(defaultQuality({ mobile: false, cores: 8, memoryGb: 16 })).toBe("medium");
    expect(loadQuality({ getItem: () => "high" }, { mobile: true })).toBe("high");
    expect(loadQuality({ getItem: () => "ultra" }, { mobile: true })).toBe("low");
    expect(QUALITY.low.pixelRatio).toBe(1);
    expect(QUALITY.low.shadows).toBe(false);
    expect(QUALITY.high.rainDrops).toBeGreaterThan(QUALITY.low.rainDrops);
  });
});
