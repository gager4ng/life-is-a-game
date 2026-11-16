import { Application, Graphics } from "pixi.js";
import type { LedgerEvent, PendingChoice, Tile, World } from "@liag/engine";
import {
  TICKS_PER_DAY,
  calendar,
  charDef,
  currentWeather,
  dayIndex,
  dayNumber,
  formatClock,
  getLocation,
  getQuestDef,
  isWalkable,
  minuteOfDay,
  placeTile,
  questTarget,
  regionMap,
  stepTick,
} from "@liag/engine";
import { Journal, collectGist } from "@liag/narrative";
import { Ambient } from "../render/ambient";
import { Camera, attachGestures } from "../render/camera";
import type { CityModel } from "../render/city-model";
import { boxHeight, buildCity, placeAt } from "../render/city-model";
import { CityView } from "../render/city-view";
import { PALETTE } from "../render/color";
import type { Expression } from "../render/encounter-scene";
import { EncounterScene } from "../render/encounter-scene";
import { TH, TW, iso, screenToTile } from "../render/iso";
import { fallbackLook, resolveLook } from "../render/look";
import { PeopleView } from "../render/people-view";
import { WeatherView, lightingFor, nightFactor } from "../render/weather-view";
import type { Speed } from "./clock";
import { Clock } from "./clock";
import { feelingKey, resultLines } from "./results";
import { PLAYER_ID, type Session } from "./session";
import { el } from "../ui/dom";
import { EncounterUi } from "../ui/encounter-ui";
import { Hud } from "../ui/hud";
import { GistPanel, PersonCard } from "../ui/panels";
import { dialogue, money, t } from "../ui/text";

interface Bubble {
  charId: string;
  text: string;
  start: number;
  end: number;
  node: HTMLElement | null;
}

const REGION = "lagos";

/** The playable prototype: city, people, clock, HUD and encounters wired to one Session. */
export class Game {
  private readonly app = new Application();
  private readonly clock = new Clock();
  private readonly camera = new Camera();
  private readonly hud: Hud;
  private readonly gist: GistPanel;
  private readonly card = new PersonCard();
  private readonly encUi = new EncounterUi();
  private readonly overlay = el("div", { class: "overlay" });
  private readonly placeLabels = new Map<string, HTMLElement>();
  private readonly city: CityModel;
  private cityView!: CityView;
  private people!: PeopleView;
  private ambient!: Ambient;
  private weather!: WeatherView;
  private readonly scene = new EncounterScene();
  private readonly questMarker = new Graphics();
  private readonly destMarker = new Graphics();
  private destUntil = 0;
  private journal: Journal;
  private inEncounter = false;
  private bubbles: Bubble[] = [];
  private nowMs = 0;
  private hudAt = 0;

  constructor(
    private readonly mount: HTMLElement,
    private session: Session,
  ) {
    const map = regionMap(session.world.content, REGION);
    if (!map) throw new Error("No map for Lagos");
    this.city = buildCity(map, session.world.content.locations);
    this.journal = this.makeJournal();
    this.hud = new Hud({
      setSpeed: (s) => this.setSpeed(s),
      zoom: (f) => this.camera.zoomAt(f, this.camera.screenW / 2, this.camera.screenH / 2),
      centre: () => this.centreOnPlayer(),
      openGist: () => this.openGist(),
    });
    this.gist = new GistPanel(() => this.gist.hide());
  }

  private get world(): World {
    return this.session.world;
  }

  private get me(): string {
    return this.session.playerCharId;
  }

  private makeJournal(): Journal {
    return new Journal(this.session.world, dialogue, {
      playerCharId: this.session.playerCharId,
      verbose: false,
      currency: "₦",
    });
  }

