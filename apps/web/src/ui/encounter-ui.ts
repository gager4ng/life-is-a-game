import { clear, el } from "./dom";
import { t } from "./text";

export interface Line {
  side: "left" | "right";
  text: string;
}

/**
 * The words and buttons over the encounter scene: a caption saying what's going on, speech
 * bubbles over each head, 2-4 big reply buttons, and afterwards a short result card.
 */
export class EncounterUi {
  readonly root = el("section", { class: "encounter", hidden: true, "data-testid": "encounter" });
  private readonly caption = el("div", { class: "caption" });
  private readonly names = el("div", { class: "names" });
  private readonly bubbleL = el("div", { class: "bubble left", hidden: true });
  private readonly bubbleR = el("div", { class: "bubble right", hidden: true });
  private readonly choices = el("div", { class: "choices", "data-testid": "choices" });
  private readonly result = el("div", { class: "result", hidden: true, "data-testid": "result" });
  private advance: (() => void) | null = null;

  constructor() {
    this.root.append(
      this.caption,
      this.names,
      this.bubbleL,
      this.bubbleR,
      this.choices,
      this.result,
    );
    // Tapping anywhere moves the conversation on.
    this.root.addEventListener("pointerup", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      this.advance?.();
    });
  }

  open(
    caption: string,
    leftName: string,
    rightName: string,
    options: { id: string; label: string }[],
    onChoose: (id: string) => void,
  ): void {
    this.caption.textContent = caption;
    clear(this.names);
    this.names.append(
      el("span", { class: "name left" }, leftName),
      el("span", { class: "name right" }, rightName),
    );
    this.bubbleL.hidden = true;
    this.bubbleR.hidden = true;
    this.result.hidden = true;
    clear(this.choices);
    this.choices.hidden = false;
    for (const o of options) {
      this.choices.append(
        el(
          "button",
          {
            class: "btn choice",
            "data-option": o.id,
            onclick: () => {
              this.choices.hidden = true;
              onChoose(o.id);
            },
          },
          o.label,
        ),
      );
    }
    this.root.hidden = false;
  }

  /** Show the lines one by one (tap to skip ahead). */
  async play(lines: Line[]): Promise<void> {
    for (const l of lines) {
      const b = l.side === "left" ? this.bubbleL : this.bubbleR;
      const other = l.side === "left" ? this.bubbleR : this.bubbleL;
      other.classList.add("faded");
      b.classList.remove("faded");
      b.textContent = l.text;
      b.hidden = false;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, 1400 + l.text.length * 35);
        function done(): void {
          clearTimeout(timer);
          resolve();
        }
        this.advance = done;
      });
      this.advance = null;
    }
  }

  showResult(items: string[], onOk: () => void): void {
    clear(this.result);
    this.result.append(el("h3", {}, t("resultTitle")));
    const ul = el("ul", {});
    for (const i of items.length ? items : [t("nothingChanged")]) ul.append(el("li", {}, i));
    this.result.append(
      ul,
      el(
        "button",
        { class: "btn big primary", "data-testid": "result-ok", onclick: onOk },
        t("ok"),
      ),
    );
    this.result.hidden = false;
  }

  placeBubbles(left: { x: number; y: number }, right: { x: number; y: number }): void {
    // Keep each bubble on screen: on a narrow phone the heads sit near the edges.
    const W = window.innerWidth;
    const place = (b: HTMLElement, p: { x: number; y: number }): void => {
      const half = (b.offsetWidth || 200) / 2;
      const x = Math.max(half + 8, Math.min(W - half - 8, p.x));
      b.style.left = `${x}px`;
      b.style.top = `${p.y}px`;
      b.style.setProperty("--tail", `${Math.round(p.x - x)}px`);
    };
    place(this.bubbleL, left);
    place(this.bubbleR, right);
  }

  close(): void {
    this.root.hidden = true;
    this.advance = null;
  }
}
