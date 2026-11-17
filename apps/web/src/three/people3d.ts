import type { BufferGeometry, Material } from "three";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { Look } from "../render/look";
import { blobTexture } from "./textures";

/**
 * Low-poly people built from primitives: legs, torso, a skirt or wrapper, arms, head, hair,
 * gele or cap, eyes, brows and a mouth. Every body part is ONE instanced mesh for all people,
 * so the whole crowd costs about 18 draw calls. Limbs swing for a walk cycle; a few poses and
 * four expressions (neutral, happy, annoyed, surprised) serve the encounter scenes.
 */

export type Pose = "idle" | "walk" | "wave" | "talk" | "ride";
export type Expression = "neutral" | "happy" | "annoyed" | "surprised";

export interface Figure {
  x: number;
  z: number;
  /** Height of the feet (e.g. on a bike seat). */
  y?: number;
  /** Facing angle (0 = +z). */
  yaw: number;
  look: Look;
  pose: Pose;
  expr: Expression;
  /** Walk-cycle phase (radians). */
  phase: number;
  umbrella: boolean;
  /** Seconds, for little idle movements. */
  t: number;
  /** Turn of the head relative to the body. */
  headYaw?: number;
}

type Part =
  | "leg"
  | "arm"
  | "torso"
  | "skirt"
  | "head"
  | "hairCap"
  | "hairBig"
  | "hairBack"
  | "gele"
  | "capTop"
  | "brim"
  | "eye"
  | "brow"
  | "mouth"
  | "detail"
  | "umbrella"
  | "stick";

const GEO: Record<Part, () => BufferGeometry> = {
  // Limbs hang from their top: geometry shifted so y = 0 is the joint.
  leg: () => new BoxGeometry(1, 1, 1).translate(0, -0.5, 0),
  arm: () => new BoxGeometry(1, 1, 1).translate(0, -0.5, 0),
  torso: () => new BoxGeometry(1, 1, 1),
  skirt: () => new CylinderGeometry(0.42, 0.5, 1, 8, 1),
  head: () => new SphereGeometry(0.5, 8, 6),
  hairCap: () => new SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55),
  hairBig: () => new SphereGeometry(0.5, 7, 5),
  hairBack: () => new BoxGeometry(1, 1, 1).translate(0, -0.5, 0),
  gele: () => new CylinderGeometry(0.5, 0.36, 1, 8, 1),
  capTop: () => new CylinderGeometry(0.5, 0.5, 1, 8, 1),
  brim: () => new BoxGeometry(1, 1, 1),
  eye: () => new BoxGeometry(1, 1, 1),
  brow: () => new BoxGeometry(1, 1, 1),
  mouth: () => new BoxGeometry(1, 1, 1),
  detail: () => new BoxGeometry(1, 1, 1),
  umbrella: () => new CylinderGeometry(0, 0.5, 0.35, 8, 1, true).translate(0, -0.175, 0),
  stick: () => new BoxGeometry(1, 1, 1),
};

const PER_PERSON: Record<Part, number> = {
  leg: 2,
  arm: 2,
  torso: 1,
  skirt: 1,
  head: 1,
  hairCap: 1,
  hairBig: 1,
  hairBack: 1,
  gele: 1,
  capTop: 1,
  brim: 1,
  eye: 2,
  brow: 2,
  mouth: 1,
  detail: 1,
  umbrella: 1,
  stick: 1,
};

const FACE_DARK = 0x1a1210;
const LIP = 0x5a2320;

export class PeopleLayer {
  readonly root = new Group();
  private readonly meshes = new Map<Part, InstancedMesh>();
  private readonly counts = new Map<Part, number>();
  private readonly shadows: InstancedMesh;
  private shadowCount = 0;
  private readonly B = new Matrix4();
  private readonly L = new Matrix4();
  private readonly M = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly c = new Color();
  private readonly child = new Matrix4();
  private readonly head = new Matrix4();
  private readonly one = new Vector3(1, 1, 1);
  private readonly q0 = new Quaternion();

  constructor(
    private readonly capacity: number,
    material: Material = new MeshLambertMaterial({ flatShading: true }),
  ) {
    for (const part of Object.keys(GEO) as Part[]) {
      const mesh = new InstancedMesh(GEO[part](), material, capacity * PER_PERSON[part]);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = part !== "eye" && part !== "brow" && part !== "mouth";
      mesh.count = 0;
      mesh.setColorAt(0, this.c.setHex(0xffffff));
      this.meshes.set(part, mesh);
      this.root.add(mesh);
    }
    const sm = new MeshBasicMaterial({
      map: blobTexture(),
      transparent: true,
      depthWrite: false,
      color: 0x000000,
    });
    sm.color.setHex(0xffffff);
    this.shadows = new InstancedMesh(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      sm,
      capacity * 2,
    );
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.shadows.count = 0;
    this.root.add(this.shadows);
  }

