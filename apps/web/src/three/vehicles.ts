import type { BufferGeometry, Material } from "three";
import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { GeoBuilder, at, m4, unitCylinder } from "./builder";

/**
 * Danfos, keke and okada as low-poly models built from boxes and cylinders, each kind one
 * geometry with vertex colours. Parts painted white take the per-vehicle paint colour (instance
 * colour), everything else (windows, tyres, stripes) keeps its own colour.
 */

export type VehicleKind = "danfo" | "keke" | "okada";

const WHITE = 0xffffff;
const GLASS = 0x22303d;
const TYRE = 0x1b1b1b;
const STRIPE = 0x151515;
const METAL = 0x8a8f96;

function wheels(b: GeoBuilder, xs: number[], halfW: number, r: number, w = 0.06): void {
  const m = m4();
  for (const x of xs)
    for (const side of [-1, 1]) {
      at(m, x, r, side * halfW, r * 2, w, r * 2, 0, Math.PI / 2);
      // Cylinder axis is y; tilt 90° about x puts it along z.
      b.add(unitCylinder(8), m, TYRE);
    }
}

/** Models face +x (length along x), sit on y = 0, centred on the origin. */
export function vehicleGeometry(kind: VehicleKind): BufferGeometry {
  const b = new GeoBuilder();
  if (kind === "danfo") {
    // The yellow Lagos minibus with black stripes and a roof rack.
    const L = 0.98;
    const W = 0.44;
    b.box(-L / 2, 0.08, -W / 2, L / 2, 0.42, W / 2, WHITE);
    b.box(-L / 2 + 0.06, 0.24, -W / 2 - 0.005, L / 2 - 0.2, 0.36, W / 2 + 0.005, GLASS);
    b.box(L / 2 - 0.19, 0.22, -W / 2 + 0.03, L / 2 + 0.005, 0.38, W / 2 - 0.03, GLASS);
    for (const y of [0.17, 0.2])
      b.box(-L / 2, y, -W / 2 - 0.008, L / 2, y + 0.016, W / 2 + 0.008, STRIPE);
    b.box(-L / 2 + 0.1, 0.42, -W / 2 + 0.06, L / 2 - 0.25, 0.46, W / 2 - 0.06, METAL);
    b.box(L / 2 - 0.01, 0.1, -W / 2 + 0.04, L / 2 + 0.02, 0.15, W / 2 - 0.04, METAL);
    wheels(b, [-0.3, 0.3], W / 2, 0.08);
  } else if (kind === "keke") {
    // Tricycle taxi: small cab with a canopy, one wheel in front, two behind.
    b.box(-0.24, 0.08, -0.17, 0.12, 0.24, 0.17, WHITE);
    b.box(-0.26, 0.42, -0.19, 0.2, 0.45, 0.19, WHITE);
    for (const [x, z] of [
      [-0.24, -0.16],
      [-0.24, 0.16],
      [0.18, -0.17],
      [0.18, 0.17],
    ] as const)
      b.box(x - 0.012, 0.24, z - 0.012, x + 0.012, 0.42, z + 0.012, STRIPE);
    b.box(0.12, 0.1, -0.08, 0.25, 0.3, 0.08, WHITE);
    b.box(0.18, 0.3, -0.16, 0.2, 0.4, 0.16, GLASS);
    wheels(b, [-0.16], 0.16, 0.065, 0.05);
    const m = at(m4(), 0.22, 0.065, 0, 0.13, 0.05, 0.13, 0, Math.PI / 2);
    b.add(unitCylinder(8), m, TYRE);
  } else {
    // Okada (motorbike); the rider is a person drawn on top.
    b.box(-0.2, 0.12, -0.035, 0.18, 0.2, 0.035, WHITE);
    b.box(-0.18, 0.2, -0.055, 0.02, 0.24, 0.055, STRIPE);
    b.box(0.14, 0.2, -0.12, 0.17, 0.27, 0.12, METAL);
    const m = m4();
    for (const x of [-0.2, 0.2]) {
      at(m, x, 0.08, 0, 0.16, 0.04, 0.16, 0, Math.PI / 2);
      b.add(unitCylinder(8), m, TYRE);
    }
  }
  return b.build();
}

export const DANFO_YELLOW = 0xf6c90e;
export const KEKE_COLORS = [0xf6c90e, 0x2a9d8f, 0x3a86ff, 0x6a994e];
export const OKADA_COLORS = [0xd62828, 0x1d3557, 0x2a9d8f, 0xf77f00];

export interface VehiclePose {
  x: number;
  z: number;
  yaw: number;
  color: number;
}

/** All moving vehicles of one kind in one draw call. */
export class VehicleInstances {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly p = new Vector3();
  private readonly one = new Vector3(1, 1, 1);
  private readonly c = new Color();

  constructor(kind: VehicleKind, material: Material, capacity: number) {
    this.mesh = new InstancedMesh(vehicleGeometry(kind), material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    // Create the colour buffer before the first render so the shader includes it.
    this.mesh.setColorAt(0, this.c.setHex(0xffffff));
  }

  set(list: VehiclePose[]): void {
    const n = Math.min(list.length, this.mesh.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      const v = list[i]!;
      // Models face +x; yaw is measured from +z, so turn a further -90°.
      this.q.setFromAxisAngle(this.up, v.yaw - Math.PI / 2);
      this.m.compose(this.p.set(v.x, 0, v.z), this.q, this.one);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.setHex(v.color));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
