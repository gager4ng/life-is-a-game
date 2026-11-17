import type { Tile, WeatherKind, World } from "@liag/engine";
import { charDef } from "@liag/engine";
import {
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PCFShadowMap,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
  ConeGeometry,
  BoxGeometry,
  Raycaster,
} from "three";
import type { CityModel } from "../render/city-model";
import { lightingFor, nightFactor, sunAt } from "../render/lighting";
import type { Look } from "../render/look";
import { fallbackLook, resolveLook } from "../render/look";
import type { PersonView } from "../render/people-model";
import { personView } from "../render/people-model";
import type { City3D } from "./city3d";
import { buildCity3D } from "./city3d";
import { CameraRig } from "./camera3d";
import { angleDiff, yawFor } from "./coords";
import type { Expression, Figure, Pose } from "./people3d";
import { PeopleLayer } from "./people3d";
import type { Quality } from "./quality";
import { Sky3D } from "./sky3d";
import { SignAtlas } from "./textures";
import { Traffic } from "./traffic";
import { VehicleInstances } from "./vehicles";
import type { RegionMap } from "@liag/engine";

/** What a tap landed on. */
export type Pick =
  | { kind: "person"; id: string }
  | { kind: "place"; locationId: string }
  | { kind: "ground"; tile: Tile }
  | null;

interface Tracked {
  id: string;
  look: Look;
  view: PersonView | null;
  x: number;
  z: number;
  yaw: number;
  phase: number;
  isPlayer: boolean;
}

interface Staging {
  meId: string;
  otherId: string;
  a: Vector3;
  b: Vector3;
  eye: Vector3;
  look: Vector3;
  exprMe: Expression;
  exprOther: Expression;
  talking: "me" | "other" | null;
}

export interface FrameInput {
  world: World;
  shownTick: number;
  /** Real seconds since the last frame. */
  dt: number;
  /** Game-time seconds (real seconds x speed; 0 when paused). */
  gameDt: number;
  minute: number;
  weather: WeatherKind;
  nowMs: number;
  playerId: string;
}

const FACING: Record<string, [number, number]> = {
  se: [1, 0],
  sw: [0, 1],
  ne: [0, -1],
  nw: [-1, 0],
};

/**
 * The 3D view of Yaba: renderer, scene, camera rig, static city, people, traffic and weather,
 * behind a small interface the game uses (frame, tap picking, projection, encounters).
 */
export class View3D {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly cam = new CameraRig();
  readonly city3d: City3D;
  private readonly people: PeopleLayer;
  private readonly traffic: Traffic;
  private readonly sky: Sky3D;
  private readonly vehicles: VehicleInstances[];
  private readonly tracked = new Map<string, Tracked>();
  private readonly figureOf = new Map<string, Figure>();
  private readonly ring: Mesh;
  private readonly arrow: Mesh;
  private readonly questMarker: Mesh;
  private readonly dest: Group;
  private destUntil = 0;
  private stage: Staging | null = null;
  private follow = false;
  private timeS = 0;
  private lastNight = 0;

