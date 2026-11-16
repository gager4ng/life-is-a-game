import type { WeatherKind } from "@liag/engine";
import type { Speed } from "../game/clock";
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
  speed: Speed;
}

export interface HudActions {
  setSpeed(s: Speed): void;
  zoom(f: number): void;
  centre(): void;
  openGist(): void;
}

/** Top bar (time, weather, money, mood, energy, quest) and the bottom control row. */
export class Hud {
  readonly root: HTMLElement;
  private readonly clock = el("span", { class: "clock", "data-testid": "clock" });
  private readonly day = el("span", { class: "day" });
  private readonly weather = el("span", { class: "weather", role: "img" });
  private readonly cash = el("span", { class: "money", "data-testid": "money" });
  private readonly moodBar = el("span", { class: "fill mood" });
  private readonly energyBar = el("span", { class: "fill energy" });
  private readonly quest = el("div", { class: "quest", "data-testid": "quest" });
  private readonly speedBtns = new Map<Speed, HTMLButtonElement>();
  private readonly toastEl = el("div", { class: "toast", role: "status", "aria-live": "polite" });
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private last = "";

  constructor(actions: HudActions) {
    const bar = (label: string, fill: HTMLElement): HTMLElement =>
      el(
        "span",
        { class: "bar", title: label, "aria-label": label },
        el("span", { class: "bar-label" }, label),
        el("span", { class: "track" }, fill),
      );
    const top = el(
      "header",
      { class: "hud-top" },
      el(
        "div",
        { class: "row" },
        el("div", { class: "when" }, this.day, this.clock),
        this.weather,
        this.cash,
      ),
      el(
        "div",
        { class: "row bars" },
        bar(t("mood"), this.moodBar),
        bar(t("energy"), this.energyBar),
      ),
      this.quest,
    );
    const speeds: [Speed, string, string][] = [
      [0, "❚❚", t("pause")],
      [1, "1x", "1x"],
      [2, "2x", "2x"],
      [4, "4x", "4x"],
    ];
    const speedRow = el("div", { class: "group speeds", role: "group" });
    for (const [s, label, aria] of speeds) {
      const b = el(
        "button",
        {
          class: "btn",
          "aria-label": aria,
          "data-testid": `speed-${s}`,
          onclick: () => actions.setSpeed(s),
        },
        label,
      );
      this.speedBtns.set(s, b);
      speedRow.append(b);
    }
    const controls = el(
      "nav",
      { class: "hud-bottom" },
      speedRow,
      el(
        "div",
        { class: "group" },
        el(
          "button",
          { class: "btn", "aria-label": t("zoomOut"), onclick: () => actions.zoom(1 / 1.35) },
          "−",
        ),
        el(
          "button",
          { class: "btn", "aria-label": t("zoomIn"), onclick: () => actions.zoom(1.35) },
          "+",
        ),
        el(
          "button",
          {
            class: "btn",
            "aria-label": t("centre"),
            title: t("centre"),
            onclick: () => actions.centre(),
          },
          "◎",
        ),
      ),
      el(
        "button",
        { class: "btn gist-btn", "data-testid": "gist-open", onclick: () => actions.openGist() },
        t("gist"),
      ),
    );
    this.root = el(
      "div",
      { class: "hud" },
      top,
      controls,
      this.toastEl,
      UI_PLACEHOLDER ? el("div", { class: "ph-badge" }, `[PH] ${t("placeholderBadge")}`) : null,
    );
  }

  update(s: HudState): void {
    const key = JSON.stringify(s);
    if (key === this.last) return;
    this.last = key;
    this.day.textContent = s.dayLabel;
    this.clock.textContent = s.clock;
    this.weather.innerHTML = weatherIcon(s.weather, s.night);
    this.weather.setAttribute("aria-label", t(`weather.${s.weather}`));
    this.weather.title = t(`weather.${s.weather}`);
    this.cash.textContent = money(s.money);
    this.moodBar.style.width = `${Math.round(s.mood)}%`;
    this.energyBar.style.width = `${Math.round(s.energy)}%`;
    this.quest.textContent = s.quest ? `${t("questLabel")}: ${s.quest}` : t("noQuest");
    for (const [sp, b] of this.speedBtns) b.setAttribute("aria-pressed", String(sp === s.speed));
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove("show"), 2600);
  }
}