  async start(): Promise<void> {
    const stage = el("div", { class: "stage" });
    this.mount.append(
      stage,
      this.overlay,
      this.hud.root,
      this.gist.root,
      this.card.root,
      this.encUi.root,
    );
    const dpr = window.devicePixelRatio || 1;
    await this.app.init({
      resizeTo: stage,
      background: PALETTE.skyDay,
      antialias: dpr < 2,
      resolution: Math.min(dpr, 2),
      autoDensity: true,
      powerPreference: "high-performance",
    });
    stage.append(this.app.canvas);

    this.cityView = new CityView(this.city);
    this.people = new PeopleView(() => this.world, this.city, this.cityView);
    this.people.reset();
    this.ambient = new Ambient(regionMap(this.world.content, REGION)!, this.city, this.cityView);
    this.weather = new WeatherView((g) => this.app.renderer.generateTexture(g));
    this.drawMarkers();
    this.app.stage.addChild(this.cityView.root, this.scene.root, this.weather.root);

    for (const p of this.city.places) {
      const label = el("div", { class: "place-label" }, p.name);
      this.overlay.append(label);
      this.placeLabels.set(p.locationId, label);
    }

    const { width: W, height: H } = this.city;
    this.camera.bounds = {
      minX: (-H * TW) / 2,
      maxX: (W * TW) / 2,
      minY: 0,
      maxY: ((W + H) * TH) / 2,
    };
    this.camera.zoom = Math.min(1.1, Math.max(0.6, stage.clientWidth / 520));
    this.onResize();
    this.centreOnPlayer(false);
    window.addEventListener("resize", () => this.onResize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.session.save();
    });
    attachGestures(this.app.canvas, this.camera, {
      onTap: (x, y) => this.onTap(x, y),
      onDoubleTap: () => this.centreOnPlayer(),
    });
    this.session.onEvents((evs) => this.onEvents(evs));
    this.app.ticker.add((tk) => this.frame(tk.deltaMS));
    this.exposeDebug();
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  /** Average milliseconds of our own per-frame work (for the perf check). */
  private frameCost = 0;

  private frame(dtMs: number): void {
    const t0 = performance.now();
    this.frameInner(dtMs);
    this.frameCost = this.frameCost * 0.95 + (performance.now() - t0) * 0.05;
  }

  private frameInner(dtMs: number): void {
    this.nowMs += dtMs;
    const w = this.world;
    if (!this.inEncounter) {
      const pending = this.session.pending();
      if (pending) this.startEncounter(pending);
      else if (this.clock.advance(dtMs) && this.session.step()) {
        const p = this.session.pending();
        if (p) this.startEncounter(p);
      }
    }
    const lastTick = Math.max(0, w.tick - 1);
    const shown = w.tick === 0 ? 0 : lastTick + this.clock.frac;
    const minute = minuteOfDay(lastTick) + (w.tick === 0 ? 0 : this.clock.frac * 10);
    const wx = currentWeather(w, REGION);
    const L = lightingFor(minute, wx);
    const rain = wx === "rain" || wx === "heavy_rain";
    const gameDt = this.clock.held || this.clock.speed === 0 ? 0 : (dtMs / 1000) * this.clock.speed;

    this.app.renderer.background.color = L.sky;
    this.weather.set(wx, L.night);
    this.weather.update(dtMs / 1000);
    if (!this.inEncounter) {
      this.cityView.setLighting(L.tint, L.night, this.nowMs);
      this.ambient.setMood(nightFactor(minute), rain, wx === "heavy_rain");
      this.ambient.update(gameDt);
      this.people.update(shown, gameDt, rain, this.nowMs);
      this.camera.update(dtMs / 1000);
      this.camera.apply(this.cityView.root);
      this.updateMarkers();
      this.updateOverlay();
    } else {
      const heads = this.scene.heads();
      this.encUi.placeBubbles(heads.left, heads.right);
    }
    if (this.nowMs - this.hudAt > 150) {
      this.hudAt = this.nowMs;
      this.updateHud(minute, wx, L.night > 0.5);
    }
  }

  private updateHud(minute: number, wx: ReturnType<typeof currentWeather>, night: boolean): void {
    const w = this.world;
    const c = w.characters[this.me]!;
    const tick = Math.max(0, w.tick - 1);
    const cal = calendar(w.startDate, dayIndex(tick));
    this.hud.update({
      dayLabel: `${t("day", { n: dayNumber(tick) })} · ${cal.weekdayName.slice(0, 3)}`,
      clock: formatClock(Math.floor(minute) % 1440),
      weather: wx,
      night,
      money: c.needs.money,
      mood: c.needs.mood,
      energy: c.needs.energy,
      quest: this.currentQuestText(),
      speed: this.clock.speed,
    });
  }

