import { Container, Graphics } from "pixi.js";
import type { World } from "@liag/engine";
import { charDef } from "@liag/engine";
import type { CityModel } from "./city-model";
import type { CityView } from "./city-view";
import { entityZ, iso } from "./iso";
import type { Look } from "./look";
import { fallbackLook, resolveLook } from "./look";
import type { PersonView } from "./people-model";
import { personView } from "./people-model";
import { personFrames, umbrellaContext } from "./art/person";

interface Sprite {
  id: string;
  root: Container;
  body: Graphics;
  umbrella: Graphics | null;
  ring: Graphics | null;
  marker: Graphics | null;
  look: Look;
  view: PersonView | null;
  walkT: number;
}

/** Every engine character on the map, placed each frame from the engine state. */
export class PeopleView {
  private readonly sprites = new Map<string, Sprite>();

  constructor(
    private readonly world: () => World,
    private readonly city: CityModel,
    private readonly view: CityView,
  ) {}

  /** Rebuild sprites (after a new game or a load). */
  reset(): void {
    for (const s of this.sprites.values()) {
      this.view.removeEntity(s.root);
      s.root.destroy({ children: true });
    }
    this.sprites.clear();
    const w = this.world();
    for (const id of Object.keys(w.characters).sort()) {
      const c = w.characters[id]!;
      if (!this.city.places.some((p) => p.locationId === c.homeId)) continue; // other regions
      const def = charDef(w, id);
      const look = resolveLook(def.look ?? fallbackLook(id), c.items.includes("umbrella"));
      const root = new Container();
      let ring: Graphics | null = null;
      let marker: Graphics | null = null;
      if (c.controlledBy) {
        ring = new Graphics();
        ring.ellipse(0, 0, 13, 6.5).stroke({ width: 2.5, color: 0xffe066 });
        ring.ellipse(0, 0, 13, 6.5).fill({ color: 0xffe066, alpha: 0.18 });
        root.addChild(ring);
      }
      const body = new Graphics(personFrames(look).front[0]!);
      root.addChild(body);
      let umbrella: Graphics | null = null;
      if (look.umbrella) {
        umbrella = new Graphics(umbrellaContext(look.accent === 0xffffff ? 0x1d3557 : look.accent));
        umbrella.visible = false;
        root.addChild(umbrella);
      }
      if (c.controlledBy) {
        marker = new Graphics();
        marker
          .poly([-6, -54, 6, -54, 0, -46])
          .fill(0xffe066)
          .stroke({ width: 1.5, color: 0x5a4500 });
        root.addChild(marker);
      }
      this.view.addEntity(root);
      this.sprites.set(id, { id, root, body, umbrella, ring, marker, look, view: null, walkT: 0 });
    }
  }

  /** Place everyone for the time on screen. `dt` is real seconds times game speed. */
  update(shownTick: number, dt: number, raining: boolean, timeMs: number): void {
    const w = this.world();
    for (const s of this.sprites.values()) {
      const v = personView(w, this.city, s.id, shownTick, s.view ?? undefined);
      s.view = v;
      // The player stays marked while asleep indoors, so you can always find Tobi.
      const sleepingPlayer = !v.visible && v.hiddenBecause === "asleep" && !!s.marker;
      s.root.visible = v.visible || sleepingPlayer;
      s.body.visible = v.visible;
      if (s.ring) s.ring.visible = v.visible;
      if (!s.root.visible) continue;
      const p = iso(v.x + 0.5, v.y + 0.5);
      s.root.position.set(p.x, p.y);
      s.root.zIndex = entityZ(v.x, v.y);
      const frames = personFrames(s.look);
      const front = v.facing === "se" || v.facing === "sw";
      if (v.moving) s.walkT += dt * 8;
      const frame = v.moving ? 1 + (Math.floor(s.walkT) % 4) : 0;
      s.body.context = (front ? frames.front : frames.back)[frame]!;
      s.body.scale.x = v.facing === "sw" || v.facing === "nw" ? -1 : 1;
      if (s.umbrella) s.umbrella.visible = raining;
      if (s.marker) s.marker.y = Math.sin(timeMs / 260) * 3 + (sleepingPlayer ? -30 : 0);
    }
  }

  /** Current view of a character (position on the map), if drawn. */
  viewOf(id: string): PersonView | null {
    return this.sprites.get(id)?.view ?? null;
  }

  /** Characters whose drawn figure is under a world-pixel point, nearest first. */
  hit(px: number, py: number): string[] {
    const out: { id: string; d: number }[] = [];
    for (const s of this.sprites.values()) {
      if (!s.root.visible || !s.body.visible) continue;
      const dx = px - s.root.x;
      const dy = py - s.root.y;
      if (Math.abs(dx) <= 14 && dy <= 6 && dy >= -50)
        out.push({ id: s.id, d: Math.hypot(dx, dy + 20) });
    }
    return out.sort((a, b) => a.d - b.d).map((o) => o.id);
  }

  /** World-pixel position of a character's head (for bubbles), if visible. */
  headOf(id: string): { x: number; y: number } | null {
    const s = this.sprites.get(id);
    if (!s || !s.root.visible) return null;
    return { x: s.root.x, y: s.root.y - 46 };
  }
}
