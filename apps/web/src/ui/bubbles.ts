/**
 * Where speech bubbles go on screen so they never overlap. Each bubble wants to sit just above
 * its speaker's head; the newest bubble (the one being said now) keeps its place and older ones
 * move up out of the way (or sideways if there is no room above). Pure, so it is unit-tested.
 */

export interface BubbleIn {
  /** Speaker's head on screen (CSS px): the bubble's tail points here. */
  anchorX: number;
  anchorY: number;
  w: number;
  h: number;
}

export interface Placed {
  left: number;
  top: number;
  w: number;
  h: number;
}

const GAP = 8;
const MARGIN = 8;

export function overlaps(a: Placed, b: Placed, gap = 0): boolean {
  return (
    a.left < b.left + b.w + gap &&
    b.left < a.left + a.w + gap &&
    a.top < b.top + b.h + gap &&
    b.top < a.top + a.h + gap
  );
}

/**
 * `items` oldest first. Returns one rectangle per item, in the same order, inside the screen
 * (below `minTop`, e.g. under the caption) and not overlapping each other.
 */
export function layoutBubbles(items: BubbleIn[], screenW: number, minTop: number): Placed[] {
  const out: Placed[] = new Array<Placed>(items.length);
  const placed: Placed[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    const w = Math.min(it.w, screenW - MARGIN * 2);
    const left = Math.max(MARGIN, Math.min(screenW - MARGIN - w, it.anchorX - w / 2));
    const r: Placed = { left, top: Math.max(minTop, it.anchorY - it.h - 10), w, h: it.h };
    // Move up past anything newer it would cover.
    for (let guard = 0; guard < 8; guard++) {
      const hit = placed.find((p) => overlaps(r, p, GAP));
      if (!hit) break;
      const up = hit.top - GAP - r.h;
      if (up >= minTop) r.top = up;
      else {
        // No room above: put it beside, on whichever side has more space, then below.
        const roomLeft = hit.left - MARGIN;
        const roomRight = screenW - MARGIN - (hit.left + hit.w);
        if (Math.max(roomLeft, roomRight) >= r.w + GAP)
          r.left = roomLeft >= roomRight ? hit.left - GAP - r.w : hit.left + hit.w + GAP;
        else r.top = hit.top + hit.h + GAP;
      }
    }
    out[i] = r;
    placed.push(r);
  }
  return out;
}