  private activeQuest(): World["quests"][number] | null {
    const order = { main: 0, side: 1, emergent: 2 } as const;
    const qs = this.world.quests
      .filter((q) => q.characterId === this.me && q.status === "active")
      .sort(
        (a, b) =>
          order[getQuestDef(this.world, a.questId).kind] -
          order[getQuestDef(this.world, b.questId).kind],
      );
    return qs[0] ?? null;
  }

  private currentQuestText(): string | null {
    const q = this.activeQuest();
    if (!q) return null;
    const def = getQuestDef(this.world, q.questId);
    return def.steps.find((s) => s.id === q.stepId)?.objective ?? def.title;
  }

  setSpeed(s: Speed): void {
    this.clock.speed = s;
  }

  private onResize(): void {
    const r = this.app.canvas.getBoundingClientRect();
    this.camera.screenW = r.width || window.innerWidth;
    this.camera.screenH = r.height || window.innerHeight;
    this.weather.resize(this.camera.screenW, this.camera.screenH);
  }

  private playerWorldPos(): { x: number; y: number } {
    const v = this.people.viewOf(this.me);
    if (v && v.visible) return iso(v.x + 0.5, v.y + 0.5);
    const c = this.world.characters[this.me]!;
    const map = regionMap(this.world.content, REGION)!;
    const t0 = placeTile(map, c.locationId) ?? [20, 17];
    return iso(t0[0] + 0.5, t0[1] + 0.5);
  }

  private centreOnPlayer(smooth = true): void {
    const p = this.playerWorldPos();
    this.camera.centreOn(p.x, p.y - 20, smooth);
    if (!smooth) this.camera.apply(this.cityView.root);
  }

  // ---------------------------------------------------------------------------
  // Markers, labels, bubbles
  // ---------------------------------------------------------------------------

  private drawMarkers(): void {
    const q = this.questMarker;
    q.poly([0, -14, 11, 0, 0, 14, -11, 0]).fill(0xffd23f).stroke({ width: 2, color: 0x6b4f00 });
    q.rect(-1.8, -8, 3.6, 9).fill(0x3d2c00);
    q.circle(0, 5, 2).fill(0x3d2c00);
    q.zIndex = 2_000_000;
    q.visible = false;
    const d = this.destMarker;
    d.ellipse(0, 0, 10, 5).stroke({ width: 2, color: 0xffffff });
    d.rect(-1, -26, 2, 26).fill(0xffffff);
    d.poly([1, -26, 14, -21, 1, -16]).fill(0xff5d5d);
    d.zIndex = 1_999_999;
    d.visible = false;
    this.cityView.root.addChild(q, d);
  }

  private updateMarkers(): void {
    const q = this.activeQuest();
    const target = q ? questTarget(this.world, q) : null;
    const map = regionMap(this.world.content, REGION)!;
    const tile = target ? placeTile(map, target.locationId) : null;
    this.questMarker.visible = !!tile;
    if (tile) {
      const p = iso(tile[0] + 0.5, tile[1] + 0.5);
      this.questMarker.position.set(p.x, p.y - 74 + Math.sin(this.nowMs / 300) * 5);
    }
    if (this.destMarker.visible && this.nowMs > this.destUntil) this.destMarker.visible = false;
  }

  private setDestination(tile: Tile): void {
    const p = iso(tile[0] + 0.5, tile[1] + 0.5);
    this.destMarker.position.set(p.x, p.y);
    this.destMarker.visible = true;
    this.destUntil = this.nowMs + 60_000;
  }

