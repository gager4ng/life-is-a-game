import type { BufferGeometry } from "three";
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  BufferGeometry as Geo,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Points,
  PointsMaterial,
  Vector3,
} from "three";
import type { Box, CityModel, PlaceView } from "../render/city-model";
import { shade } from "../render/color";
import { hash, hash01 } from "../util/random";
import {
  GeoBuilder,
  at,
  m4,
  unitBox,
  unitCone,
  unitCylinder,
  unitIco,
  unitSphere,
} from "./builder";
import { FLOOR_H, buildingHeight } from "./coords";
import type { SignAtlas } from "./textures";
import { glowTexture } from "./textures";
import { DANFO_YELLOW, vehicleGeometry } from "./vehicles";

/**
 * The static city in 3D, built once from the same city model as before: ground, roads,
 * sidewalks and zebra crossings; Lagos-style buildings with windows, shop shutters, signboards,
 * water tanks and AC units; streetlights, trees and each place's own props. Everything that
 * doesn't move is merged into a handful of meshes, so the whole district costs a few draw calls.
 */

const C = {
  road: 0x4b4b52,
  roadLine: 0xe9e4d4,
  sidewalk: 0xc9c2b4,
  kerb: 0x9a958a,
  zebra: 0xf2efe6,
  yard: 0xd8c3a0,
  grass: 0x7fb069,
  water: 0x3f6f80,
  lot: 0x7d7262,
  glass: 0x2b3a4a,
  lit: 0xffd27a,
  shutter: 0x6b6f75,
  shopLit: 0xfff1c9,
  tankBlack: 0x1f1f1f,
  tankBlue: 0x1d4e89,
  pole: 0x55595f,
  trunk: 0x6d4c33,
  leaves: [0x4f8a3c, 0x5f9e45, 0x3f7a35],
  wood: 0x8a5a36,
  concrete: 0xb9b4aa,
};

type Side = "S" | "N" | "E" | "W";
const SIDES: Side[] = ["S", "N", "E", "W"];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function sideLen(r: Rect, s: Side): number {
  return s === "S" || s === "N" ? r.w : r.h;
}

/** Point on a wall: `t` along the wall from its left end (seen from outside), height y, `d` out. */
function wallPt(r: Rect, s: Side, t: number, y: number, d: number): [number, number, number] {
  const x0 = r.x;
  const x1 = r.x + r.w;
  const z0 = r.y;
  const z1 = r.y + r.h;
  switch (s) {
    case "S":
      return [x0 + t, y, z1 + d];
    case "N":
      return [x1 - t, y, z0 - d];
    case "E":
      return [x1 + d, y, z1 - t];
    case "W":
      return [x0 - d, y, z0 + t];
  }
}

function wallRect(
  b: GeoBuilder,
  r: Rect,
  s: Side,
  t0: number,
  t1: number,
  y0: number,
  y1: number,
  d: number,
  color: number,
  uv?: [number, number, number, number],
): void {
  b.quad(
    wallPt(r, s, t0, y0, d),
    wallPt(r, s, t1, y0, d),
    wallPt(r, s, t1, y1, d),
    wallPt(r, s, t0, y1, d),
    color,
    uv,
  );
}

export interface City3D {
  root: Group;
  /** The merged buildings and props (for checking what blocks the camera). */
  solid: Mesh;
  /** The ground (separate so it can look wet). */
  groundMaterial: MeshPhongMaterial;
  /** Invisible boxes per place, for tapping buildings. */
  proxies: Mesh[];
  /** Where a place's name label floats. */
  labelAnchor: Map<string, Vector3>;
  /** Day/night and weather. */
  setLighting(night: number, wet: number, daylight: number, timeMs: number, zoomPx: number): void;
}

