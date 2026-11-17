import type { WeatherKind } from "@liag/engine";
import type { Speed } from "../game/clock";
import type { SoundSettings } from "../audio/sound";
import { el } from "./dom";
import { weatherIcon } from "./icons";
import { UI_PLACEHOLDER, money, t } from "./text";

export interface HudState {
  dayLabel: string;
  clock: string;
  weather: WeatherKind;
  night: boolean;
  money: number;
  mood: number;
  energy: number;
  quest: string | null;
  canShowMe: boolean;
  speed: Speed;
  sleeping: boolean;
}

export interface HudActions {
  setSpeed(s: Speed): void;
  zoom(f: number): void;
  centre(): void;
  openGist(): void;
  openQuests(): void;
  showMe(): void;
  replayGuide(): void;
  backToTitle(): void;
  sound(): SoundSettings;
  setSound(s: Partial<SoundSettings>): void;
  /** Any HUD button press (for the tap sound and the idle timer). */
  pressed(): void;
}

const NEXT_SPEED: Record<Speed, Speed> = { 0: 1, 1: 2, 2: 4, 4: 1 };

/**
 * Top bar (time, weather, money, sound, menu; mood and energy; the quest line with "Show me")
 * and one compact bottom row that fits a 360 px portrait screen: play/pause, speed and zoom
 * grouped on the left, Quests and Gist always visible on the right.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly clock = el("span", { class: "clock", "data-testid": "clock" });
  private readonly day = el("span", { class: "day" });
  private readonly weather = el("span", { class: "weather", role: "img" });
  private readonly cash = el("span", { class: "money", "data-testid": "money" });
  private readonly moodBar = el("span", { class: "fill mood" });
  private readonly energyBar = el("span", { class: "fill energy" });
  private readonly questText = el("button", {
    class: "quest-text",
    "data-testid": "quest",
  });
  private readonly showMeBtn: HTMLButtonElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly zoomPop: HTMLElement;
  private readonly soundPop: HTMLElement;
  private readonly menuPop: HTMLElement;
  private readonly toastEl = el("div", { class: "toast", role: "status", "aria-live": "polite" });
  readonly hintEl = el("div", { class: "hint", hidden: true, "data-testid": "hint" });
  private readonly hintText = el("span", {});
  readonly sleepEl = el(
    "div",
    { class: "sleeping", hidden: true, "data-testid": "sleeping" },
    el("span", { class: "zz" }, "Z z z"),
    el("span", {}, t("sleeping")),
  );
  private readonly sleepClock = el("span", { class: "clock" });
  /** Elements the guide points at. */
  readonly targets: Record<"quest" | "time" | "gist", HTMLElement>;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private last = "";
  private speed: Speed = 1;
  private lastPlaying: Speed = 1;
  onHintTap: (() => void) | null = null;

  constructor(private readonly actions: HudActions) {
    const press =
      (fn: () => void) =>
      (e: Event): void => {
        e.stopPropagation();
        actions.pressed();
        fn();
      };
    const bar = (label: string, fill: HTMLElement): HTMLElement =>
      el(
        "span",
        { class: "bar", title: label, "aria-label": label },
        el("span", { class: "bar-label" }, label),
        el("span", { class: "track" }, fill),
      );

    this.soundBtn = el("button", {
      class: "btn icon",
      "aria-label": t("sound"),
      "data-testid": "sound-btn",
      onclick: press(() => this.toggle(this.soundPop)),
    });
    const menuBtn = el(
      "button",
      {
        class: "btn icon",
        "aria-label": t("menu"),
        "data-testid": "menu-btn",
        onclick: press(() => this.toggle(this.menuPop)),
      },
      "☰",
    );
    this.showMeBtn = el(
      "button",
      {
        class: "btn small primary",
        "data-testid": "show-me",
        onclick: press(() => actions.showMe()),
      },
      t("showMe"),
    );
    this.questText.addEventListener(
      "click",
      press(() => actions.openQuests()),
    );
    const questRow = el("div", { class: "quest" }, this.questText, this.showMeBtn);
    const top = el(
      "header",
      { class: "hud-top" },
      el(
        "div",
        { class: "row" },
        el("div", { class: "when" }, this.day, this.clock),
        this.weather,
        this.cash,
        this.soundBtn,
        menuBtn,
      ),
      el(
        "div",
        { class: "row bars" },
        bar(t("mood"), this.moodBar),
        bar(t("energy"), this.energyBar),
      ),
      questRow,
    );

    // --- Sound and menu pop-overs (top right) ---
    const muteBtn = el("button", { class: "btn wide", "data-testid": "mute" });
    const musicBtn = el("button", { class: "btn wide", "data-testid": "music" });
    const vol = el("input", {
      type: "range",
      min: 0,
      max: 100,
      step: 5,
      "aria-label": t("sound.volume"),
      "data-testid": "volume",
    });
    const refreshSound = (): void => {
      const s = actions.sound();
      muteBtn.textContent = s.muted ? `🔇 ${t("sound.off")}` : `🔊 ${t("sound.on")}`;
      musicBtn.textContent = s.music ? `♪ ${t("music.on")}` : `♪ ${t("music.off")}`;
      vol.value = String(Math.round(s.volume * 100));
      this.soundBtn.textContent = s.muted ? "🔇" : "🔊";
    };
    muteBtn.addEventListener(
      "click",
      press(() => {
        actions.setSound({ muted: !actions.sound().muted });
        refreshSound();
      }),
    );
    musicBtn.addEventListener(
      "click",
      press(() => {
        actions.setSound({ music: !actions.sound().music });
        refreshSound();
      }),
    );
    vol.addEventListener("input", () => {
      actions.setSound({ volume: Number(vol.value) / 100, muted: false });
      refreshSound();
    });
    this.soundPop = el(
      "div",
      { class: "pop pop-top", hidden: true, "data-testid": "sound-pop" },
      muteBtn,
      el("label", { class: "vol" }, t("sound.volume"), vol),
      musicBtn,
    );
    const item = (label: string, fn: () => void, id: string): HTMLButtonElement =>
      el(
        "button",
        {
          class: "btn wide",
          "data-testid": id,
          onclick: press(() => {
            this.closePops();
            fn();
          }),
        },
        label,
      );
    this.menuPop = el(
      "div",
      { class: "pop pop-top", hidden: true },
      item(t("menu.guide"), () => actions.replayGuide(), "menu-guide"),
      item(t("menu.quests"), () => actions.openQuests(), "menu-quests"),
      item(t("menu.title"), () => actions.backToTitle(), "menu-title"),
    );
    refreshSound();

    // --- Bottom row ---
    this.playBtn = el("button", {
      class: "btn icon",
      "aria-label": t("playPause"),
      "data-testid": "speed-0",
      onclick: press(() => actions.setSpeed(this.speed === 0 ? this.lastPlaying : 0)),
    });
    this.speedBtn = el("button", {
      class: "btn icon",
      "aria-label": t("speed"),
      "data-testid": "speed-cycle",
      onclick: press(() => actions.setSpeed(NEXT_SPEED[this.speed])),
    });
    const zoomBtn = el(
      "button",
      {
        class: "btn icon",
        "aria-label": t("zoom"),
        "data-testid": "zoom-toggle",
        onclick: press(() => this.toggle(this.zoomPop)),
      },
      "🔍",
    );
    const zb = (label: string, aria: string, fn: () => void, id: string): HTMLButtonElement =>
      el(
        "button",
        { class: "btn icon", "aria-label": aria, "data-testid": id, onclick: press(fn) },
        label,
      );
    this.zoomPop = el(
      "div",
      { class: "pop pop-zoom", hidden: true },
      zb("+", t("zoomIn"), () => actions.zoom(1.35), "zoom-in"),
      zb("◎", t("centre"), () => actions.centre(), "centre"),
      zb("−", t("zoomOut"), () => actions.zoom(1 / 1.35), "zoom-out"),
    );
    const timeCtl = el(
      "div",
      { class: "group time-ctl", role: "group" },
      this.playBtn,
      this.speedBtn,
      zoomBtn,
    );
    const questsBtn = el(
      "button",
      {
        class: "btn quests-btn",
        "data-testid": "quests-open",
        onclick: press(() => actions.openQuests()),
      },
      `📜 ${t("quests")}`,
    );
    const gistBtn = el(
      "button",
      {
        class: "btn gist-btn",
        "data-testid": "gist-open",
        onclick: press(() => actions.openGist()),
      },
      t("gist"),
    );
    const controls = el(
      "nav",
      { class: "hud-bottom" },
      timeCtl,
      el("div", { class: "group" }, questsBtn, gistBtn),
    );
    this.targets = { quest: questRow, time: timeCtl, gist: gistBtn };

    this.hintEl.append(el("span", { class: "hint-icon" }, "💡"), this.hintText);
    this.hintEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hideHint();
      this.onHintTap?.();
    });
    this.sleepEl.append(this.sleepClock);

    this.root = el(
      "div",
      { class: "hud" },
      top,
      this.soundPop,
      this.menuPop,
      this.zoomPop,
      controls,
      this.hintEl,
      this.sleepEl,
      this.toastEl,
      UI_PLACEHOLDER ? el("div", { class: "ph-badge" }, `[PH] ${t("placeholderBadge")}`) : null,
    );
  }

  private toggle(pop: HTMLElement): void {
    const open = pop.hidden;
    this.closePops();
    pop.hidden = !open;
  }

  closePops(): void {
    this.soundPop.hidden = true;
    this.menuPop.hidden = true;
    this.zoomPop.hidden = true;
  }

  update(s: HudState): void {
    const key = JSON.stringify(s);
    if (key === this.last) return;
    this.last = key;
    this.speed = s.speed;
    if (s.speed !== 0) this.lastPlaying = s.speed;
    this.day.textContent = s.dayLabel;
    this.clock.textContent = s.clock;
    this.sleepClock.textContent = s.clock;
    this.weather.innerHTML = weatherIcon(s.weather, s.night);
    this.weather.setAttribute("aria-label", t(`weather.${s.weather}`));
    this.weather.title = t(`weather.${s.weather}`);
    this.cash.textContent = money(s.money);
    this.moodBar.style.width = `${Math.round(s.mood)}%`;
    this.energyBar.style.width = `${Math.round(s.energy)}%`;
    this.questText.textContent = s.quest ? `${t("questLabel")}: ${s.quest}` : t("noQuest");
    this.showMeBtn.hidden = !s.canShowMe;
    this.playBtn.textContent = s.speed === 0 ? "▶" : "❚❚";
    this.playBtn.setAttribute("aria-pressed", String(s.speed === 0));
    this.speedBtn.textContent = `${s.speed === 0 ? this.lastPlaying : s.speed}x`;
    this.sleepEl.hidden = !s.sleeping;
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove("show"), 2600);
  }

  showHint(text: string): void {
    this.hintText.textContent = text;
    this.hintEl.hidden = false;
  }

  hideHint(): void {
    this.hintEl.hidden = true;
  }

  get hintShown(): boolean {
    return !this.hintEl.hidden;
  }
}
