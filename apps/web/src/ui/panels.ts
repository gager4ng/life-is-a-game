import type { GistEntry } from "@liag/narrative";
import { clear, el } from "./dom";
import { t } from "./text";

/** The Gist feed: what happened around Yaba, each with its "why". */
export class GistPanel {
  readonly root = el("section", {
    class: "panel gist",
    hidden: true,
    role: "dialog",
    "aria-label": t("gistTitle"),
    "data-testid": "gist",
  });
  private readonly list = el("ol", { class: "feed" });

  constructor(onClose: () => void) {
    this.root.append(
      el(
        "div",
        { class: "panel-head" },
        el("h2", {}, t("gistTitle")),
        el("button", { class: "btn", onclick: onClose, "aria-label": t("close") }, "✕"),
      ),
      this.list,
    );
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(entries: GistEntry[], when: (tick: number) => string): void {
    clear(this.list);
    if (entries.length === 0) this.list.append(el("li", { class: "empty" }, t("gistEmpty")));
    for (const e of entries) {
      const li = el(
        "li",
        { class: `entry kind-${e.kind}${e.mine ? " mine" : ""}` },
        el("div", { class: "when" }, when(e.tick)),
        el("div", { class: "headline" }, e.headline),
      );
      for (const l of e.lines)
        li.append(el("div", { class: "line" }, el("b", {}, `${l.speaker}: `), l.text));
      if (e.why) li.append(el("div", { class: "why" }, el("b", {}, `${t("why")}: `), e.why));
      if (e.changed)
        li.append(el("div", { class: "changed" }, el("b", {}, `${t("changed")}: `), e.changed));
      this.list.append(li);
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

export interface CardInfo {
  name: string;
  role: string;
  status: string;
  feeling: string | null;
  stats: string | null;
}

/** Small card when you tap someone: who they are and how they feel about you. */
export class PersonCard {
  readonly root = el("section", {
    class: "card",
    hidden: true,
    role: "dialog",
    "data-testid": "person-card",
  });
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(info: CardInfo): void {
    clear(this.root);
    const parts = [
      el(
        "button",
        { class: "btn close", "aria-label": t("close"), onclick: () => this.hide() },
        "✕",
      ),
      el("h3", {}, info.name),
      el("div", { class: "role" }, info.role),
      el("div", { class: "status" }, info.status),
      info.feeling ? el("div", { class: "feeling" }, info.feeling) : null,
      info.stats ? el("div", { class: "stats" }, info.stats) : null,
    ];
    for (const p of parts) if (p) this.root.append(p);
    this.root.hidden = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), 7000);
  }

  hide(): void {
    this.root.hidden = true;
  }
}

/** Title screen: Continue (if there's a save) and New game. */
export function titleScreen(
  hasSave: boolean,
  onContinue: () => void,
  onNew: () => void,
): HTMLElement {
  const confirmBox = el(
    "div",
    { class: "confirm", hidden: true },
    el("p", {}, t("confirmNew")),
    el(
      "button",
      { class: "btn big danger", "data-testid": "confirm-new", onclick: onNew },
      t("newGame"),
    ),
  );
  return el(
    "section",
    { class: "title", "data-testid": "title" },
    el("h1", {}, t("title")),
    el("p", { class: "sub" }, t("subtitle")),
    el("div", { class: "ph" }, `[PH] ${t("placeholderBadge")}`),
    hasSave
      ? el(
          "button",
          { class: "btn big primary", "data-testid": "continue", onclick: onContinue },
          t("continue"),
        )
      : null,
    el(
      "button",
      {
        class: `btn big${hasSave ? "" : " primary"}`,
        "data-testid": "new-game",
        onclick: () => {
          if (hasSave) confirmBox.hidden = false;
          else onNew();
        },
      },
      t("newGame"),
    ),
    confirmBox,
  );
}
