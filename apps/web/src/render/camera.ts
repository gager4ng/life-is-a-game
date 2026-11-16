import type { Container } from "pixi.js";

/** Pan and zoom over the city. Positions are world pixels; `x, y` is the point at screen centre. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  readonly minZoom = 0.35;
  readonly maxZoom = 2.6;
  screenW = 1;
  screenH = 1;
  /** World-pixel bounds the centre may move within. */
  bounds = { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };
  /** Smooth glide target (double-tap to centre). */
  private glide: { x: number; y: number } | null = null;

  apply(...layers: Container[]): void {
    for (const c of layers) {
      c.scale.set(this.zoom);
      c.position.set(this.screenW / 2 - this.x * this.zoom, this.screenH / 2 - this.y * this.zoom);
    }
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + this.screenW / 2,
      y: (wy - this.y) * this.zoom + this.screenH / 2,
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.screenW / 2) / this.zoom + this.x,
      y: (sy - this.screenH / 2) / this.zoom + this.y,
    };
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.glide = null;
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clamp();
  }

  /** Zoom by a factor, keeping the world point under (sx, sy) where it is. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  centreOn(wx: number, wy: number, smooth = true): void {
    if (smooth) this.glide = { x: wx, y: wy };
    else {
      this.x = wx;
      this.y = wy;
      this.clamp();
    }
  }

  update(dt: number): void {
    if (!this.glide) return;
    const k = 1 - Math.exp(-dt * 8);
    this.x += (this.glide.x - this.x) * k;
    this.y += (this.glide.y - this.y) * k;
    if (Math.hypot(this.glide.x - this.x, this.glide.y - this.y) < 0.5) this.glide = null;
    this.clamp();
  }

  private clamp(): void {
    this.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.x));
    this.y = Math.max(this.bounds.minY, Math.min(this.bounds.maxY, this.y));
  }
}

export interface GestureHandlers {
  onTap(sx: number, sy: number): void;
  onDoubleTap(sx: number, sy: number): void;
}

/**
 * Touch and mouse: one finger drags to pan, two fingers pinch to zoom, the wheel zooms, a tap
 * selects, a double tap centres on the player. Single taps wait briefly so a double tap
 * doesn't also send Tobi walking.
 */
export function attachGestures(el: HTMLElement, cam: Camera, h: GestureHandlers): () => void {
  const pts = new Map<number, { x: number; y: number }>();
  let downAt = 0;
  let downPos = { x: 0, y: 0 };
  let moved = false;
  let pinchDist = 0;
  let lastTap: { t: number; x: number; y: number } | null = null;
  let tapTimer: ReturnType<typeof setTimeout> | null = null;

  const rel = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: PointerEvent): void => {
    el.setPointerCapture(e.pointerId);
    const p = rel(e);
    pts.set(e.pointerId, p);
    if (pts.size === 1) {
      downAt = performance.now();
      downPos = p;
      moved = false;
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      moved = true;
    }
  };

  const move = (e: PointerEvent): void => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const p = rel(e);
    if (pts.size === 1) {
      if (Math.hypot(p.x - downPos.x, p.y - downPos.y) > 8) moved = true;
      if (moved) cam.panBy(p.x - prev.x, p.y - prev.y);
    } else if (pts.size === 2) {
      const [a0, b0] = [...pts.values()];
      const oldMid = { x: (a0!.x + b0!.x) / 2, y: (a0!.y + b0!.y) / 2 };
      pts.set(e.pointerId, p);
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      if (pinchDist > 0) cam.zoomAt(d / pinchDist, mid.x, mid.y);
      cam.panBy(mid.x - oldMid.x, mid.y - oldMid.y); // two-finger drag pans too
      pinchDist = d;
      return;
    }
    pts.set(e.pointerId, p);
  };

  const up = (e: PointerEvent): void => {
    const had = pts.delete(e.pointerId);
    if (!had) return;
    if (pts.size > 0) return;
    const p = rel(e);
    const quick = performance.now() - downAt < 400;
    if (moved || !quick) return;
    const now = performance.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) {
      if (tapTimer) clearTimeout(tapTimer);
      tapTimer = null;
      lastTap = null;
      h.onDoubleTap(p.x, p.y);
      return;
    }
    lastTap = { t: now, x: p.x, y: p.y };
    tapTimer = setTimeout(() => {
      tapTimer = null;
      h.onTap(p.x, p.y);
    }, 260);
  };

  const wheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = rel(e);
    cam.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", wheel, { passive: false });
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.removeEventListener("wheel", wheel);
  };
}
