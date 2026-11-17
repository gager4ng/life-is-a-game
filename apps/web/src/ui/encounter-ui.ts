import { layoutBubbles } from "./bubbles";
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
  /** Who spoke last: their bubble keeps its place, the other one moves out of the way. */
  private lastSide: "left" | "right" = "right";

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
  async play(lines: Line[], onLine?: (side: Line["side"] | null) => void): Promise<void> {
    for (const l of lines) {
      onLine?.(l.side);
      const b = l.side === "left" ? this.bubbleL : this.bubbleR;
      const other = l.side === "left" ? this.bubbleR : this.bubbleL;
      other.classList.add("faded");
      b.classList.remove("faded");
      b.textContent = l.text;
      b.hidden = false;
      this.lastSide = l.side;
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
    onLine?.(null);
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
    // Never overlapping: the newest bubble stays over its speaker, the older one moves away.
    const shown = (
      [
        ["left", this.bubbleL, left],
        ["right", this.bubbleR, right],
      ] as const
    ).filter(([, b]) => !b.hidden);
    shown.sort(([a], [b]) => (a === this.lastSide ? 1 : 0) - (b === this.lastSide ? 1 : 0));
    const minTop = this.caption.getBoundingClientRect().bottom + 8;
    const rects = layoutBubbles(
      shown.map(([, b, p]) => ({
        anchorX: p.x,
        anchorY: p.y,
        w: b.offsetWidth || 200,
        h: b.offsetHeight || 60,
      })),
      window.innerWidth,
      minTop,
    );
    shown.forEach(([, b, p], i) => {
      const r = rects[i]!;
      b.style.left = `${Math.round(r.left)}px`;
      b.style.top = `${Math.round(r.top)}px`;
      const tail = p.x - r.left;
      const above = Math.abs(r.top + r.h + 10 - p.y) < 4;
      b.classList.toggle("no-tail", !above || tail < 14 || tail > r.w - 14);
      b.style.setProperty("--tail-x", `${Math.round(tail)}px`);
    });
  }

  close(): void {
    this.root.hidden = true;
    this.advance = null;
  }
}
