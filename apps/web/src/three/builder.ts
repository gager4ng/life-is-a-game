import type { BufferGeometry } from "three";
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  BufferGeometry as Geo,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";

/**
 * Collects many small coloured shapes into ONE geometry (one draw call): flat-shaded, colour per
 * vertex. Used for everything in the city that doesn't move.
 */
export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private readonly c = new Color();
  private readonly v = new Vector3();
  private readonly nm = new Matrix4();

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /** Append any geometry, transformed by `m`, in one colour (sRGB hex). */
  add(g: BufferGeometry, m: Matrix4, color: number): this {
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.getAttribute("position");
    src.computeVertexNormals();
    const n = src.getAttribute("normal");
    const uv = src.getAttribute("uv");
    this.c.setHex(color);
    this.nm.copy(m).invert().transpose();
    for (let i = 0; i < p.count; i++) {
      this.v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(n, i).applyMatrix4(this.nm).normalize();
      this.nor.push(this.v.x, this.v.y, this.v.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
      if (uv) this.uv.push(uv.getX(i), uv.getY(i));
      else this.uv.push(0, 0);
    }
    if (src !== g) src.dispose();
    return this;
  }

  /** Append a geometry that already has vertex colours (e.g. a built vehicle), transformed. */
  addPainted(g: BufferGeometry, m: Matrix4): this {
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const c = g.getAttribute("color");
    this.nm.copy(m).invert().transpose();
    for (let i = 0; i < p.count; i++) {
      this.v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(n, i).applyMatrix4(this.nm).normalize();
      this.nor.push(this.v.x, this.v.y, this.v.z);
      this.col.push(c.getX(i), c.getY(i), c.getZ(i));
      this.uv.push(0, 0);
    }
    return this;
  }

  /** Axis-aligned box from (x0,y0,z0) to (x1,y1,z1). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number): this {
    const g = unitBox();
    return this.add(
      g,
      at(m4(), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0),
      color,
    );
  }

  /** A flat quad given 4 corners (counter-clockwise seen from the front), with optional UVs. */
  quad(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    color: number,
    uv: [number, number, number, number] = [0, 0, 1, 1],
  ): this {
    this.c.setHex(color);
    const e1 = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const e2 = new Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    const n = e1.cross(e2).normalize();
    const [u0, v0, u1, v1] = uv;
    const verts: [number[], number, number][] = [
      [a, u0, v0],
      [b, u1, v0],
      [c, u1, v1],
      [a, u0, v0],
      [c, u1, v1],
      [d, u0, v1],
    ];
    for (const [p, u, v] of verts) {
      this.pos.push(p[0]!, p[1]!, p[2]!);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.uv.push(u, v);
    }
    return this;
  }

  /** Horizontal rectangle at height y (facing up). */
  floor(x0: number, z0: number, x1: number, z1: number, y: number, color: number): this {
    return this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], color);
  }

  build(): BufferGeometry {
    const g = new Geo();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Shared unit shapes (low segment counts: this is a low-poly city).
let BOX: BufferGeometry | null = null;
export const unitBox = (): BufferGeometry => (BOX ??= new BoxGeometry(1, 1, 1));
const CYL = new Map<number, BufferGeometry>();
export const unitCylinder = (seg = 8): BufferGeometry => {
  let g = CYL.get(seg);
  if (!g) CYL.set(seg, (g = new CylinderGeometry(0.5, 0.5, 1, seg, 1)));
  return g;
};
let CONE: BufferGeometry | null = null;
export const unitCone = (): BufferGeometry => (CONE ??= new ConeGeometry(0.5, 1, 8, 1));
let ICO: BufferGeometry | null = null;
export const unitIco = (): BufferGeometry => (ICO ??= new IcosahedronGeometry(0.5, 0));
let SPH: BufferGeometry | null = null;
export const unitSphere = (): BufferGeometry => (SPH ??= new SphereGeometry(0.5, 8, 6));

export const m4 = (): Matrix4 => new Matrix4();
const q = new Quaternion();
const e = new Vector3();
const s = new Vector3();

/** Set `m` to translate (x,y,z), rotate about Y by `yaw`, and scale (sx,sy,sz). */
export function at(
  m: Matrix4,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
  yaw = 0,
  tilt = 0,
): Matrix4 {
  q.setFromAxisAngle(e.set(0, 1, 0), yaw);
  if (tilt) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt));
  return m.compose(new Vector3(x, y, z), q, s.set(sx, sy, sz));
}
