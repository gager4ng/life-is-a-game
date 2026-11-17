import { clear, el } from "./dom";
import { t } from "./text";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CoachStep {
  text: string;
  /** Where to point, in CSS px (null = no highlight, centred bubble). */
  target: () => Rect | null;
}

/**
 * The guided start: an intro card (who Tobi is, what he wants), then coach marks one at a time.
 * Everything is skippable; the menu can replay it.
 */
export class GuideUi {
  readonly root = el("div", { class: "guide", hidden: true, "data-testid": "guide" });
  private resolve: ((r: "done" | "skipped") => void) | null = null;
  private steps: CoachStep[] = [];
  private index = 0;
  private readonly hole = el("div", { class: "coach-hole" });
  private readonly bubble = el("div", { class: "coach-bubble", "data-testid": "coach" });
  private raf = 0;

  get open(): boolean {
    return !this.root.hidden;
  }

  /** Intro card then coach marks. Resolves when finished or skipped. */
  run(
    intro: { title: string; body: string; goal: string },
    steps: CoachStep[],
  ): Promise<"done" | "skipped"> {
    this.finish("skipped");
    this.steps = steps;
    this.index = 0;
    clear(this.root);
    const card = el(
      "section",
      { class: "intro-card", role: "dialog", "data-testid": "intro" },
      el("div", { class: "ph" }, `[PH] ${t("placeholderBadge")}`),
      el("h2", {}, intro.title),
      el("p", {}, intro.body),
      el("p", { class: "goal" }, intro.goal),
      el(
        "button",
        {
          class: "btn big primary",
          "data-testid": "intro-start",
          onclick: () => this.showStep(),
        },
        t("intro.start"),
      ),
      el(
        "button",
        { class: "btn big", "data-testid": "guide-skip", onclick: () => this.finish("skipped") },
        t("intro.skip"),
      ),
    );
    this.root.append(card);
    this.root.hidden = false;
    return new Promise((res) => (this.resolve = res));
  }

  private showStep(): void {
    const step = this.steps[this.index];
    if (!step) return this.finish("done");
    clear(this.root);
    const last = this.index === this.steps.length - 1;
    clear(this.bubble);
    this.bubble.append(
      el("p", {}, step.text),
      el(
        "div",
        { class: "coach-buttons" },
        el(
          "button",
          { class: "btn", "data-testid": "coach-skip", onclick: () => this.finish("skipped") },
          t("coach.skip"),
        ),
        el(
          "button",
          {
            class: "btn primary",
            "data-testid": "coach-next",
            onclick: () => {
              this.index++;
              this.showStep();
            },
          },
          last ? t("coach.done") : t("coach.next"),
        ),
      ),
    );
    this.root.append(this.hole, this.bubble);
    cancelAnimationFrame(this.raf);
    const place = (): void => {
      this.place(step.target());
      this.raf = requestAnimationFrame(place);
    };
    place();
  }

  private place(r: Rect | null): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (!r) {
      this.hole.hidden = true;
      this.bubble.style.left = `${Math.max(12, W / 2 - 150)}px`;
      this.bubble.style.top = `${H * 0.4}px`;
      return;
    }
    this.hole.hidden = false;
    const pad = 6;
    Object.assign(this.hole.style, {
      left: `${r.x - pad}px`,
      top: `${r.y - pad}px`,
      width: `${r.w + pad * 2}px`,
      height: `${r.h + pad * 2}px`,
    });
    const bw = Math.min(300, W - 24);
    const left = Math.max(12, Math.min(W - bw - 12, r.x + r.w / 2 - bw / 2));
    const below = r.y + r.h / 2 < H / 2;
    this.bubble.style.left = `${left}px`;
    this.bubble.style.width = `${bw}px`;
    const bh = this.bubble.offsetHeight || 110;
    this.bubble.style.top = below
      ? `${Math.min(H - bh - 12, r.y + r.h + 14)}px`
      : `${Math.max(12, r.y - bh - 14)}px`;
  }

  private finish(r: "done" | "skipped"): void {
    cancelAnimationFrame(this.raf);
    this.root.hidden = true;
    clear(this.root);
    const res = this.resolve;
    this.resolve = null;
    res?.(r);
  }
}

export interface QuestView {
  title: string;
  summary: string;
  status: "active" | "completed" | "failed";
  now: string | null;
  done: string[];
  deadline: string | null;
  help: string[];
}

/** Quests: what's active, the step you're on, what's done and the deadline. */
export class QuestPanel {
  readonly root = el("section", {
    class: "panel quests",
    hidden: true,
    role: "dialog",
    "aria-label": t("questsTitle"),
    "data-testid": "quests",
  });
  private readonly list = el("div", { class: "feed" });

  constructor(onClose: () => void) {
    this.root.append(
      el(
        "div",
        { class: "panel-head" },
        el("h2", {}, t("questsTitle")),
        el("button", { class: "btn", onclick: onClose, "aria-label": t("close") }, "✕"),
      ),
      this.list,
    );
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(quests: QuestView[]): void {
    clear(this.list);
    if (!quests.length) this.list.append(el("p", { class: "empty" }, t("questsNone")));
    for (const q of quests) {
      const box = el(
        "article",
        { class: `quest-card ${q.status}` },
        el("h3", {}, q.title),
        q.status !== "active"
          ? el(
              "div",
              { class: "status" },
              q.status === "completed" ? t("questCompleted") : t("questFailed"),
            )
          : null,
        el("p", { class: "summary" }, q.summary),
      );
      if (q.now) box.append(el("div", { class: "now" }, el("b", {}, `${t("questNow")}: `), q.now));
      for (const h of q.help) box.append(el("div", { class: "help" }, `→ ${h}`));
      if (q.done.length) {
        const ul = el("ul", { class: "done" });
        for (const d of q.done) ul.append(el("li", {}, `✓ ${d}`));
        box.append(el("div", { class: "done-label" }, t("questDone")), ul);
      }
      if (q.deadline) box.append(el("div", { class: "deadline" }, q.deadline));
      this.list.append(box);
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

export interface SheetOption {
  label: string;
  sub?: string;
  onPick?: () => void;
}

/** Bottom sheet after "Show me": the place, how far, when, and "Walk there". */
export class PlaceSheet {
  readonly root = el("section", {
    class: "card sheet",
    hidden: true,
    role: "dialog",
    "data-testid": "show-me-sheet",
  });

  get open(): boolean {
    return !this.root.hidden;
  }

  show(
    title: string,
    lines: string[],
    action: { label: string; onClick: () => void } | null,
    options: SheetOption[] = [],
  ): void {
    clear(this.root);
    this.root.append(
      el(
        "button",
        { class: "btn close", "aria-label": t("close"), onclick: () => this.hide() },
        "✕",
      ),
      el("h3", {}, title),
    );
    for (const l of lines) this.root.append(el("div", { class: "status" }, l));
    for (const o of options) {
      const b = el(
        "button",
        {
          class: "btn wide option",
          disabled: !o.onPick,
          onclick: () => o.onPick?.(),
        },
        el("span", {}, o.label),
        o.sub ? el("small", {}, o.sub) : null,
      );
      this.root.append(b);
    }
    if (action)
      this.root.append(
        el(
          "button",
          {
            class: "btn big primary",
            "data-testid": "walk-there",
            onclick: () => {
              this.hide();
              action.onClick();
            },
          },
          action.label,
        ),
      );
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
