import { Application, Graphics } from "pixi.js";
import type { Endpoint, LedgerEvent, PendingChoice, RegionMap, Tile, World } from "@liag/engine";
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
  isOpen,
  isWalkable,
  journey,
  minuteOfDay,
  placeTile,
  regionMap,
  sceneFlag,
  stepTick,
} from "@liag/engine";
import { Journal, collectGist } from "@liag/narrative";
import type { Layer, SourcePos } from "../audio/mix";
import { ambientMix, panFor } from "../audio/mix";
import { SoundEngine } from "../audio/sound";
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
import type { Suggestion } from "./guide";
import { activeQuests, doneSteps, focusPlace, hhmm, nextHint, stepGuide } from "./guide";
import { feelingKey, resultLines } from "./results";
import { PLAYER_ID, type Session } from "./session";
import { el } from "../ui/dom";
import { EncounterUi } from "../ui/encounter-ui";
import type { CoachStep, QuestView, Rect } from "../ui/guide-ui";
import { GuideUi, PlaceSheet, QuestPanel } from "../ui/guide-ui";
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
/** Idle time before a gentle hint appears. */
const IDLE_HINT_MS = 20_000;
/** Events that wake the player out of the fast night skip. */
const WAKE_TYPES = new Set([
  "encounter_started",
  "quest_started",
  "quest_step",
  "quest_check",
  "quest_completed",
  "quest_failed",
  "world_event_started",
]);

