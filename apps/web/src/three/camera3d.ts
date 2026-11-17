import type { Camera, Object3D } from "three";
import { OrthographicCamera, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { angleDiff } from "./coords";

/**
 * Three ways to look at Yaba:
 *  - "city": the angled overview (orthographic, like the old isometric view), panned by drag,
 *    zoomed by pinch, turned in 90° steps;
 *  - "follow": a street-level camera that walks behind Tobi;
 *  - "encounter": down at street level beside two people talking.
 * Positions are world units (1 = one tile; x = map x, z = map y).
 */
export type CamMode = "city" | "follow" | "encounter";

const PITCH = (35 * Math.PI) / 180;
const CITY_DIST = 60;

export class CameraRig {
  readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  readonly persp = new PerspectiveCamera(58, 1, 0.05, 160);
  mode: CamMode = "city";
  /** Ground point at the centre of the city view. */
  readonly target = new Vector3(20, 0, 17);
  /** Screen pixels per world unit in the city view. */
  zoom = 60;
  readonly minZoom = 16;
  readonly maxZoom = 150;
  /** 0..3: which quarter turn the city view is at. */
  turn = 0;
  private yaw = Math.PI / 4;
  screenW = 1;
  screenH = 1;
  bounds = { minX: 0, maxX: 44, minZ: 0, maxZ: 36 };
  private glide: Vector3 | null = null;
  // Follow / encounter targets (smoothed).
  private readonly eye = new Vector3();
  private readonly look = new Vector3();
  private readonly wantEye = new Vector3();
  private readonly wantLook = new Vector3();
  private readonly ray = new Raycaster();
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0);
  private readonly ndc = new Vector2();
  private readonly tmp = new Vector3();
  private snap = true;

  get camera(): Camera {
    return this.mode === "city" ? this.ortho : this.persp;
  }

  /** Distance from the camera to what it looks at (for fog and rain). */
  get distance(): number {
    return this.mode === "city" ? CITY_DIST : this.eye.distanceTo(this.look);
  }

  /** What the camera is looking at, on the ground. */
  get focus(): Vector3 {
    return this.mode === "city" ? this.target : this.tmp.set(this.look.x, 0, this.look.z);
  }

  resize(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
  }

  // --- City view controls -----------------------------------------------------

  panBy(dxScreen: number, dyScreen: number): void {
    if (this.mode !== "city") return;
    this.glide = null;
    // Screen right and screen "up" (into the scene) on the ground.
    const rx = Math.sin(this.yaw);
    const rz = -Math.cos(this.yaw);
    const fx = -Math.cos(this.yaw);
    const fz = -Math.sin(this.yaw);
    const k = 1 / this.zoom;
    const up = k / Math.sin(PITCH);
    this.target.x -= rx * dxScreen * k - fx * dyScreen * up;
    this.target.z -= rz * dxScreen * k - fz * dyScreen * up;
    this.clamp();
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    if (this.mode !== "city") return;
    const before = this.screenToGround(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    this.apply();
    const after = this.screenToGround(sx, sy);
    if (before && after) {
      this.target.x += before.x - after.x;
      this.target.z += before.z - after.z;
    }
    this.clamp();
  }

  /** Quarter turn of the city view (+1 clockwise). */
  rotateStep(dir: 1 | -1): void {
    this.turn = (this.turn + dir + 4) % 4;
  }

  centreOn(x: number, z: number, smooth = true): void {
    if (smooth) this.glide = new Vector3(x, 0, z);
    else {
      this.target.set(x, 0, z);
      this.glide = null;
      this.clamp();
    }
  }

  private clamp(): void {
    const b = this.bounds;
    this.target.x = Math.max(b.minX, Math.min(b.maxX, this.target.x));
    this.target.z = Math.max(b.minZ, Math.min(b.maxZ, this.target.z));
  }

  // --- Follow and encounter -----------------------------------------------------

  /** Street-level camera behind someone walking at (x, z) facing `yaw`. */
  setFollow(x: number, z: number, yaw: number): void {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    this.wantEye.set(x - fx * 1.7, 0.95, z - fz * 1.7);
    this.wantLook.set(x + fx * 1.4, 0.38, z + fz * 1.4);
  }

  /** Beside two people talking: `eye` and `look` worked out by the view. */
  setShot(eye: Vector3, look: Vector3, snap: boolean): void {
    this.wantEye.copy(eye);
    this.wantLook.copy(look);
    if (snap) this.snap = true;
  }

  setMode(mode: CamMode): void {
    if (mode === this.mode) return;
    if (mode !== "city" && this.mode === "city") this.snap = true;
    this.mode = mode;
  }

  // --- Per frame ---------------------------------------------------------------

  update(dt: number): void {
    if (this.glide) {
      const k = 1 - Math.exp(-dt * 7);
      this.target.lerp(this.glide, k);
      if (this.target.distanceTo(this.glide) < 0.01) this.glide = null;
      this.clamp();
    }
    const wantYaw = Math.PI / 4 + (this.turn * Math.PI) / 2;
    this.yaw += angleDiff(this.yaw, wantYaw) * (1 - Math.exp(-dt * 8));
    if (this.mode !== "city") {
      if (this.snap) {
        this.eye.copy(this.wantEye);
        this.look.copy(this.wantLook);
        this.snap = false;
      } else {
        const k = 1 - Math.exp(-dt * (this.mode === "follow" ? 4 : 6));
        this.eye.lerp(this.wantEye, k);
        this.look.lerp(this.wantLook, k);
      }
    }
    this.apply();
  }

  apply(): void {
    if (this.mode === "city") {
      const c = this.ortho;
      const hw = this.screenW / 2 / this.zoom;
      const hh = this.screenH / 2 / this.zoom;
      c.left = -hw;
      c.right = hw;
      c.top = hh;
      c.bottom = -hh;
      c.position.set(
        this.target.x + Math.cos(this.yaw) * Math.cos(PITCH) * CITY_DIST,
        Math.sin(PITCH) * CITY_DIST,
        this.target.z + Math.sin(this.yaw) * Math.cos(PITCH) * CITY_DIST,
      );
      c.lookAt(this.target);
      c.updateProjectionMatrix();
      c.updateMatrixWorld();
    } else {
      this.persp.position.copy(this.eye);
      this.persp.lookAt(this.look);
      this.persp.updateMatrixWorld();
    }
  }

  // --- Projection -------------------------------------------------------------

  /** World point to CSS pixels; `behind` when it is behind the camera (perspective). */
  project(p: Vector3): { x: number; y: number; behind: boolean } {
    const v = this.tmp.copy(p).project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.screenW,
      y: (-v.y * 0.5 + 0.5) * this.screenH,
      behind: v.z > 1 || v.z < -1,
    };
  }

  /** CSS pixels to the point on the ground under them. */
  screenToGround(sx: number, sy: number): Vector3 | null {
    this.setRay(sx, sy);
    return this.ray.ray.intersectPlane(this.ground, new Vector3());
  }

  /** First of `objects` under the screen point. */
  pick(sx: number, sy: number, objects: Object3D[]): Object3D | null {
    this.setRay(sx, sy);
    return this.ray.intersectObjects(objects, false)[0]?.object ?? null;
  }

  private setRay(sx: number, sy: number): void {
    this.ndc.set((sx / this.screenW) * 2 - 1, -(sy / this.screenH) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }
}

export interface GestureHandlers {
  onTap(sx: number, sy: number): void;
  onDoubleTap(sx: number, sy: number): void;
  /** Two-finger twist past ~35°: turn the view a quarter. */
  onTwist(dir: 1 | -1): void;
  /** One-finger drag (city view only). */
  onDragStart?(): void;
}

/**
 * Touch and mouse: one finger drags to pan, two fingers pinch to zoom and twist to turn, the
 * wheel zooms, a tap selects, a double tap centres on the player. Single taps wait briefly so a
 * double tap doesn't also send Tobi walking.
 */
export function attachGestures(el: HTMLElement, cam: CameraRig, h: GestureHandlers): () => void {
  const pts = new Map<number, { x: number; y: number }>();
  let downAt = 0;
  let downPos = { x: 0, y: 0 };
  let moved = false;
  let pinchDist = 0;
  let pinchAngle = 0;
  let twist = 0;
  let lastTap: { t: number; x: number; y: number } | null = null;
  let tapTimer: ReturnType<typeof setTimeout> | null = null;

  const rel = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pair = (): [{ x: number; y: number }, { x: number; y: number }] => {
    const [a, b] = [...pts.values()];
    return [a!, b!];
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
      const [a, b] = pair();
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
      twist = 0;
      moved = true;
    }
  };

  const move = (e: PointerEvent): void => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const p = rel(e);
    if (pts.size === 1) {
      if (Math.hypot(p.x - downPos.x, p.y - downPos.y) > 8) {
        if (!moved) h.onDragStart?.();
        moved = true;
      }
      if (moved) cam.panBy(p.x - prev.x, p.y - prev.y);
      pts.set(e.pointerId, p);
      return;
    }
    if (pts.size === 2) {
      const [a0, b0] = pair();
      const oldMid = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      pts.set(e.pointerId, p);
      const [a, b] = pair();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinchDist > 0) cam.zoomAt(d / pinchDist, mid.x, mid.y);
      cam.panBy(mid.x - oldMid.x, mid.y - oldMid.y);
      pinchDist = d;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      twist += angleDiff(pinchAngle, ang);
      pinchAngle = ang;
      if (Math.abs(twist) > 0.6) {
        h.onTwist(twist > 0 ? 1 : -1);
        twist = 0;
      }
    }
  };

  const up = (e: PointerEvent): void => {
    if (!pts.delete(e.pointerId)) return;
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
