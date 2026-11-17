import type { Scene } from "three";
import {
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  LineSegments,
  ShaderMaterial,
  Vector3,
} from "three";
import type { WeatherKind } from "@liag/engine";
import type { Lighting, Sun } from "../render/lighting";
import { mix } from "../render/color";

/**
 * Sun, sky light, fog and rain. The sun moves with the time of day (see `sunAt`); harmattan is
 * a dusty fog, rain a field of streaks around the camera animated entirely on the GPU (one draw
 * call, no per-frame CPU work).
 */
export class Sky3D {
  readonly sun = new DirectionalLight(0xffffff, 2.2);
  readonly hemi = new HemisphereLight(0xcfe3ff, 0x6b5a46, 1.2);
  private readonly rain: LineSegments;
  private readonly rainMat: ShaderMaterial;
  private readonly fog = new Fog(0xd9c6a0, 30, 90);
  private readonly tmp = new Color();
  private readonly dir = new Vector3();

  constructor(
    private readonly scene: Scene,
    drops: number,
    shadows: boolean,
  ) {
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(1024, 1024);
      const c = this.sun.shadow.camera;
      c.left = -14;
      c.right = 14;
      c.top = 14;
      c.bottom = -14;
      c.near = 1;
      c.far = 80;
      this.sun.shadow.bias = -0.0008;
    }
    scene.add(this.sun, this.sun.target, this.hemi);

    const pos: number[] = [];
    const seed: number[] = [];
    let s = 12345;
    const r = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < drops; i++) {
      const x = r();
      const z = r();
      const ph = r();
      const sp = 0.8 + r() * 0.5;
      for (const end of [0, 1]) {
        pos.push(0, 0, 0);
        seed.push(x, z, ph, sp + end * 10);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("seed", new Float32BufferAttribute(seed, 4));
    this.rainMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCentre: { value: new Vector3() },
        uSize: { value: 26 },
        uHeight: { value: 7 },
        uAlpha: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime;
        uniform vec3 uCentre;
        uniform float uSize;
        uniform float uHeight;
        varying float vEnd;
        void main() {
          float isTop = step(5.0, seed.w);
          float speed = seed.w - isTop * 10.0;
          float y = mod(seed.z * uHeight - uTime * 9.0 * speed, uHeight);
          vec3 p = vec3(
            uCentre.x + (seed.x - 0.5) * uSize,
            y + isTop * 0.35,
            uCentre.z + (seed.y - 0.5) * uSize
          );
          // Slanted by the wind.
          p.x -= isTop * 0.08;
          vEnd = isTop;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        varying float vEnd;
        void main() {
          gl_FragColor = vec4(0.82, 0.88, 0.95, uAlpha * (0.25 + 0.75 * vEnd));
        }
      `,
    });
    this.rain = new LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 5;
    this.rain.visible = false;
    scene.add(this.rain);
  }

  /** `centre`: what the camera looks at; `camDist`: how far the camera is from it (for fog). */
  update(
    L: Lighting,
    sun: Sun,
    weather: WeatherKind,
    timeS: number,
    centre: Vector3,
    camDist: number,
  ): void {
    const dayK = 1 - L.night;
    this.scene.background = this.tmp.setHex(L.sky).clone();
    // Sun (or moon) and the sky's soft light.
    this.dir.set(sun.dir[0], sun.dir[1], sun.dir[2]);
    this.sun.position.copy(centre).addScaledVector(this.dir, 40);
    this.sun.target.position.copy(centre);
    this.sun.target.updateMatrixWorld();
    this.sun.color.setHex(sun.color);
    this.sun.intensity = 0.25 + sun.strength * 2.4;
    this.hemi.color.setHex(mix(L.tint, 0xffffff, 0.3));
    this.hemi.groundColor.setHex(mix(0x5d4a38, 0x1a1d2e, L.night));
    this.hemi.intensity = 0.55 + dayK * 0.9;
    // Rain.
    const rain = weather === "rain" || weather === "heavy_rain";
    this.rain.visible = rain;
    this.rainMat.uniforms.uTime!.value = timeS;
    (this.rainMat.uniforms.uCentre!.value as Vector3).copy(centre);
    this.rainMat.uniforms.uAlpha!.value = weather === "heavy_rain" ? 0.7 : 0.45;
    this.rainMat.uniforms.uSize!.value = Math.min(40, Math.max(8, camDist * 0.45));
    // Fog: thick dusty haze in harmattan, grey murk in heavy rain, light depth haze otherwise.
    const fogColor = weather === "harmattan" ? mix(0xd9c6a0, 0x2a2a3a, L.night) : L.sky;
    this.fog.color.setHex(fogColor);
    const [near, far] =
      weather === "harmattan"
        ? [0.3, 1.5]
        : weather === "heavy_rain"
          ? [0.6, 2.2]
          : weather === "rain"
            ? [0.8, 3]
            : [1.1, 4.5];
    this.fog.near = camDist * near;
    this.fog.far = camDist * far + 10;
    this.scene.fog = this.fog;
  }
}