  constructor(
    mount: HTMLElement,
    private readonly city: CityModel,
    private readonly map: RegionMap,
    world: World,
    public quality: Quality,
    signTexts: string[],
  ) {
    this.renderer = new WebGLRenderer({
      antialias: quality.antialias,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = PCFShadowMap;
    mount.append(this.renderer.domElement);
    this.scene.background = new Color(0x9fc9e6);

    const signs = new SignAtlas();
    this.city3d = buildCity3D(city, signs, signTexts, quality.halos);
    this.scene.add(this.city3d.root);
    this.sky = new Sky3D(this.scene, quality.rainDrops, quality.shadows);

    const mat = new MeshLambertMaterial({ flatShading: true });
    this.people = new PeopleLayer(96, mat);
    this.scene.add(this.people.root);
    const vmat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.vehicles = (["danfo", "keke", "okada"] as const).map(
      (k) => new VehicleInstances(k, vmat, 24),
    );
    for (const v of this.vehicles) this.scene.add(v.mesh);
    this.traffic = new Traffic(map, city, quality.walkers, quality.vehicles);

    // Tobi's ring and arrow, the quest marker and the destination flag.
    const yellow = new MeshBasicMaterial({ color: 0xffd23f });
    this.ring = new Mesh(new RingGeometry(0.16, 0.22, 20).rotateX(-Math.PI / 2), yellow);
    this.ring.renderOrder = 4;
    this.arrow = new Mesh(new ConeGeometry(0.07, 0.14, 4).rotateX(Math.PI), yellow);
    this.questMarker = new Mesh(
      new OctahedronGeometry(0.22),
      new MeshBasicMaterial({ color: 0xffd23f }),
    );
    this.questMarker.visible = false;
    this.dest = new Group();
    const white = new MeshBasicMaterial({ color: 0xffffff });
    const pole = new Mesh(new CylinderGeometry(0.012, 0.012, 0.6, 5).translate(0, 0.3, 0), white);
    const flag = new Mesh(
      new BoxGeometry(0.22, 0.12, 0.01).translate(0.11, 0.53, 0),
      new MeshBasicMaterial({ color: 0xff5d5d }),
    );
    const dring = new Mesh(new RingGeometry(0.18, 0.22, 20).rotateX(-Math.PI / 2), white);
    dring.position.y = 0.06;
    this.dest.add(pole, flag, dring);
    this.dest.visible = false;
    this.scene.add(this.ring, this.arrow, this.questMarker, this.dest);

    this.cam.bounds = { minX: 0, maxX: city.width, minZ: 0, maxZ: city.height };
    this.resetPeople(world);
  }

  /** (Re)create the engine characters shown on this map. */
  resetPeople(world: World): void {
    this.tracked.clear();
    for (const id of Object.keys(world.characters).sort()) {
      const c = world.characters[id]!;
      if (!this.city.places.some((p) => p.locationId === c.homeId)) continue; // other regions
      const def = charDef(world, id);
      this.tracked.set(id, {
        id,
        look: resolveLook(def.look ?? fallbackLook(id), c.items.includes("umbrella")),
        view: null,
        x: 0,
        z: 0,
        yaw: 0,
        phase: 0,
        isPlayer: c.controlledBy !== null,
      });
    }
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.traffic.setLimits(q.walkers, q.vehicles);
    // Shadows and antialiasing need a reload to change; the menu says so.
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.cam.resize(w, h);
  }

  // --- Per frame ------------------------------------------------------------

  frame(f: FrameInput): void {
    this.timeS += f.dt;
    const L = lightingFor(f.minute, f.weather);
    const rain = f.weather === "rain" || f.weather === "heavy_rain";
    this.lastNight = L.night;

    // Engine characters.
    const figures: Figure[] = [];
    for (const t of this.tracked.values()) {
      const v = personView(f.world, this.city, t.id, f.shownTick, t.view ?? undefined);
      const x = v.x + 0.5;
      const z = v.y + 0.5;
      if (t.view) {
        const dx = x - t.x;
        const dz = z - t.z;
        const d = Math.hypot(dx, dz);
        if (v.moving && d > 1e-4) {
          t.yaw += angleDiff(t.yaw, yawFor(dx, dz)) * Math.min(1, f.dt * 12);
          t.phase += d * 15;
        } else if (!v.moving) {
          const [fx, fz] = FACING[v.facing] ?? [0, 1];
          t.yaw += angleDiff(t.yaw, yawFor(fx, fz)) * Math.min(1, f.dt * 6);
        }
      } else t.yaw = yawFor(...(FACING[v.facing] ?? [0, 1]));
      t.x = x;
      t.z = z;
      t.view = v;
      let fig: Figure | null = null;
      if (v.visible) {
        fig = {
          x,
          z,
          yaw: t.yaw,
          look: t.look,
          pose: v.moving ? "walk" : "idle",
          expr: "neutral",
          phase: t.phase,
          umbrella: rain && t.look.umbrella && !this.stage,
          t: this.timeS + x,
        };
      }
      if (this.stage && (t.id === this.stage.meId || t.id === this.stage.otherId)) {
        const st = this.stage;
        const isMe = t.id === st.meId;
        const p = isMe ? st.a : st.b;
        const o = isMe ? st.b : st.a;
        // Face each other, turned a little towards the camera so faces read.
        const face = yawFor(o.x - p.x, o.z - p.z);
        const toCam = yawFor(st.eye.x - p.x, st.eye.z - p.z);
        const pose: Pose = st.talking === (isMe ? "me" : "other") ? "talk" : "idle";
        fig = {
          x: p.x,
          z: p.z,
          yaw: face + angleDiff(face, toCam) * 0.5,
          look: t.look,
          pose,
          expr: isMe ? st.exprMe : st.exprOther,
          phase: 0,
          umbrella: false,
          t: this.timeS,
        };
      } else if (fig && this.stage) {
        // Keep others from standing inside the two talking.
        const mid = this.stage.a.clone().add(this.stage.b).multiplyScalar(0.5);
        if (Math.hypot(fig.x - mid.x, fig.z - mid.z) < 0.9) fig = null;
      }
      if (fig) {
        figures.push(fig);
        this.figureOf.set(t.id, fig);
      } else this.figureOf.delete(t.id);
      if (t.isPlayer) this.placePlayerMarks(t, v);
    }

    // Background life.
    this.traffic.setMood(nightFactor(f.minute), rain, f.weather === "heavy_rain");
    this.traffic.update(f.gameDt);
    if (!this.stage) figures.push(...this.traffic.figures(rain));
    this.people.setVehicleShadows(this.stage ? [] : this.traffic.vehicleShadows());
    this.people.set(figures);
    for (const v of this.vehicles) {
      const kind = v === this.vehicles[0] ? "danfo" : v === this.vehicles[1] ? "keke" : "okada";
      v.set(this.stage ? [] : this.traffic.vehiclePoses(kind));
    }

    // Markers.
    this.questMarker.rotation.y = this.timeS * 1.5;
    this.questMarker.position.y = this.questMarkerY + Math.sin(this.timeS * 3) * 0.08;
    if (this.dest.visible && f.nowMs > this.destUntil) this.dest.visible = false;

    // Camera.
    if (this.stage) {
      this.cam.setMode("encounter");
      this.cam.setShot(this.stage.eye, this.stage.look, false);
    } else if (this.follow) {
      const me = [...this.tracked.values()].find((t) => t.isPlayer);
      if (me) this.cam.setFollow(me.x, me.z, me.yaw);
      this.cam.setMode("follow");
    } else this.cam.setMode("city");
    this.cam.update(f.dt);

    // Light, weather, glows.
    const sun = sunAt(f.minute, f.weather);
    this.sky.update(L, sun, f.weather, this.timeS, this.cam.focus, this.cam.distance);
    const wet = f.weather === "heavy_rain" ? 1 : f.weather === "rain" ? 0.75 : 0;
    const zoomPx = this.cam.mode === "city" ? this.cam.zoom : 50;
    this.city3d.setLighting(L.night, wet, 1 - L.night, f.nowMs, zoomPx);
    this.ring.visible = this.ring.visible && this.cam.mode !== "encounter";
    this.arrow.visible = this.arrow.visible && this.cam.mode === "city";
    this.questMarker.visible = this.questMarker.visible && this.cam.mode !== "encounter";
  }

  render(): void {
    this.renderer.render(this.scene, this.cam.camera);
  }

  private placePlayerMarks(t: Tracked, v: PersonView): void {
    const shown = v.visible || v.hiddenBecause === "asleep";
    this.ring.visible = v.visible;
    this.arrow.visible = shown;
    this.ring.position.set(t.x, 0.065, t.z);
    this.arrow.position.set(t.x, (v.visible ? 0.95 : 1.9) + Math.sin(this.timeS * 4) * 0.05, t.z);
  }

  // --- Markers ----------------------------------------------------------------

  private questMarkerY = 2;

  setQuestMarker(locationId: string | null): void {
    const a = locationId ? this.city3d.labelAnchor.get(locationId) : null;
    this.questMarker.visible = !!a;
    if (a) {
      this.questMarker.position.set(a.x, a.y + 0.55, a.z);
      this.questMarkerY = a.y + 0.55;
    }
  }

  setDestination(tile: Tile | null, nowMs: number): void {
    this.dest.visible = !!tile;
    if (tile) {
      this.dest.position.set(tile[0] + 0.5, 0.02, tile[1] + 0.5);
      this.destUntil = nowMs + 60_000;
    }
  }

  // --- Camera helpers -----------------------------------------------------------

  setFollow(on: boolean): void {
    this.follow = on;
  }

  get following(): boolean {
    return this.follow;
  }

  /** Where someone is on the map (world units), if drawn. */
  positionOf(id: string): Vector3 | null {
    const t = this.tracked.get(id);
    if (!t || !t.view) return null;
    return new Vector3(t.x, 0, t.z);
  }

  viewOf(id: string): PersonView | null {
    return this.tracked.get(id)?.view ?? null;
  }

  /** Screen position (CSS px) of a world point. */
  project(x: number, y: number, z: number): { x: number; y: number; behind: boolean } {
    return this.cam.project(new Vector3(x, y, z));
  }

  /** Head of a drawn person on screen (for bubbles), or null. */
  headOnScreen(id: string): { x: number; y: number } | null {
    const f = this.figureOf.get(id);
    if (!f) return null;
    const p = this.project(f.x, (f.y ?? 0) + 0.72, f.z);
    return p.behind ? null : p;
  }

  labelOnScreen(locationId: string): { x: number; y: number; behind: boolean } | null {
    const a = this.city3d.labelAnchor.get(locationId);
    return a ? this.cam.project(a) : null;
  }

  /** What is under a screen point: a character, a place, or a spot on the ground. */
  pick(sx: number, sy: number): Pick {
    let best: { id: string; d: number } | null = null;
    for (const [id, f] of this.figureOf) {
      const p = this.project(f.x, (f.y ?? 0) + 0.32, f.z);
      if (p.behind) continue;
      const d = Math.hypot(p.x - sx, p.y - sy);
      const reach = this.cam.mode === "city" ? Math.max(18, this.cam.zoom * 0.35) : 40;
      if (d < reach && (!best || d < best.d)) best = { id, d };
    }
    if (best) return { kind: "person", id: best.id };
    const hit = this.cam.pick(sx, sy, this.city3d.proxies);
    if (hit) return { kind: "place", locationId: String(hit.userData.locationId) };
    const g = this.cam.screenToGround(sx, sy);
    if (!g) return null;
    return { kind: "ground", tile: [Math.floor(g.x), Math.floor(g.z)] };
  }

  // --- Encounters ---------------------------------------------------------------

  /**
   * Stage a conversation where Tobi is: the other person steps up beside him and the camera
   * comes down to street level, from a side with open ground, with Tobi on the left.
   */
  startEncounter(meId: string, otherId: string): void {
    const me = this.tracked.get(meId);
    const a = me ? new Vector3(me.x, 0, me.z) : new Vector3(20, 0, 17);
    const open = (x: number, z: number): boolean => {
      const c = this.city.tiles[Math.floor(z)]?.[Math.floor(x)] ?? "#";
      if (c === "#" || c === "~") return false;
      return !this.city.boxes.some(
        (b) => x > b.x - 0.1 && x < b.x + b.w + 0.1 && z > b.y - 0.1 && z < b.y + b.h + 0.1,
      );
    };
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0.7, 0.7],
      [-0.7, 0.7],
      [0.7, -0.7],
      [-0.7, -0.7],
    ];
    const gap = 0.78;
    let best: Staging | null = null;
    let bestScore = -1;
    for (const [dx, dz] of dirs) {
      const b = new Vector3(a.x + dx * gap, 0, a.z + dz * gap);
      if (!open(b.x, b.z)) continue;
      for (const side of [1, -1]) {
        const nx = -dz * side;
        const nz = dx * side;
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const aspect = this.cam.screenW / Math.max(1, this.cam.screenH);
        const half = Math.tan((58 * Math.PI) / 360) * aspect;
        const dist = Math.max(1.5, Math.min(2.8, 0.66 / half));
        const eye = new Vector3(mid.x + nx * dist, 0.6, mid.z + nz * dist);
        let score = 0;
        for (let k = 0.3; k <= 1.0; k += 0.35)
          if (open(mid.x + nx * dist * k, mid.z + nz * dist * k)) score++;
        // Nothing (a wall, a clothesline, a canopy) between the camera and either face.
        for (const p of [a, b]) if (this.blocked(eye, new Vector3(p.x, 0.62, p.z))) score -= 4;
        // Tobi should be on the left of the screen: screen-right is (look - eye) x up.
        const fx = mid.x - eye.x;
        const fz = mid.z - eye.z;
        const rx = -fz;
        const rz = fx;
        const tobiRight = (a.x - mid.x) * rx + (a.z - mid.z) * rz > 0;
        if (!tobiRight) score += 2;
        if (score > bestScore) {
          bestScore = score;
          best = {
            meId,
            otherId,
            a,
            b,
            eye,
            look: new Vector3(mid.x, 0.36, mid.z),
            exprMe: "neutral",
            exprOther: "neutral",
            talking: null,
          };
        }
      }
    }
    this.stage = best ?? {
      meId,
      otherId,
      a,
      b: new Vector3(a.x + gap, 0, a.z),
      eye: new Vector3(a.x + 0.4, 0.62, a.z + 2.4),
      look: new Vector3(a.x + 0.4, 0.36, a.z),
      exprMe: "neutral",
      exprOther: "neutral",
      talking: null,
    };
    // Tobi always stands on the left of the shot (his name and bubble are on that side): if the
    // best camera side puts him on the right, the two swap places.
    {
      const st = this.stage;
      const fx = st.look.x - st.eye.x;
      const fz = st.look.z - st.eye.z;
      const mid = st.a.clone().add(st.b).multiplyScalar(0.5);
      if ((st.a.x - mid.x) * -fz + (st.a.z - mid.z) * fx > 0) {
        const a0 = st.a;
        st.a = st.b;
        st.b = a0;
      }
    }
    this.cam.setShot(this.stage.eye, this.stage.look, true);
    this.cam.setMode("encounter");
  }

  private readonly blockRay = new Raycaster();

  private blocked(from: Vector3, to: Vector3): boolean {
    const dir = to.clone().sub(from);
    const len = dir.length();
    this.blockRay.set(from, dir.normalize());
    this.blockRay.far = len - 0.15;
    return this.blockRay.intersectObject(this.city3d.solid, false).length > 0;
  }

  setExpressions(me: Expression, other: Expression): void {
    if (!this.stage) return;
    this.stage.exprMe = me;
    this.stage.exprOther = other;
  }

  setTalking(who: "me" | "other" | null): void {
    if (this.stage) this.stage.talking = who;
  }

  endEncounter(): void {
    this.stage = null;
  }

  /** Heads of the two people in the encounter, on screen. */
  encounterHeads(): { left: { x: number; y: number }; right: { x: number; y: number } } | null {
    if (!this.stage) return null;
    const l = this.project(this.stage.a.x, 0.74, this.stage.a.z);
    const r = this.project(this.stage.b.x, 0.74, this.stage.b.z);
    return { left: l, right: r };
  }

  get night(): number {
    return this.lastNight;
  }

  stats(): { calls: number; triangles: number } {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }
}
