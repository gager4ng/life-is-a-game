import type { DialogueBank } from "@liag/content";
import { hashSeed } from "@liag/engine";

export type Vars = Record<string, string | number | null | undefined>;

/**
 * Renders dialogue keys from the content bank. Keys fall back from specific to general
 * (help.umbrella.yes.funny -> help.umbrella.yes -> help.umbrella). The variant is chosen by
 * hashing a stable id, so the same event always reads the same way. Lines from placeholder
 * files are prefixed with [PH].
 */
export class Text {
  constructor(private readonly bank: DialogueBank) {}

  get placeholder(): boolean {
    return this.bank.placeholder;
  }

  lookup(keys: string[]): string[] | null {
    for (const key of keys) {
      const parts = key.split(".");
      while (parts.length > 0) {
        const hit = this.bank.lines[parts.join(".")];
        if (hit) return hit;
        parts.pop();
      }
    }
    return null;
  }

  raw(key: string | string[], vars: Vars, stableId: string): string {
    const keys = Array.isArray(key) ? key : [key];
    const variants = this.lookup(keys);
    if (!variants) return `[missing text: ${keys[0]}]`;
    const line = variants[hashSeed(`${stableId}:${keys[0]}`) % variants.length]!;
    return line.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = vars[k];
      return v === null || v === undefined ? `{${k}}` : String(v);
    });
  }

  /** A line of placeholder dialogue, marked as such. */
  line(key: string | string[], vars: Vars, stableId: string): string {
    return `${this.placeholder ? "[PH] " : ""}${this.raw(key, vars, stableId)}`;
  }

  /** Option labels: specific key first, then the general role/tone label. */
  option(labelKey: string, vars: Vars, stableId: string): string {
    const parts = labelKey.split(".");
    const general = [parts[0], ...parts.slice(2)].join(".");
    return this.raw([labelKey, general], vars, stableId);
  }
}

export function naira(n: number): string {
  return `N${Math.round(n).toLocaleString("en-US")}`;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