  private updateOverlay(): void {
    const showLabels = this.camera.zoom >= 0.5;
    for (const p of this.city.places) {
      const label = this.placeLabels.get(p.locationId)!;
      const box = this.city.boxes.find((b) => b.locationId === p.locationId);
      const lift = box ? boxHeight(box) + 18 : 30;
      const c = iso(p.rect.x + p.rect.w / 2, p.rect.y + p.rect.h / 2);
      const s = this.camera.worldToScreen(c.x, c.y - lift);
      label.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -100%)`;
      label.hidden = !showLabels;
    }
    const now = this.nowMs;
    this.bubbles = this.bubbles.filter((b) => {
      if (now > b.end) {
        b.node?.remove();
        return false;
      }
      if (now < b.start) return true;
      const head = this.people.headOf(b.charId);
      if (!head) {
        if (b.node) b.node.hidden = true;
        return true;
      }
      if (!b.node) {
        b.node = el("div", { class: "mini-bubble" }, b.text);
        this.overlay.append(b.node);
      }
      b.node.hidden = false;
      const s = this.camera.worldToScreen(head.x, head.y);
      b.node.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -100%)`;
      return true;
    });
  }

  private onEvents(events: LedgerEvent[]): void {
    const me = this.me;
    const mine = this.people.viewOf(me);
    for (const ev of events) {
      if (ev.type === "arrived" && ev.actors[0] === me) this.destMarker.visible = false;
      if (ev.type !== "encounter_resolved" || ev.actors.includes(me) || !mine) continue;
      // Other people's encounters near you show as little speech bubbles.
      const near = ev.actors.every((id) => {
        const v = this.people.viewOf(id);
        return v && v.visible && Math.abs(v.x - mine.x) + Math.abs(v.y - mine.y) < 18;
      });
      if (!near) continue;
      const parts = this.journal.encounterParts(ev);
      let at = this.nowMs;
      for (const l of parts.lines.slice(0, 2)) {
        const text = l.text.length > 60 ? `${l.text.slice(0, 57)}…` : l.text;
        this.bubbles.push({ charId: l.speakerId, text, start: at, end: at + 2600, node: null });
        at += 2200;
      }
    }
    if (this.gist.open) this.openGist();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private onTap(sx: number, sy: number): void {
    if (this.inEncounter) return;
    const w = this.camera.screenToWorld(sx, sy);
    const hits = this.people.hit(w.x, w.y);
    if (hits.length) return this.showPerson(hits[0]!);
    this.card.hide();

    // Buildings first (tapping a wall or a roof), then the ground.
    for (const box of this.city.boxes) {
      if (!box.locationId) continue;
      const H = boxHeight(box);
      const a = iso(box.x, box.y);
      const b = iso(box.x + box.w, box.y);
      const c = iso(box.x + box.w, box.y + box.h);
      const d = iso(box.x, box.y + box.h);
      const poly = [
        [a.x, a.y - H],
        [b.x, b.y - H],
        [b.x, b.y],
        [c.x, c.y],
        [d.x, d.y],
        [d.x, d.y - H],
      ] as [number, number][];
      if (inPolygon(w.x, w.y, poly)) return this.goToPlace(box.locationId);
    }
    const g = screenToTile(w.x, w.y);
    const tx = Math.floor(g.x);
    const ty = Math.floor(g.y);
    const place = placeAt(this.city, tx, ty);
    if (place) return this.goToPlace(place.locationId);
    const map = regionMap(this.world.content, REGION)!;
    const target = nearestWalkable(map, tx, ty);
    if (!target) return;
    this.session.goTo(target);
    this.setDestination(target);
    this.hud.toast(t("walkingThere"));
  }

  private goToPlace(locationId: string): void {
    const name = getLocation(this.world, locationId).name;
    const why = this.session.canGo(locationId);
    if (why === "unknown") return this.hud.toast(t("dontKnowWay", { place: name }));
    if (why === "closed") return this.hud.toast(t("closedNow", { place: name }));
    if (why === "here") return this.hud.toast(t("atPlace", { place: name }));
    this.session.goTo(locationId);
    const map = regionMap(this.world.content, REGION)!;
    const tile = placeTile(map, locationId);
    if (tile) this.setDestination(tile);
    this.hud.toast(t("headingTo", { place: name }));
  }

  private showPerson(id: string): void {
    const w = this.world;
    const c = w.characters[id]!;
    const def = charDef(w, id);
    const status = c.travel
      ? this.people.viewOf(id)?.visible
        ? t("onTheWay")
        : t("riding")
      : c.street
        ? t("onStreet")
        : t("atPlace", { place: getLocation(w, c.locationId).name });
    const isMe = id === this.me;
    this.card.show({
      name: isMe ? `${def.name} (${t("you")})` : def.name,
      role: def.job ? `${def.role} · ${def.job.title}` : def.role,
      status,
      feeling: isMe ? null : t(feelingKey(w.relationships[`${id}>${this.me}`])),
      stats: isMe
        ? `${t("money")} ${money(c.needs.money)} · ${t("mood")} ${Math.round(c.needs.mood)} · ${t("energy")} ${Math.round(c.needs.energy)}`
        : null,
    });
  }

  private openGist(): void {
    const recent = this.world.ledger.slice(-4000);
    this.gist.show(
      collectGist(this.journal, recent, 80),
      (tick) => `${t("day", { n: dayNumber(tick) })} · ${formatClock(minuteOfDay(tick))}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Encounters with the player
  // ---------------------------------------------------------------------------

  private startEncounter(p: PendingChoice): void {
    this.inEncounter = true;
    this.clock.held = true;
    this.card.hide();
    this.gist.hide();
    for (const b of this.bubbles) b.node?.remove();
    this.bubbles = [];
    const w = this.world;
    const other = w.characters[p.otherId]!;
    const otherDef = charDef(w, other.id);
    const meDef = charDef(w, this.me);
    const loc = getLocation(w, p.locationId);
    const enc = w.encounters.find((e) => e.id === p.encounterId);
    const vars = {
      other: `${other.name} (${otherDef.role})`,
      amount: p.amount ? money(p.amount) : null,
      target: enc?.targetLocation ? getLocation(w, enc.targetLocation).name : null,
    };
    const key =
      p.kind === "passing"
        ? "prompt.chat"
        : p.role === "giver" && p.kind === "opportunity"
          ? "prompt.giver"
          : `prompt.${p.subtype}.${p.role}`;
    const caption = dialogue.line(key, vars, p.encounterId);
    const options = p.options.map((o) => ({
      id: o.id,
      label: dialogue.option(o.labelKey, vars, p.encounterId),
    }));
    const lastTick = Math.max(0, w.tick - 1);
    const minute = minuteOfDay(lastTick);
    const L = lightingFor(minute, currentWeather(w, REGION));
    const rel = w.relationships[`${other.id}>${this.me}`];
    const rightExpr: Expression =
      p.kind === "opportunity"
        ? "neutral"
        : p.kind === "passing" && (rel?.familiarity ?? 0) > 20
          ? "happy"
          : p.role === "giver"
            ? "neutral"
            : "surprised";
    this.cityView.root.visible = false;
    this.hud.root.hidden = true;
    this.overlay.hidden = true;
    this.scene.show({
      w: this.camera.screenW,
      h: this.camera.screenH,
      placeType: loc.type,
      placeName: loc.name,
      sky: L.sky,
      night: L.night,
      left: resolveLook(meDef.look ?? fallbackLook(this.me), false),
      right: resolveLook(otherDef.look ?? fallbackLook(other.id), false),
      leftExpr: "neutral",
      rightExpr,
    });
    this.encUi.open(
      caption,
      `${w.characters[this.me]!.name} (${t("you")})`,
      t("encounterWith", { name: other.name, role: otherDef.role }),
      options,
      (optionId) => {
        void this.finishEncounter(p, optionId);
      },
    );
  }

  private async finishEncounter(p: PendingChoice, optionId: string): Promise<void> {
    const events = this.session.reply(p.encounterId, optionId);
    const resolved = events.find((e) => e.type === "encounter_resolved");
    if (resolved) {
      const [l, r] = outcomeFaces(resolved, this.me);
      this.scene.setExpressions(l, r);
      const parts = this.journal.encounterParts(resolved);
      await this.encUi.play(
        parts.lines.map((x) => ({
          side: x.speakerId === this.me ? "left" : "right",
          text: x.text,
        })),
      );
    }
    const items = resultLines(this.world, events, this.me, t, money);
    for (const ev of events) {
      if (!ev.type.startsWith("quest_") || !ev.actors.includes(this.me)) continue;
      const g = this.journal.gist(ev);
      if (g) items.push(g.headline);
    }
    this.encUi.showResult(items, () => this.endEncounter());
  }

  private endEncounter(): void {
    this.encUi.close();
    this.scene.hide();
    this.cityView.root.visible = true;
    this.hud.root.hidden = false;
    this.overlay.hidden = false;
    this.inEncounter = false;
    this.clock.held = false;
    this.clock.reset();
  }

  // ---------------------------------------------------------------------------
  // Test hooks (used by the Playwright smoke test and screenshots)
  // ---------------------------------------------------------------------------

  private exposeDebug(): void {
    const api = {
      state: () => {
        const c = this.world.characters[this.me]!;
        return {
          tick: this.world.tick,
          minute: minuteOfDay(Math.max(0, this.world.tick - 1)),
          locationId: c.locationId,
          travelling: !!c.travel,
          travelTo: c.travel ? c.travel.to : null,
          street: c.street,
          override: c.override
            ? { locationId: c.override.locationId, tile: c.override.tile ?? null }
            : null,
          inEncounter: this.inEncounter,
          weather: currentWeather(this.world, REGION),
          speed: this.clock.speed,
          fps: Math.round(this.app.ticker.FPS),
          frameMs: Math.round(this.frameCost * 100) / 100,
        };
      },
      /** Screen position of a tile's centre (CSS px), for tapping in tests. */
      tileToScreen: (tx: number, ty: number) => {
        const p = iso(tx + 0.5, ty + 0.5);
        return this.camera.worldToScreen(p.x, p.y);
      },
      playerScreen: () => {
        const p = this.playerWorldPos();
        return this.camera.worldToScreen(p.x, p.y - 20);
      },
      centreOnTile: (tx: number, ty: number, zoom?: number) => {
        if (zoom) this.camera.zoom = zoom;
        const p = iso(tx + 0.5, ty + 0.5);
        this.camera.centreOn(p.x, p.y, false);
      },
      centrePlayer: (zoom?: number) => {
        if (zoom) this.camera.zoom = zoom;
        this.centreOnPlayer(false);
      },
      setSpeed: (s: Speed) => this.setSpeed(s),
      /** Run the world until the player has an encounter to answer (or maxTicks pass). */
      runUntilEncounter: (maxTicks = 300) => {
        for (let i = 0; i < maxTicks && !this.session.pending(); i++) this.session.step();
        this.clock.reset();
        return !!this.session.pending();
      },
      /** Jump ahead to a tick with the player on autopilot (replies chosen by the rules). */
      runTo: (tick: number) => {
        const pl = this.world.players[PLAYER_ID]!;
        pl.autopilot = true;
        while (this.world.tick < tick) stepTick(this.world);
        pl.autopilot = false;
        this.clock.reset();
        this.session.save();
      },
      ticksPerDay: TICKS_PER_DAY,
    };
    (window as unknown as { __liag: typeof api }).__liag = api;
  }
}

function inPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearestWalkable(
  map: NonNullable<ReturnType<typeof regionMap>>,
  tx: number,
  ty: number,
): Tile | null {
  for (let r = 0; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const t0: Tile = [tx + dx, ty + dy];
        if (isWalkable(map, t0)) return t0;
      }
    }
  }
  return null;
}

/** Faces after the outcome: both pleased if it went well, else the one turned down is annoyed. */
export function outcomeFaces(ev: LedgerEvent, me: string): [Expression, Expression] {
  const d = ev.data;
  const outcome = String(d.outcome);
  const asker = String(d.asker);
  const meIsAsker = asker === me;
  if (outcome === "helped" || outcome === "given" || outcome === "chatted")
    return ["happy", "happy"];
  let decliner: "asker" | "giver";
  if (outcome === "refused") decliner = "giver";
  else if (outcome === "withdrawn") decliner = "asker";
  else decliner = String(d.askerTone) === "walk_away" ? "asker" : "giver";
  const meDeclined = (decliner === "asker") === meIsAsker;
  if (outcome === "withdrawn")
    return meDeclined ? ["neutral", "surprised"] : ["surprised", "neutral"];
  return meDeclined ? ["neutral", "annoyed"] : ["annoyed", "neutral"];
}
