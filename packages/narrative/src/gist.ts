import type { LedgerEvent } from "@liag/engine";
import type { GistEntry, Journal } from "./journal";

/**
 * The newest feed entries from a run of events, newest first. Passing small talk between other
 * people is left out unless it changed something worth knowing, so the feed stays readable.
 */
export function collectGist(journal: Journal, events: LedgerEvent[], limit = 60): GistEntry[] {
  const out: GistEntry[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const ev = events[i]!;
    const entry = journal.gist(ev);
    if (!entry) continue;
    if (
      entry.kind === "encounter" &&
      !entry.mine &&
      ev.data.kind === "passing" &&
      ev.data.outcome !== "chatted"
    )
      continue;
    out.push(entry);
  }
  return out;
}