export function buildCity3D(
  city: CityModel,
  signs: SignAtlas,
  signTexts: string[],
  halos: boolean,
): City3D {
  const tiles = city.tiles;
  const code = (x: number, y: number): string => tiles[y]?.[x] ?? "#";
  const ground = new GeoBuilder();
  const solid = new GeoBuilder();
  const lit = new GeoBuilder();
  const signB = new GeoBuilder();
  const shadow = new GeoBuilder();
  const haloPts: number[] = [];
  const m = m4();

  // --- Ground ---------------------------------------------------------------
  for (let y = 0; y < city.height; y++) {
    for (let x = 0; x < city.width; x++) {
      const c = code(x, y);
      if (c === "s") {
        ground.box(x, 0, y, x + 1, 0.05, y + 1, C.sidewalk);
      } else if (c === "p") ground.floor(x, y, x + 1, y + 1, 0.02, C.yard);
      else if (c === "g") ground.floor(x, y, x + 1, y + 1, 0.015, C.grass);
      else if (c === "~") ground.floor(x, y, x + 1, y + 1, -0.06, C.water);
      else if (c === "#") ground.floor(x, y, x + 1, y + 1, 0.01, C.lot);
      else {
        ground.floor(x, y, x + 1, y + 1, 0, C.road);
        if (c === "z") {
          // Bars run along the traffic: pedestrians cross them.
          const walkX = "sz".includes(code(x - 1, y)) || "sz".includes(code(x + 1, y));
          for (let i = 0; i < 3; i++) {
            const a = 0.12 + i * 0.29;
            if (walkX) ground.floor(x + a, y + 0.1, x + a + 0.15, y + 0.9, 0.006, C.zebra);
            else ground.floor(x + 0.1, y + a, x + 0.9, y + a + 0.15, 0.006, C.zebra);
          }
        } else {
          const horiz = code(x - 1, y) === "R" && code(x + 1, y) === "R";
          const vert = code(x, y - 1) === "R" && code(x, y + 1) === "R";
          if (horiz && !vert) {
            const twoLane = code(x, y - 1) === "R";
            const zc = twoLane ? y : code(x, y + 1) === "R" ? y + 1 : y + 0.5;
            if (twoLane || code(x, y + 1) !== "R")
              ground.floor(x + 0.15, zc - 0.025, x + 0.55, zc + 0.025, 0.006, C.roadLine);
          } else if (vert && !horiz) {
            const twoLane = code(x - 1, y) === "R";
            const xc = twoLane ? x : code(x + 1, y) === "R" ? x + 1 : x + 0.5;
            if (twoLane || code(x + 1, y) !== "R")
              ground.floor(xc - 0.025, y + 0.15, xc + 0.025, y + 0.55, 0.006, C.roadLine);
          }
        }
      }
    }
  }

  // --- Buildings ------------------------------------------------------------
  const streetSide = (rr: Rect, s: Side): boolean => {
    // Whole tiles: the drawn walls are inset a little from the plot.
    const r = {
      x: Math.round(rr.x),
      y: Math.round(rr.y),
      w: Math.round(rr.w),
      h: Math.round(rr.h),
    };
    const n = sideLen(r, s);
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const [tx, ty] =
        s === "S"
          ? [r.x + i, r.y + r.h]
          : s === "N"
            ? [r.x + i, r.y - 1]
            : s === "E"
              ? [r.x + r.w, r.y + i]
              : [r.x - 1, r.y + i];
      if ("szRp".includes(code(tx, ty))) hits++;
    }
    return hits > n / 2;
  };

  const signText = (box: Box): string => {
    if (box.locationId) {
      const p = city.places.find((pl) => pl.locationId === box.locationId);
      return p ? p.name : "";
    }
    return signTexts.length ? signTexts[box.style.seed % signTexts.length]! : "";
  };

  for (const box of city.boxes) {
    const H = buildingHeight(box);
    const st = box.style;
    const r: Rect = { x: box.x + 0.04, y: box.y + 0.04, w: box.w - 0.08, h: box.h - 0.08 };
    solid.box(r.x, 0, r.y, r.x + r.w, H, r.y + r.h, st.wall);
    solid.box(
      r.x - 0.02,
      0,
      r.y - 0.02,
      r.x + r.w + 0.02,
      0.1,
      r.y + r.h + 0.02,
      shade(st.wall, 0.7),
    );
    // Ledges between floors.
    for (let f = 1; f < st.floors; f++) {
      const y = f * FLOOR_H + 0.06;
      solid.box(
        r.x - 0.025,
        y,
        r.y - 0.025,
        r.x + r.w + 0.025,
        y + 0.04,
        r.y + r.h + 0.025,
        shade(st.wall, 0.82),
      );
    }
    // Roof.
    if (st.zinc) {
      const along = r.w >= r.h;
      const ridge = 0.28;
      const o = 0.06;
      const x0 = r.x - o;
      const x1 = r.x + r.w + o;
      const z0 = r.y - o;
      const z1 = r.y + r.h + o;
      const roofA = st.roof;
      const roofB = shade(st.roof, 0.82);
      if (along) {
        const zm = (z0 + z1) / 2;
        solid.quad([x0, H, z1], [x1, H, z1], [x1, H + ridge, zm], [x0, H + ridge, zm], roofA);
        solid.quad([x1, H, z0], [x0, H, z0], [x0, H + ridge, zm], [x1, H + ridge, zm], roofB);
        solid.quad(
          [x0 + o, H, z0 + o],
          [x0 + o, H, z1 - o],
          [x0 + o, H + ridge * 0.9, zm],
          [x0 + o, H + ridge * 0.9, zm],
          st.wall,
        );
        solid.quad(
          [x1 - o, H, z1 - o],
          [x1 - o, H, z0 + o],
          [x1 - o, H + ridge * 0.9, zm],
          [x1 - o, H + ridge * 0.9, zm],
          st.wall,
        );
      } else {
        const xm = (x0 + x1) / 2;
        solid.quad([x1, H, z1], [x1, H, z0], [xm, H + ridge, z0], [xm, H + ridge, z1], roofA);
        solid.quad([x0, H, z0], [x0, H, z1], [xm, H + ridge, z1], [xm, H + ridge, z0], roofB);
        solid.quad(
          [x0 + o, H, z1 - o],
          [x1 - o, H, z1 - o],
          [xm, H + ridge * 0.9, z1 - o],
          [xm, H + ridge * 0.9, z1 - o],
          st.wall,
        );
        solid.quad(
          [x1 - o, H, z0 + o],
          [x0 + o, H, z0 + o],
          [xm, H + ridge * 0.9, z0 + o],
          [xm, H + ridge * 0.9, z0 + o],
          st.wall,
        );
      }
    } else {
      solid.box(
        r.x + 0.04,
        H,
        r.y + 0.04,
        r.x + r.w - 0.04,
        H + 0.02,
        r.y + r.h - 0.04,
        C.concrete,
      );
      const p = 0.12;
      const t = 0.05;
      solid.box(r.x, H, r.y, r.x + r.w, H + p, r.y + t, st.wall);
      solid.box(r.x, H, r.y + r.h - t, r.x + r.w, H + p, r.y + r.h, st.wall);
      solid.box(r.x, H, r.y, r.x + t, H + p, r.y + r.h, st.wall);
      solid.box(r.x + r.w - t, H, r.y, r.x + r.w, H + p, r.y + r.h, st.wall);
    }
    if (st.tank) {
      const tx = r.x + r.w - 0.3;
      const tz = r.y + 0.3;
      const base = st.zinc ? H : H + 0.02;
      solid.box(tx - 0.14, base, tz - 0.14, tx + 0.14, base + 0.12, tz + 0.14, C.pole);
      at(m, tx, base + 0.12 + 0.16, tz, 0.3, 0.32, 0.3);
      solid.add(unitCylinder(8), m, hash01(`tank:${st.seed}`) < 0.6 ? C.tankBlack : C.tankBlue);
    }

    // Which side is the shop front (if any): the street side with the most street.
    const shopSide = st.sign !== null ? (SIDES.find((s) => streetSide(r, s)) ?? null) : null;
    for (const s of SIDES) {
      const len = sideLen(r, s);
      const n = Math.max(1, Math.floor(len / 0.55));
      for (let f = 0; f < st.floors; f++) {
        if (f === 0 && s === shopSide) continue;
        if (f === 0 && box.locationId && streetSide(r, s)) continue; // the place's front: door
        for (let i = 0; i < n; i++) {
          const tc = ((i + 0.5) * len) / n;
          const y0 = f * FLOOR_H + 0.24;
          wallRect(solid, r, s, tc - 0.12, tc + 0.12, y0, y0 + 0.28, 0.004, C.glass);
          if (hash01(`win:${box.x},${box.y},${s},${f},${i}`) < 0.5)
            wallRect(lit, r, s, tc - 0.11, tc + 0.11, y0 + 0.01, y0 + 0.27, 0.008, C.lit);
        }
      }
      // AC unit now and then.
      if (st.floors > 1 && hash01(`ac:${box.x},${box.y},${s}`) < 0.18) {
        const p0 = wallPt(r, s, len * 0.25, FLOOR_H + 0.14, 0.07);
        solid.box(
          p0[0] - 0.09,
          p0[1],
          p0[2] - 0.09,
          p0[0] + 0.09,
          p0[1] + 0.12,
          p0[2] + 0.09,
          0xe6e6e6,
        );
      }
    }
    // Doorway on a place's street side.
    if (box.locationId) {
      const s = SIDES.find((x) => streetSide(r, x)) ?? "S";
      const len = sideLen(r, s);
      wallRect(solid, r, s, len / 2 - 0.16, len / 2 + 0.16, 0.02, 0.42, 0.004, 0x3a2a1e);
      wallRect(lit, r, s, len / 2 - 0.15, len / 2 + 0.15, 0.03, 0.41, 0.008, C.shopLit);
    }
    // Shop: shutter, light behind it at night, and a signboard with a name.
    const sideForSign =
      shopSide ?? (box.locationId ? (SIDES.find((x) => streetSide(r, x)) ?? null) : null);
    if (sideForSign && st.sign !== null) {
      const len = sideLen(r, sideForSign);
      if (shopSide) {
        wallRect(solid, r, shopSide, 0.12, len - 0.12, 0.08, 0.46, 0.004, C.shutter);
        wallRect(lit, r, shopSide, 0.14, len - 0.14, 0.1, 0.44, 0.008, C.shopLit);
      }
      const text = signText(box);
      const cell = signs.cell(text, st.sign);
      const y0 = 0.5;
      const t0 = Math.max(0.05, len / 2 - 0.75);
      const t1 = Math.min(len - 0.05, len / 2 + 0.75);
      wallRect(signB, r, sideForSign, t0, t1, y0, y0 + 0.2, 0.036, 0xffffff, cell.uv);
      // The board's edges.
      const a = wallPt(r, sideForSign, t0, y0, 0);
      const b2 = wallPt(r, sideForSign, t1, y0 + 0.2, 0.03);
      solid.box(
        Math.min(a[0], b2[0]),
        y0,
        Math.min(a[2], b2[2]),
        Math.max(a[0], b2[0]),
        y0 + 0.2,
        Math.max(a[2], b2[2]),
        shade(st.sign, 0.6),
      );
    }
    // Baked shadow on the ground, cast away from the afternoon sun (towards -x, +z).
    const sh = Math.min(1.6, H * 0.55);
    shadow.quad(
      [r.x, 0.012, r.y + r.h],
      [r.x + r.w, 0.012, r.y + r.h],
      [r.x + r.w - sh, 0.012, r.y + r.h + sh * 0.35],
      [r.x - sh, 0.012, r.y + r.h + sh * 0.35],
      0x000000,
    );
    shadow.quad(
      [r.x - sh, 0.012, r.y + sh * 0.35],
      [r.x, 0.012, r.y],
      [r.x, 0.012, r.y + r.h],
      [r.x - sh, 0.012, r.y + r.h + sh * 0.35],
      0x000000,
    );
  }

  // --- Streetlights and trees ------------------------------------------------
  for (const [x, y] of city.streetLights) {
    // Lean towards the road.
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const [dx, dz] = dirs.find(([a, b]) => code(x + a, y + b) === "R") ?? [1, 0];
    const px = x + 0.5 + dx * 0.32;
    const pz = y + 0.5 + dz * 0.32;
    solid.box(px - 0.025, 0.05, pz - 0.025, px + 0.025, 1.15, pz + 0.025, C.pole);
    const hx = px + dx * 0.28;
    const hz = pz + dz * 0.28;
    solid.box(
      Math.min(px, hx) - 0.02,
      1.12,
      Math.min(pz, hz) - 0.02,
      Math.max(px, hx) + 0.02,
      1.15,
      Math.max(pz, hz) + 0.02,
      C.pole,
    );
    solid.box(hx - 0.07, 1.08, hz - 0.05, hx + 0.07, 1.13, hz + 0.05, 0x3b3f44);
    lit.floor(hx - 0.06, hz - 0.04, hx + 0.06, hz + 0.04, 1.075, 0xfff3c4);
    // Undersides face down: flip by drawing the quad the other way.
    lit.quad(
      [hx - 0.06, 1.074, hz - 0.04],
      [hx + 0.06, 1.074, hz - 0.04],
      [hx + 0.06, 1.074, hz + 0.04],
      [hx - 0.06, 1.074, hz + 0.04],
      0xfff3c4,
    );
    haloPts.push(hx, 1.02, hz);
  }
  for (const [x, y] of city.trees) {
    const k = hash01(`tree3:${x},${y}`);
    const cx = x + 0.5 + (k - 0.5) * 0.3;
    const cz = y + 0.5 + (hash01(`tz:${x},${y}`) - 0.5) * 0.3;
    const h = 0.45 + k * 0.35;
    solid.box(cx - 0.04, 0, cz - 0.04, cx + 0.04, h, cz + 0.04, C.trunk);
    const leaf = C.leaves[hash(`tl:${x},${y}`) % C.leaves.length]!;
    solid.add(unitIco(), at(m, cx, h + 0.18, cz, 0.62, 0.5, 0.62, k * 3), leaf);
    solid.add(
      unitIco(),
      at(m, cx + 0.06, h + 0.42, cz - 0.04, 0.42, 0.36, 0.42, k * 5),
      shade(leaf, 1.1),
    );
    shadow.add(unitCylinder(8), at(m, cx - 0.2, 0.011, cz + 0.08, 0.7, 0.001, 0.5), 0x000000);
  }

  // --- Places -----------------------------------------------------------------
  const stageLights = new Group();
  const danfo = vehicleGeometry("danfo");
  const yellow = new Color(DANFO_YELLOW);
  const paintDanfo = danfo.clone();
  {
    const col = paintDanfo.getAttribute("color");
    for (let i = 0; i < col.count; i++) {
      if (col.getX(i) > 0.99 && col.getY(i) > 0.99 && col.getZ(i) > 0.99)
        col.setXYZ(i, yellow.r, yellow.g, yellow.b);
    }
  }
  for (const p of city.places)
    placeProps(p, solid, lit, signB, signs, paintDanfo, stageLights, code);

  // --- Meshes ---------------------------------------------------------------
  const root = new Group();
  const groundMaterial = new MeshPhongMaterial({
    vertexColors: true,
    flatShading: true,
    shininess: 8,
    specular: 0x000000,
  });
  const groundMesh = new Mesh(ground.build(), groundMaterial);
  groundMesh.receiveShadow = true;
  const solidMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const solidMesh = new Mesh(solid.build(), solidMat);
  solidMesh.castShadow = true;
  solidMesh.receiveShadow = true;
  const litMat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const litMesh = new Mesh(lit.build(), litMat);
  litMesh.renderOrder = 2;
  const signMat = new MeshLambertMaterial({ map: signs.texture, vertexColors: true });
  const signMesh = new Mesh(signB.build(), signMat);
  const shadowMat = new MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const shadowMesh = new Mesh(shadow.build(), shadowMat);
  shadowMesh.renderOrder = 1;
  root.add(groundMesh, shadowMesh, solidMesh, signMesh, litMesh, stageLights);

  let haloMat: PointsMaterial | null = null;
  if (halos && haloPts.length) {
    const g = new Geo();
    g.setAttribute("position", new Float32BufferAttribute(haloPts, 3));
    haloMat = new PointsMaterial({
      map: glowTexture(),
      color: 0xffd98a,
      size: 40,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const pts = new Points(g, haloMat);
    pts.renderOrder = 3;
    pts.frustumCulled = false;
    root.add(pts);
  }

  // Tap targets and label anchors.
  const proxies: Mesh[] = [];
  const labelAnchor = new Map<string, Vector3>();
  const proxyGeo = new BoxGeometry(1, 1, 1);
  for (const p of city.places) {
    const box = city.boxes.find((b) => b.locationId === p.locationId);
    const r = p.building ?? p.rect;
    const h = box ? buildingHeight(box) + 0.3 : 0.5;
    const mesh = new Mesh(proxyGeo);
    mesh.position.set(r.x + r.w / 2, h / 2, r.y + r.h / 2);
    mesh.scale.set(r.w, h, r.h);
    mesh.userData.locationId = p.locationId;
    mesh.updateMatrixWorld(true);
    proxies.push(mesh);
    labelAnchor.set(
      p.locationId,
      new Vector3(p.rect.x + p.rect.w / 2, h + 0.35, p.rect.y + p.rect.h / 2),
    );
  }

  return {
    root,
    solid: solidMesh,
    groundMaterial,
    proxies,
    labelAnchor,
    setLighting(night, wet, daylight, timeMs, zoomPx) {
      litMat.opacity = Math.min(1, night * 1.1);
      litMesh.visible = night > 0.02;
      shadowMat.opacity = 0.25 * daylight * (1 - wet * 0.6);
      // Wet roads: darker and shiny.
      groundMaterial.color.setScalar(1 - wet * 0.28);
      groundMaterial.specular.setScalar(wet * 0.45);
      groundMaterial.shininess = 8 + wet * 70;
      if (haloMat) {
        haloMat.opacity = night * 0.85;
        haloMat.size = Math.max(10, zoomPx * 1.4);
      }
      stageLights.visible = night > 0.2;
      stageLights.children.forEach((c, i) => {
        c.rotation.z = Math.sin(timeMs / 700 + i * 2.1) * 0.45;
        c.rotation.x = Math.cos(timeMs / 900 + i) * 0.25;
      });
    },
  };
}

function placeProps(
  p: PlaceView,
  solid: GeoBuilder,
  lit: GeoBuilder,
  signB: GeoBuilder,
  signs: SignAtlas,
  danfo: BufferGeometry,
  stageLights: Group,
  code: (x: number, y: number) => string,
): void {
  const m = m4();
  const r = p.rect;
  const yard = p.building
    ? {
        x: r.x,
        y: p.building.y + p.building.h,
        w: r.w,
        h: r.y + r.h - (p.building.y + p.building.h),
      }
    : r;
  // Spots beyond the first dozen are where people don't stand: props go there.
  const propSpots = p.spots.slice(12);
  switch (p.type) {
    case "buka": {
      // Canopy over the yard, benches and cooking pots on coal stands.
      const y0 = yard.y + 0.1;
      solid.box(
        yard.x + 0.1,
        0.62,
        y0,
        yard.x + yard.w - 0.1,
        0.66,
        yard.y + yard.h - 0.2,
        0xd62828,
      );
      for (const [px, pz] of [
        [yard.x + 0.15, yard.y + yard.h - 0.25],
        [yard.x + yard.w - 0.15, yard.y + yard.h - 0.25],
      ] as const)
        solid.box(px - 0.025, 0, pz - 0.025, px + 0.025, 0.62, pz + 0.025, C.pole);
      for (let i = 0; i < 3; i++) {
        const bx = yard.x + 0.6 + i * 1.4;
        solid.box(bx, 0.14, yard.y + 0.55, bx + 0.9, 0.18, yard.y + 0.75, C.wood);
        solid.box(bx + 0.05, 0, yard.y + 0.58, bx + 0.1, 0.14, yard.y + 0.72, C.wood);
        solid.box(bx + 0.8, 0, yard.y + 0.58, bx + 0.85, 0.14, yard.y + 0.72, C.wood);
      }
      for (let i = 0; i < 3; i++) {
        const cx = yard.x + yard.w - 0.5 - i * 0.42;
        const cz = yard.y + 0.25;
        solid.box(cx - 0.12, 0, cz - 0.12, cx + 0.12, 0.08, cz + 0.12, 0x444444);
        lit.floor(cx - 0.1, cz - 0.1, cx + 0.1, cz + 0.1, 0.085, 0xff7a2a);
        solid.add(unitCylinder(8), at(m, cx, 0.17, cz, 0.22, 0.16, 0.22), 0x2a2a2a);
      }
      break;
    }
    case "market": {
      const umb = [0xe63946, 0x3a86ff, 0xf6c90e, 0x2a9d8f, 0x8338ec, 0xf4a261];
      const produce = [0xe63946, 0xf77f00, 0x6a994e, 0xf6c90e, 0xffffff];
      propSpots.forEach(([x, y], i) => {
        if (i % 2) return;
        const cx = x + 0.5;
        const cz = y + 0.5;
        solid.box(cx - 0.28, 0, cz - 0.2, cx + 0.28, 0.24, cz + 0.2, C.wood);
        for (let k = 0; k < 5; k++)
          solid.add(
            unitSphere(),
            at(m, cx - 0.2 + k * 0.1, 0.28, cz + ((k % 2) - 0.5) * 0.12, 0.09, 0.08, 0.09),
            produce[(i + k) % produce.length]!,
          );
        solid.box(cx - 0.015, 0.24, cz - 0.015, cx + 0.015, 0.72, cz + 0.015, C.pole);
        solid.add(unitCone(), at(m, cx, 0.8, cz, 0.85, 0.2, 0.85, i * 0.4), umb[i % umb.length]!);
      });
      break;
    }
    case "transport_hub": {
      // Parked danfos and a shelter along the back.
      propSpots.forEach(([x, y], i) => {
        if (i % 3) return;
        const yaw = i % 2 ? 0 : Math.PI / 2;
        solid.addPainted(danfo, at(m, x + 0.5, 0, y + 0.5, 1, 1, 1, yaw));
      });
      const sy = r.y + 0.15;
      solid.box(r.x + 1, 0.7, sy, r.x + r.w - 1, 0.74, sy + 0.7, 0x2a6f97);
      for (let x = r.x + 1; x <= r.x + r.w - 1; x += 2)
        solid.box(x - 0.03, 0, sy + 0.05, x + 0.03, 0.7, sy + 0.11, C.pole);
      break;
    }
    case "music_venue": {
      // A stage against the building, speakers, a truss and coloured lights.
      const sx0 = yard.x + 0.6;
      const sx1 = yard.x + yard.w - 0.6;
      const sz0 = yard.y + 0.05;
      const sz1 = yard.y + 1.0;
      solid.box(sx0, 0, sz0, sx1, 0.14, sz1, 0x2d2d3a);
      solid.box(sx0 - 0.3, 0, sz0 + 0.1, sx0 - 0.02, 0.5, sz0 + 0.4, 0x111111);
      solid.box(sx1 + 0.02, 0, sz0 + 0.1, sx1 + 0.3, 0.5, sz0 + 0.4, 0x111111);
      for (const x of [sx0, sx1]) solid.box(x - 0.03, 0.14, sz1 - 0.06, x + 0.03, 1.2, sz1, C.pole);
      solid.box(sx0, 1.18, sz1 - 0.06, sx1, 1.24, sz1, C.pole);
      const cols = [0xff3d7f, 0x3d9bff, 0xffd23f, 0x7cff6b];
      for (let i = 0; i < 4; i++) {
        const x = sx0 + ((i + 0.5) * (sx1 - sx0)) / 4;
        lit.box(x - 0.05, 1.1, sz1 - 0.08, x + 0.05, 1.18, sz1 + 0.02, cols[i]!);
        const cone = new Mesh(
          new ConeGeometry(0.28, 1.05, 10, 1, true).translate(0, -0.52, 0),
          new MeshBasicMaterial({
            color: cols[i]!,
            transparent: true,
            opacity: 0.22,
            blending: AdditiveBlending,
            depthWrite: false,
          }),
        );
        cone.position.set(x, 1.12, sz1 - 0.04);
        stageLights.add(cone);
      }
      break;
    }
    case "school": {
      // Fence round the yard with a gate, pillars and an arch sign with the name, a flagpole.
      const fy = r.y + r.h - 0.05;
      for (let x = r.x; x < r.x + r.w; x++) {
        if (x === p.door[0]) continue;
        solid.box(x, 0, fy - 0.03, x + 1, 0.42, fy + 0.03, 0xe8e2d0);
      }
      for (const y of [r.y + 3, r.y + 4, r.y + 5]) {
        if (y >= r.y + r.h) break;
        solid.box(r.x, 0, y, r.x + 0.06, 0.42, y + 1, 0xe8e2d0);
        solid.box(r.x + r.w - 0.06, 0, y, r.x + r.w, 0.42, y + 1, 0xe8e2d0);
      }
      const gx = p.door[0];
      solid.box(gx - 0.12, 0, fy - 0.1, gx + 0.04, 1.0, fy + 0.1, 0xb33a3a);
      solid.box(gx + 0.96, 0, fy - 0.1, gx + 1.12, 1.0, fy + 0.1, 0xb33a3a);
      solid.box(gx - 0.12, 1.0, fy - 0.06, gx + 1.12, 1.26, fy + 0.06, 0x1d3557);
      const cell = signs.cell(p.name, 0x1d3557, 0xffd23f);
      signB.quad(
        [gx - 0.1, 1.02, fy + 0.065],
        [gx + 1.1, 1.02, fy + 0.065],
        [gx + 1.1, 1.24, fy + 0.065],
        [gx - 0.1, 1.24, fy + 0.065],
        0xffffff,
        cell.uv,
      );
      const fx = r.x + 1.2;
      const fz = r.y + r.h - 0.9;
      solid.box(fx - 0.02, 0, fz - 0.02, fx + 0.02, 1.5, fz + 0.02, C.pole);
      solid.box(fx + 0.02, 1.22, fz - 0.01, fx + 0.22, 1.36, fz + 0.01, 0x008751);
      solid.box(fx + 0.22, 1.22, fz - 0.01, fx + 0.42, 1.36, fz + 0.01, 0xffffff);
      solid.box(fx + 0.42, 1.22, fz - 0.01, fx + 0.62, 1.36, fz + 0.01, 0x008751);
      break;
    }
    case "home": {
      // A low compound wall with a gap for the gate, a clothesline and a plastic chair.
      const wallC = 0xd9cdb5;
      const t = 0.06;
      const H = 0.4;
      for (let x = r.x; x < r.x + r.w; x++) {
        for (const [z, edge] of [
          [r.y, r.y],
          [r.y + r.h - t, r.y + r.h - 1],
        ] as const) {
          if (x === p.door[0] && edge === p.door[1]) continue;
          if (code(x, edge) === "#") continue;
          solid.box(x, 0, z, x + 1, H, z + t, wallC);
        }
      }
      for (let y = r.y; y < r.y + r.h; y++) {
        for (const [x, edge] of [
          [r.x, r.x],
          [r.x + r.w - t, r.x + r.w - 1],
        ] as const) {
          if (edge === p.door[0] && y === p.door[1]) continue;
          if (code(edge, y) === "#") continue;
          solid.box(x, 0, y, x + t, H, y + 1, wallC);
        }
      }
      const yz = yard.y + yard.h * 0.4;
      const lx0 = yard.x + 0.6;
      const lx1 = yard.x + yard.w - 0.6;
      solid.box(lx0 - 0.02, 0, yz - 0.02, lx0 + 0.02, 0.7, yz + 0.02, C.pole);
      solid.box(lx1 - 0.02, 0, yz - 0.02, lx1 + 0.02, 0.7, yz + 0.02, C.pole);
      solid.box(lx0, 0.69, yz - 0.004, lx1, 0.7, yz + 0.004, 0x222222);
      const cloth = [0xe63946, 0x2a9d8f, 0xffffff, 0xf6c90e, 0x3a86ff];
      for (let i = 0; i < 4; i++) {
        const cx = lx0 + 0.3 + i * ((lx1 - lx0 - 0.6) / 3);
        solid.box(
          cx - 0.1,
          0.46,
          yz - 0.005,
          cx + 0.1,
          0.69,
          yz + 0.005,
          cloth[(i + r.x) % cloth.length]!,
        );
      }
      const chx = yard.x + yard.w - 0.7;
      const chz = yard.y + yard.h - 0.5;
      solid.box(chx - 0.1, 0.12, chz - 0.1, chx + 0.1, 0.15, chz + 0.1, 0xf2f2f2);
      solid.box(chx - 0.1, 0.15, chz - 0.1, chx + 0.1, 0.36, chz - 0.08, 0xf2f2f2);
      break;
    }
    default:
      break;
  }
  void unitBox;
}