  /** Extra blob shadows (vehicles), drawn with the people's. */
  private extraShadows: { x: number; z: number; w: number; d: number; yaw: number }[] = [];
  setVehicleShadows(list: { x: number; z: number; w: number; d: number; yaw: number }[]): void {
    this.extraShadows = list;
  }

  private put(part: Part, color: number): void {
    const mesh = this.meshes.get(part)!;
    const i = this.counts.get(part) ?? 0;
    if (i >= mesh.instanceMatrix.count) return;
    this.M.multiplyMatrices(this.B, this.L);
    mesh.setMatrixAt(i, this.M);
    mesh.setColorAt(i, this.c.setHex(color));
    this.counts.set(part, i + 1);
  }

  /** Local transform: translate, rotate (x, y, z), scale. */
  private local(
    tx: number,
    ty: number,
    tz: number,
    rx: number,
    ry: number,
    rz: number,
    sx: number,
    sy: number,
    sz: number,
  ): void {
    this.q.setFromEuler(this.e.set(rx, ry, rz, "YXZ"));
    this.L.compose(this.v.set(tx, ty, tz), this.q, this.s.set(sx, sy, sz));
  }

  /** Child of the last local transform (for parts on the head). */
  private headPart(
    head: Matrix4,
    tx: number,
    ty: number,
    tz: number,
    rx: number,
    rz: number,
    sx: number,
    sy: number,
    sz: number,
  ): void {
    this.q.setFromEuler(this.e.set(rx, 0, rz, "YXZ"));
    this.child.compose(this.v.set(tx, ty, tz), this.q, this.s.set(sx, sy, sz));
    this.L.multiplyMatrices(head, this.child);
  }