export interface GameOptions {
  /** A fresh game: show the guided start and play the first-morning scene straight after. */
  isNew: boolean;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  /** Leave to the title screen. */
  onExit: () => void;
}

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
  private readonly map: RegionMap;
  private readonly sound: SoundEngine;
  private readonly guide = new GuideUi();
  private readonly quests: QuestPanel;
  private readonly sheet = new PlaceSheet();
  private readonly arrow = el(
    "button",
    { class: "edge-arrow", hidden: true, "data-testid": "edge-arrow" },
    el("span", { class: "arrow-head" }, "➤"),
    el("span", { class: "arrow-label" }),
  );
  /** Run one tick at once (after the guided start, so the first-morning scene shows). */
  private forceTick = false;
  /** Something happened in the night: stop skipping until Tobi is up again. */
  private skipHalted = false;
  private lastInput = 0;
  private soundAt = 0;
  private arrowAt = 0;
  private soundSources: SourcePos[] = [];
  private roadDist: Int16Array = new Int16Array(0);
  private walkCache = new Map<string, number | null>();
  private walkCacheTick = -1;

  constructor(
    private readonly mount: HTMLElement,
    private session: Session,
    private readonly opts: GameOptions = { isNew: false, storage: null, onExit: () => {} },
  ) {
    const map = regionMap(session.world.content, REGION);
    if (!map) throw new Error("No map for Lagos");
    this.map = map;
    this.city = buildCity(map, session.world.content.locations);
    this.journal = this.makeJournal();
    this.sound = new SoundEngine(opts.storage, import.meta.env.BASE_URL);
    this.hud = new Hud({
      setSpeed: (s) => this.setSpeed(s),
      zoom: (f) => this.camera.zoomAt(f, this.camera.screenW / 2, this.camera.screenH / 2),
      centre: () => this.centreOnPlayer(),
      openGist: () => this.openGist(),
      openQuests: () => this.openQuests(),
      showMe: () => this.showMe(),
      replayGuide: () => void this.runGuide(),
      backToTitle: () => {
        this.session.save();
        this.opts.onExit();
      },
      sound: () => this.sound.settings,
      setSound: (s) => this.sound.set(s),
      pressed: () => this.sound.ui("tap"),
    });
    this.hud.onHintTap = () => this.showMe();
    this.gist = new GistPanel(() => this.gist.hide());
    this.quests = new QuestPanel(() => this.quests.hide());
    this.arrow.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showMe();
    });
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
      this.quests.root,
      this.card.root,
      this.sheet.root,
      this.encUi.root,
      this.guide.root,
    );
    this.overlay.append(this.arrow);
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
    // Start zoomed in on Tobi (people are placed once first so the camera finds him).
    this.camera.zoom = Math.min(1.6, Math.max(1.2, stage.clientWidth / 300));
    this.onResize();
    this.people.update(this.shownTick(), 0, false, 0);
    this.centreOnPlayer(false);
    this.prepareSound();
    window.addEventListener("resize", () => this.onResize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.session.save();
    });
    attachGestures(this.app.canvas, this.camera, {
      onTap: (x, y) => this.onTap(x, y),
      onDoubleTap: () => this.centreOnPlayer(),
    });
    // Sound may only start after a user gesture; any touch also resets the idle timer.
    const touched = (): void => {
      this.sound.unlock();
      this.lastInput = this.nowMs;
      if (this.hud.hintShown) this.hud.hideHint();
    };
    document.addEventListener("pointerdown", touched, { capture: true });
    document.addEventListener("keydown", touched, { capture: true });
    this.session.onEvents((evs) => this.onEvents(evs));
    this.app.ticker.add((tk) => this.frame(tk.deltaMS));
    this.exposeDebug();
    if (this.opts.isNew) {
      await this.runGuide();
      // The first-morning scene is due now: play the next tick straight away.
      this.forceTick = true;
    }
  }

  /** Intro card and coach marks; the clock is held while they are up. */
  private async runGuide(): Promise<"done" | "skipped"> {
    this.closePanels();
    const wasHeld = this.clock.held;
    this.clock.held = true;
    const rectOf = (e: HTMLElement): Rect => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const steps: CoachStep[] = [
      {
        text: t("coach.you"),
        target: () => {
          const p = this.playerScreen();
          return { x: p.x - 26, y: p.y - 40, w: 52, h: 70 };
        },
      },
      {
        text: t("coach.walk"),
        target: () => {
          const tile = this.streetNearPlayer();
          if (!tile) return null;
          const p = this.tileScreen(tile[0], tile[1]);
          return { x: p.x - 40, y: p.y - 22, w: 80, h: 44 };
        },
      },
      { text: t("coach.quest"), target: () => rectOf(this.hud.targets.quest) },
      { text: t("coach.time"), target: () => rectOf(this.hud.targets.time) },
      { text: t("coach.gist"), target: () => rectOf(this.hud.targets.gist) },
    ];
    const r = await this.guide.run(
      { title: t("intro.title"), body: t("intro.body"), goal: t("intro.goal") },
      steps,
    );
    this.clock.held = wasHeld || this.inEncounter;
    this.clock.reset();
    this.lastInput = this.nowMs;
    return r;
  }

  private closePanels(): void {
    this.card.hide();
    this.gist.hide();
    this.quests.hide();
    this.sheet.hide();
    this.hud.closePops();
    this.hud.hideHint();
  }

  private shownTick(): number {
    const w = this.world;
    return w.tick === 0 ? 0 : Math.max(0, w.tick - 1) + this.clock.frac;
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
      else {
        // Skip quickly through the night while Tobi sleeps, unless something happened.
        const asleep = this.session.asleep;
        if (!asleep) this.skipHalted = false;
        this.clock.fast = asleep && !this.skipHalted && !this.guide.open;
        const due = this.forceTick || this.clock.advance(dtMs);
        this.forceTick = false;
        if (due && this.session.step()) {
          const p = this.session.pending();
          if (p) this.startEncounter(p);
        }
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
      if (this.nowMs - this.arrowAt > 100) {
        this.arrowAt = this.nowMs;
        this.updateArrow();
      }
      this.maybeHint();
    } else {
      const heads = this.scene.heads();
      this.encUi.placeBubbles(heads.left, heads.right);
    }
    if (this.nowMs - this.hudAt > 150) {
      this.hudAt = this.nowMs;
      this.updateHud(minute, wx, L.night > 0.5);
    }
    if (this.nowMs - this.soundAt > 250) {
      this.soundAt = this.nowMs;
      this.updateSound(minute, wx);
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
      canShowMe: this.activeQuest() !== null,
      speed: this.clock.speed,
      sleeping: this.clock.fast && !this.inEncounter,
    });
  }

  private activeQuest(): World["quests"][number] | null {
    return activeQuests(this.world, this.me)[0] ?? null;
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
    if (v && (v.visible || v.hiddenBecause === "asleep")) return iso(v.x + 0.5, v.y + 0.5);
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
    const focus = this.focus();
    const tile = focus ? placeTile(this.map, focus) : null;
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
    let questSound = false;
    let moneyDelta = 0;
    for (const ev of events) {
      if (ev.actors.includes(me) && WAKE_TYPES.has(ev.type) && this.clock.fast) {
        this.skipHalted = true;
      }
      if (ev.type.startsWith("quest_") && ev.actors.includes(me) && ev.type !== "quest_check")
        questSound = true;
      for (const fx of ev.effects) {
        if (fx.kind === "money" && fx.who === me) moneyDelta += fx.delta;
      }
    }
    if (questSound) this.sound.ui("quest");
    else if (moneyDelta) this.sound.ui(moneyDelta > 0 ? "moneyUp" : "moneyDown");
    this.walkCacheTick = -1;
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
    if (this.quests.open) this.openQuests();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private onTap(sx: number, sy: number): void {
    if (this.inEncounter || this.guide.open) return;
    this.hud.closePops();
    this.sheet.hide();
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
    this.sound.ui("walk");
    this.hud.toast(t("walkingThere"));
  }

  private goToPlace(locationId: string): void {
    const name = getLocation(this.world, locationId).name;
    const why = this.session.canGo(locationId);
    if (why === "unknown") return this.hud.toast(t("dontKnowWay", { place: name }));
    if (why === "closed") return this.hud.toast(t("closedNow", { place: name }));
    if (why === "here") return this.hud.toast(t("atPlace", { place: name }));
    this.session.goTo(locationId);
    const tile = placeTile(this.map, locationId);
    if (tile) this.setDestination(tile);
    this.sound.ui("walk");
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
    this.clock.fast = false;
    this.closePanels();
    this.sound.ui("chime");
    this.sound.setDucked(true);
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
    const key = p.scene
      ? `prompt.scene.${p.scene}`
      : p.kind === "passing"
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
    this.clock.held = this.guide.open;
    this.clock.reset();
    this.sound.setDucked(false);
    this.lastInput = this.nowMs;
  }

  // ---------------------------------------------------------------------------
  // Guidance: what to do next, "Show me", the edge arrow, idle hints, quests
  // ---------------------------------------------------------------------------

  private minuteNow(): number {
    return minuteOfDay(Math.max(0, this.world.tick - 1));
  }

  /** Where Tobi is, as a journey start. */
  private playerEndpoint(): Endpoint {
    const c = this.world.characters[this.me]!;
    if (c.travel) {
      const v = this.people.viewOf(this.me);
      if (v?.visible) {
        const tile: Tile = [Math.round(v.x), Math.round(v.y)];
        if (isWalkable(this.map, tile)) return { tile };
      }
      return c.travel.to;
    }
    if (c.street) return { tile: c.street };
    return { locationId: c.locationId };
  }

  /** Walking minutes from Tobi to a place (cached per tick). */
  private walkMinutes(locationId: string): number | null {
    if (this.walkCacheTick !== this.world.tick) {
      this.walkCache.clear();
      this.walkCacheTick = this.world.tick;
    }
    if (!this.walkCache.has(locationId)) {
      try {
        const j = journey(this.world.content, REGION, this.playerEndpoint(), { locationId });
        this.walkCache.set(locationId, j.totalMinutes);
      } catch {
        this.walkCache.set(locationId, null);
      }
    }
    return this.walkCache.get(locationId) ?? null;
  }

  /** The place the arrow, the quest marker and "Show me" point at. */
  private focus(): string | null {
    return focusPlace(stepGuide(this.world, this.me, this.minuteNow()));
  }

  private placeCentre(locationId: string): { x: number; y: number } | null {
    const p = this.city.places.find((x) => x.locationId === locationId);
    if (!p) return null;
    const c = iso(p.rect.x + p.rect.w / 2, p.rect.y + p.rect.h / 2);
    return { x: c.x, y: c.y - 30 };
  }

  private panTo(locationId: string): void {
    const c = this.placeCentre(locationId);
    if (c) this.camera.centreOn(c.x, c.y + 40);
  }

  private suggestionText(s: Suggestion): string {
    const place = getLocation(this.world, s.locationId).name;
    const v = { name: s.name, place, from: hhmm(s.from), to: hhmm(s.to % 1440) };
    const line = s.now
      ? t("suggestNow", v)
      : s.later
        ? t("suggestLater", v)
        : t("suggestUsually", v);
    return s.known ? line : `${line} ${t("suggestUnknown")}`;
  }

  /** "Show me": pan to where the current step can be done and offer to walk there. */
  showMe(): void {
    this.hud.hideHint();
    this.hud.closePops();
    this.quests.hide();
    this.gist.hide();
    const g = stepGuide(this.world, this.me, this.minuteNow());
    if (!g) return;
    const walkTo = (id: string): void => this.goToPlace(id);
    if (g.target) {
      const id = g.target.locationId;
      const loc = getLocation(this.world, id);
      const lines = [g.objective];
      if (!g.target.known) {
        lines.push(t("dontKnowYet"));
        this.sheet.show(loc.name, lines, null);
        return;
      }
      this.panTo(id);
      const mins = this.walkMinutes(id);
      if (mins !== null) lines.push(t("walkMins", { mins: Math.max(1, Math.round(mins)) }));
      if (g.target.window)
        lines.push(
          t("needsTime", { from: hhmm(g.target.window[0]), to: hhmm(g.target.window[1] % 1440) }),
        );
      else if (loc.hours) lines.push(t("openHours", { from: loc.hours.open, to: loc.hours.close }));
      this.sheet.show(loc.name, lines, { label: t("walkThere"), onClick: () => walkTo(id) });
      return;
    }
    const best = g.suggestions.find((s) => s.known);
    if (best) this.panTo(best.locationId);
    const options = g.suggestions.slice(0, 4).map((s) => ({
      label: this.suggestionText(s),
      sub: s.known
        ? t("walkMins", { mins: Math.max(1, Math.round(this.walkMinutes(s.locationId) ?? 0)) })
        : undefined,
      onPick: s.known
        ? () => {
            this.sheet.hide();
            this.panTo(s.locationId);
            walkTo(s.locationId);
          }
        : undefined,
    }));
    this.sheet.show(
      t("suggestTitle"),
      [g.objective],
      best ? { label: t("walkThere"), onClick: () => walkTo(best.locationId) } : null,
      options,
    );
  }

  /** Off-screen target: an arrow at the screen edge pointing at it, with walking minutes. */
  private updateArrow(): void {
    const id = this.focus();
    const c = id ? this.placeCentre(id) : null;
    if (!id || !c || this.guide.open || this.clock.fast) {
      this.arrow.hidden = true;
      return;
    }
    const s = this.camera.worldToScreen(c.x, c.y);
    const W = this.camera.screenW;
    const H = this.camera.screenH;
    const top = this.hud.targets.quest.getBoundingClientRect().bottom + 8;
    const bottom = H - 70;
    const inside = s.x > 20 && s.x < W - 20 && s.y > top && s.y < bottom;
    if (inside) {
      this.arrow.hidden = true;
      return;
    }
    const cx = W / 2;
    const cy = (top + bottom) / 2;
    const dx = s.x - cx;
    const dy = s.y - cy;
    const k = Math.min(
      Math.abs((W / 2 - 34) / (dx || 1e-6)),
      Math.abs(((bottom - top) / 2 - 26) / (dy || 1e-6)),
    );
    const ax = cx + dx * k;
    const ay = cy + dy * k;
    const angle = Math.atan2(dy, dx);
    this.arrow.hidden = false;
    this.arrow.style.transform = `translate(${Math.round(ax)}px, ${Math.round(ay)}px) translate(-50%, -50%)`;
    (this.arrow.firstChild as HTMLElement).style.transform = `rotate(${angle}rad)`;
    const mins = this.walkMinutes(id);
    (this.arrow.lastChild as HTMLElement).textContent =
      mins === null ? "" : `${Math.max(1, Math.round(mins))} min`;
    this.arrow.setAttribute("aria-label", getLocation(this.world, id).name);
  }

  /** After ~20 s without a touch, a gentle hint with the suggested next action. */
  private maybeHint(): void {
    if (this.hud.hintShown || this.guide.open || this.clock.fast) return;
    if (this.gist.open || this.quests.open || this.sheet.open) return;
    if (this.nowMs - this.lastInput < IDLE_HINT_MS) return;
    this.lastInput = this.nowMs;
    const h = this.currentHint();
    if (h) this.hud.showHint(h);
  }

  private currentHint(): string | null {
    const h = nextHint(this.world, this.me, this.minuteNow(), (id) => this.walkMinutes(id));
    return h ? t(h.key, h.vars) : null;
  }

  private openQuests(): void {
    const w = this.world;
    const minute = this.minuteNow();
    const g = stepGuide(w, this.me, minute);
    const mine = w.quests
      .filter((q) => q.characterId === this.me)
      .sort((a, b) => {
        const ra = a.status === "active" ? 0 : 1;
        const rb = b.status === "active" ? 0 : 1;
        return ra - rb || a.instanceId.localeCompare(b.instanceId);
      });
    const today = dayNumber(Math.max(0, w.tick - 1));
    const views: QuestView[] = mine.map((q) => {
      const def = getQuestDef(w, q.questId);
      const step = def.steps.find((s) => s.id === q.stepId);
      let deadline: string | null = null;
      if (q.status === "active" && q.deadlineTick !== null) {
        const day = dayNumber(q.deadlineTick - 1);
        const left = day - today;
        deadline = t("questDeadline", {
          day,
          left: left <= 0 ? t("lastDay") : t("daysLeft", { n: left }),
        });
      }
      const help: string[] = [];
      if (q.status === "active" && g && g.questInstance === q.instanceId) {
        if (g.target) {
          const loc = getLocation(w, g.target.locationId);
          if (!g.target.known) help.push(t("dontKnowYet"));
          else {
            const mins = this.walkMinutes(loc.id);
            help.push(
              `${loc.name}${mins !== null ? ` · ${t("walkMins", { mins: Math.max(1, Math.round(mins)) })}` : ""}${isOpen(loc, minute) ? "" : ` · ${t("closedNow", { place: loc.name })}`}`,
            );
          }
        }
        for (const s of g.suggestions.slice(0, 3)) help.push(this.suggestionText(s));
      }
      return {
        title: def.title,
        summary: def.summary,
        status: q.status,
        now: q.status === "active" ? (step?.objective ?? null) : null,
        done: doneSteps(w, q),
        deadline,
        help,
      };
    });
    this.gist.hide();
    this.sheet.hide();
    this.quests.show(views);
  }

  // ---------------------------------------------------------------------------
  // Sound
  // ---------------------------------------------------------------------------

  /** Sound sources from the map, and each tile's distance to the nearest road. */
  private prepareSound(): void {
    const layerOf: Record<string, SourcePos["layer"]> = {
      market: "market",
      transport_hub: "park",
      buka: "buka",
      music_venue: "live",
    };
    for (const p of this.city.places) {
      const type = getLocation(this.world, p.locationId).type;
      const layer = layerOf[type];
      if (layer)
        this.soundSources.push({ layer, x: p.rect.x + p.rect.w / 2, y: p.rect.y + p.rect.h / 2 });
    }
    const { width: W, height: H } = this.city;
    const dist = new Int16Array(W * H).fill(-1);
    const queue: number[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (this.map.tiles[y]![x] === "R") {
          dist[y * W + x] = 0;
          queue.push(y * W + x);
        }
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi]!;
      const x = i % W;
      const y = Math.floor(i / W);
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || dist[ny * W + nx] !== -1) continue;
        dist[ny * W + nx] = dist[i]! + 1;
        queue.push(ny * W + nx);
      }
    }
    this.roadDist = dist;
  }

  private updateSound(minute: number, wx: ReturnType<typeof currentWeather>): void {
    if (!this.sound.started) return;
    const g = screenToTile(this.camera.x, this.camera.y + 20);
    const lx = Math.max(0, Math.min(this.city.width - 1, Math.floor(g.x)));
    const ly = Math.max(0, Math.min(this.city.height - 1, Math.floor(g.y)));
    const road = this.roadDist[ly * this.city.width + lx] ?? 0;
    const listener = { x: g.x, y: g.y };
    const mix = ambientMix({
      minute,
      weather: wx,
      listener,
      zoom: this.camera.zoom,
      sources: this.soundSources,
      roadDistance: Math.max(0, road),
    });
    const pans: Partial<Record<Layer, number>> = {};
    for (const s of this.soundSources) {
      const d = Math.hypot(s.x - g.x, s.y - g.y);
      const prev = pans[s.layer];
      if (prev === undefined || d < 40) pans[s.layer] = panFor(s, listener);
    }
    this.sound.update(mix, pans);
  }

  // ---------------------------------------------------------------------------
  // Screen helpers
  // ---------------------------------------------------------------------------

  private playerScreen(): { x: number; y: number } {
    const p = this.playerWorldPos();
    return this.camera.worldToScreen(p.x, p.y - 20);
  }

  private tileScreen(tx: number, ty: number): { x: number; y: number } {
    const p = iso(tx + 0.5, ty + 0.5);
    return this.camera.worldToScreen(p.x, p.y);
  }

  /** A sidewalk tile just outside Tobi's door (for the "tap the street" coach mark). */
  private streetNearPlayer(): Tile | null {
    const c = this.world.characters[this.me]!;
    const door = placeTile(this.map, c.locationId);
    if (!door) return null;
    for (let r = 1; r <= 4; r++)
      for (const [dx, dy] of [
        [r, 0],
        [0, r],
        [-r, 0],
        [0, -r],
      ] as const) {
        const tile: Tile = [door[0] + dx, door[1] + dy];
        if (isWalkable(this.map, tile) && !placeAt(this.city, tile[0], tile[1])) return tile;
      }
    return null;
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
          day: dayNumber(Math.max(0, this.world.tick - 1)),
          guideOpen: this.guide.open,
          sceneDone: Boolean(c.flags[sceneFlag("welcome_ada")]),
          knowsLiveSpot: Boolean(c.knownLocations["loc_yaba_livespot"]),
          asleep: this.session.asleep,
          fast: this.clock.fast,
          focus: this.focus(),
          sound: this.sound.started ? this.sound.loaded() : null,
        };
      },
      /** Screen position of the place the guidance points at (null if none). */
      focusScreen: () => {
        const id = this.focus();
        const c = id ? this.placeCentre(id) : null;
        return c ? this.camera.worldToScreen(c.x, c.y) : null;
      },
      hint: () => this.currentHint(),
      cameraZoom: () => this.camera.zoom,
      /** Screen position of a tile's centre (CSS px), for tapping in tests. */
      tileToScreen: (tx: number, ty: number) => {
        const p = iso(tx + 0.5, ty + 0.5);
        return this.camera.worldToScreen(p.x, p.y);
      },
      playerScreen: () => this.playerScreen(),
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
