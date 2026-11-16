import { loadDialogue, loadUiText } from "@liag/content";
import { Text } from "@liag/narrative";

/**
 * All wording in the browser comes from content files that are still PLACEHOLDER. Speech and
 * narration are prefixed with [PH] (via the shared Text class); interface labels come from
 * ui/web.json and a "Placeholder text" badge stays on screen while any of it is unapproved.
 */
const ui = loadUiText();
export const dialogue = new Text(loadDialogue());
export const UI_PLACEHOLDER = ui.placeholder || dialogue.placeholder;

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const s = ui.text[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] === undefined ? `{${k}}` : String(vars[k]),
  );
}

export function money(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-US")}`;
}