  set(figures: Figure[]): void {
    for (const k of this.meshes.keys()) this.counts.set(k, 0);
    this.shadowCount = 0;
    const n = Math.min(figures.length, this.capacity);
    for (let i = 0; i < n; i++) this.draw(figures[i]!);
    for (const sh of this.extraShadows) {
      if (this.shadowCount >= this.shadows.instanceMatrix.count) break;
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), sh.yaw);
      this.M.compose(this.v.set(sh.x, 0.02, sh.z), this.q, this.s.set(sh.w, 1, sh.d));
      this.shadows.setMatrixAt(this.shadowCount++, this.M);
    }
    for (const [part, mesh] of this.meshes) {
      mesh.count = this.counts.get(part) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.shadows.count = this.shadowCount;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  private draw(f: Figure): void {
    const L = f.look;
    const wide = L.build === "slim" ? 0.88 : L.build === "broad" ? 1.16 : 1;
    const walking = f.pose === "walk";
    const swing = walking ? Math.sin(f.phase) : 0;
    const bob = walking ? Math.abs(Math.cos(f.phase)) * 0.012 : Math.sin(f.t * 1.7) * 0.003;
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), f.yaw);
    this.B.compose(this.s.set(f.x, (f.y ?? 0) + bob, f.z), this.q, this.one);

    if (this.shadowCount < this.shadows.instanceMatrix.count && (f.y ?? 0) < 0.05) {
      this.M.compose(this.v.set(f.x, 0.021, f.z), this.q0, this.s.set(0.36, 1, 0.36));
      this.shadows.setMatrixAt(this.shadowCount++, this.M);
    }

    const long = L.outfit === "dress" || L.outfit === "blouse_wrapper" || L.outfit === "kaftan";
    const legColor = L.outfit === "dress" ? L.skin : L.bottom;
    const ride = f.pose === "ride";
    // Legs.
    for (const side of [-1, 1]) {
      const a = ride ? -1.35 : swing * 0.55 * side;
      this.local(0.042 * side * wide, 0.24, 0, a, 0, 0, 0.068 * wide, 0.235, 0.075);
      this.put("leg", legColor);
    }
    // Torso and the long garments.
    this.local(0, 0.345, 0, 0, 0, 0, 0.17 * wide, 0.21, 0.1);
    this.put("torso", L.top);
    if (long) {
      const len = L.outfit === "blouse_wrapper" ? 0.2 : L.outfit === "dress" ? 0.17 : 0.15;
      this.local(0, 0.25 - len / 2 + 0.02, 0, 0, 0, 0, 0.23 * wide, len, 0.17);
      this.put("skirt", L.outfit === "blouse_wrapper" ? L.bottom : L.top);
    }
    if (L.outfit === "shirt" || L.outfit === "suit") {
      this.local(0, 0.43, 0.052, 0, 0, 0, 0.05, 0.05, 0.004);
      this.put("detail", L.outfit === "suit" ? 0xf5f5f5 : L.accent);
    } else {
      this.local(0, 0.4, 0.052, 0, 0, 0, 0.1 * wide, 0.025, 0.004);
      this.put("detail", L.accent);
    }
    // Arms.
    const sleeves = L.outfit === "shirt" || L.outfit === "suit" || L.outfit === "kaftan";
    for (const side of [-1, 1]) {
      let rx = walking ? -swing * 0.5 * side : Math.sin(f.t * 1.3 + side) * 0.04;
      let rz = 0.08 * side;
      if (ride) rx = -1.1;
      if (side === 1 && f.pose === "wave") {
        rx = -2.7;
        rz = 0.35 + Math.sin(f.t * 9) * 0.35;
      }
      if (side === 1 && f.pose === "talk") rx = -0.7 + Math.sin(f.t * 5) * 0.25;
      this.local(0.105 * side * wide, 0.44, 0, rx, 0, rz, 0.05, 0.21, 0.055);
      this.put("arm", sleeves ? L.top : L.skin);
    }
    // Head (with its own turn and a nod while talking).
    const nod = f.pose === "talk" ? Math.sin(f.t * 6) * 0.08 : 0;
    this.q.setFromEuler(this.e.set(nod, f.headYaw ?? 0, 0, "YXZ"));
    const head = this.head.compose(this.v.set(0, 0.52, 0), this.q, this.one);
    this.headPart(head, 0, 0, 0, 0, 0, 0.14, 0.15, 0.14);
    this.put("head", L.skin);

    // Face.
    const ex = f.expr;
    const eyeY = ex === "happy" ? 0.5 : ex === "surprised" ? 1.35 : 1;
    for (const side of [-1, 1]) {
      this.headPart(head, 0.028 * side, 0.012, 0.066, 0, 0, 0.016, 0.02 * eyeY, 0.008);
      this.put("eye", FACE_DARK);
      const browZ = ex === "annoyed" ? -0.45 * side : ex === "happy" ? 0.12 * side : 0;
      const browY = ex === "surprised" ? 0.05 : 0.036;
      this.headPart(head, 0.028 * side, browY, 0.065, 0, browZ, 0.03, 0.006, 0.006);
      this.put("brow", FACE_DARK);
    }
    const [mw, mh] =
      ex === "happy"
        ? [0.05, 0.014]
        : ex === "surprised"
          ? [0.022, 0.026]
          : ex === "annoyed"
            ? [0.03, 0.006]
            : [0.034, 0.008];
    this.headPart(head, 0, -0.035, 0.066, 0, 0, mw, mh, 0.006);
    this.put("mouth", LIP);

    // Hair and headwear.
    const hair = L.hairColor;
    const covered = L.headwear === "gele" || L.headwear === "headscarf";
    if (!covered && L.hair !== "bald") {
      if (L.hair === "afro") {
        this.headPart(head, 0, 0.03, -0.01, 0, 0, 0.19, 0.17, 0.18);
        this.put("hairBig", hair);
      } else {
        this.headPart(head, 0, 0.004, -0.004, 0, 0, 0.152, 0.16, 0.152);
        this.put("hairCap", hair);
        if (L.hair === "bun") {
          this.headPart(head, 0, 0.08, -0.04, 0, 0, 0.07, 0.07, 0.07);
          this.put("hairBig", hair);
        } else if (L.hair === "twists") {
          this.headPart(head, 0, 0.04, 0, 0, 0, 0.165, 0.12, 0.16);
          this.put("hairBig", hair);
        } else if (L.hair === "braids" || L.hair === "locs") {
          this.headPart(head, 0, 0.02, -0.055, 0, 0, 0.12, L.hair === "locs" ? 0.16 : 0.12, 0.03);
          this.put("hairBack", hair);
        }
      }
    }
    if (L.headwear === "gele") {
      this.headPart(head, 0, 0.075, -0.01, -0.25, 0, 0.24, 0.1, 0.2);
      this.put("gele", L.accent);
    } else if (L.headwear === "headscarf") {
      this.headPart(head, 0, 0.006, -0.006, 0, 0, 0.158, 0.165, 0.158);
      this.put("hairCap", L.accent);
    } else if (L.headwear === "cap") {
      this.headPart(head, 0, 0.055, 0, 0, 0, 0.15, 0.05, 0.15);
      this.put("capTop", L.accent);
      this.headPart(head, 0, 0.035, 0.08, 0, 0, 0.11, 0.01, 0.07);
      this.put("brim", L.accent);
    } else if (L.headwear === "fila") {
      this.headPart(head, 0.01, 0.065, 0, 0, -0.25, 0.14, 0.08, 0.14);
      this.put("capTop", L.accent);
    }
    // Umbrella in the rain.
    if (f.umbrella && !ride) {
      this.local(0.06, 0.78, 0.02, 0, 0, 0, 0.62, 1, 0.62);
      this.put("umbrella", L.accent === 0xffffff ? 0x1d3557 : L.accent);
      this.local(0.06, 0.6, 0.02, 0, 0, 0, 0.012, 0.36, 0.012);
      this.put("stick", 0x333333);
    }
  }
}

/** Where a figure's head is (for speech bubbles), given its feet position. */
export function headHeight(f: Pick<Figure, "y">): number {
  return (f.y ?? 0) + 0.66;
}
