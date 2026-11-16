import type { Effect, LedgerEvent, World } from "@liag/engine";
import {
  TICK_MINUTES,
  TICKS_PER_DAY,
  calendar,
  dayIndex,
  dayNumber,
  formatClock,
  getChar,
  getEvent,
  getLocation,
  getQuestDef,
  minuteOfDay,
} from "@liag/engine";
import type { Text } from "./text";
import { naira, signed } from "./text";

export interface JournalOptions {
  /** The player's character: their events are always shown in full. */
  playerCharId: string | null;
  verbose: boolean;
  /** Interactive play: only what happens to you, where you are, plus news and weather. */
  focus?: boolean;
  /** Currency sign for amounts (the CLI uses "N", the browser "\u20a6"). */
  currency?: string;
}

/** One item for a feed such as the browser's Gist panel. */
export interface GistEntry {
  id: string;
  tick: number;
  kind: "encounter" | "rumour" | "news" | "quest" | "debt";
  /** Involves the player character. */
  mine: boolean;
  locationId: string | null;
  headline: string;
  lines: { speakerId: string; speaker: string; text: string }[];
  why: string | null;
  changed: string | null;
}

interface EncounterParts {
  headline: string;
  lines: { speakerId: string; speaker: string; text: string }[];
  why: string;
  changed: string;
  brief: string;
}

const GLOBAL_TYPES = new Set([
  "day_started",
  "weather_set",
  "world_event_started",
  "world_event_ended",
]);

const WEATHER_WORDS: Record<string, string> = {
  dry: "dry",
  rain: "rain",
  heavy_rain: "heavy rain",
  harmattan: "harmattan haze",
};

const OPPORTUNITY_WORDS: Record<string, string> = {
  gig_lead: "a gig lead",
  business_tip: "a business tip",
  job_contact: "a job contact",
};

const REASON_WORDS: Record<string, string> = {
  broke: "can't afford it",
  unwilling: "not willing",
  rival: "chasing the same break",
  too_tired: "too tired",
  nothing_to_offer: "nothing left to offer",
  declined: "declined",
};

const DIM_SHORT: Record<string, string> = {
  trust: "trust",
  familiarity: "fam",
  respect: "respect",
  warmth: "warmth",
  tension: "tension",
};

export class Journal {
  constructor(
    private readonly world: World,
    private readonly text: Text,
    private readonly opts: JournalOptions,
  ) {}

  money(n: number): string {
    return naira(n).replace(/^N/, this.opts.currency ?? "N");
  }

  private name(id: string | null | undefined): string {
    if (!id) return "someone";
    const c = this.world.characters[id];
    if (!c) return id;
    return id === this.opts.playerCharId ? `${c.name} (you)` : c.name;
  }

  private place(id: string | null | undefined): string {
    if (!id) return "somewhere";
    try {
      return getLocation(this.world, id).name;
    } catch {
      return id;
    }
  }

  private time(ev: LedgerEvent): string {
    return formatClock(minuteOfDay(ev.tick));
  }

  private involvesPlayer(ev: LedgerEvent): boolean {
    return this.opts.playerCharId !== null && ev.actors.includes(this.opts.playerCharId);
  }

  /** Render a batch of events (e.g. one tick's worth) as journal lines. */
  render(events: LedgerEvent[]): string[] {
    const out: string[] = [];
    const me = this.opts.playerCharId ? this.world.characters[this.opts.playerCharId] : undefined;
    for (const ev of events) {
      if (this.opts.focus && me) {
        const relevant =
          GLOBAL_TYPES.has(ev.type) ||
          ev.actors.includes(me.id) ||
          (ev.location === me.locationId && ev.type === "encounter_resolved");
        if (!relevant) continue;
      }
      out.push(...this.renderOne(ev));
    }
    return out;
  }

  renderOne(ev: LedgerEvent): string[] {
    const d = ev.data;
    switch (ev.type) {
      case "day_started": {
        const cal = calendar(this.world.startDate, dayIndex(ev.tick));
        return ["", `=== Day ${dayNumber(ev.tick)} · ${cal.label} ===`];
      }
      case "weather_set":
        return [`  Weather (${String(d.regionId)}): ${this.weatherSummary(ev)}`];
      case "world_event_started":
        return [`  NEWS: ${String(d.name)} starts today.${this.priceNote(String(d.worldEventId))}`];
      case "world_event_ended":
        return [`  NEWS: ${String(d.name)} is over.`];
      case "weather_changed":
        return this.opts.verbose
          ? [
              `${this.time(ev)}  Sky: ${WEATHER_WORDS[String(d.from)]} -> ${WEATHER_WORDS[String(d.to)]}`,
            ]
          : [];
      case "encounter_resolved":
        return this.renderEncounter(ev);
      case "rumour_shared":
        return this.renderRumour(ev);
      case "debt_repaid":
        return [
          `${this.time(ev)}  ${this.text.raw("narrate.debt_repaid", { a: this.name(ev.actors[0]), b: this.name(ev.actors[1]), amount: this.money(Number(d.amount)) }, ev.id)}`,
        ];
      case "debt_overdue":
        return [
          `  ! ${this.text.raw("narrate.debt_overdue", { a: this.name(ev.actors[0]), b: this.name(ev.actors[1]), amount: this.money(Number(d.amount)) }, ev.id)}`,
        ];
      case "went_without":
        if (!this.involvesPlayer(ev) && !this.opts.verbose) return [];
        return [
          `${this.time(ev)}  ${this.text.raw(`narrate.went_without.${String(d.kind)}`, { a: this.name(ev.actors[0]) }, ev.id)}`,
        ];
      case "short_of_money":
        if (!this.involvesPlayer(ev) && !this.opts.verbose) return [];
        return [
          `${this.time(ev)}  ${this.text.raw(`narrate.short_of_money.${String(d.kind)}`, { a: this.name(ev.actors[0]) }, ev.id)}`,
        ];
      case "delayed":
        if (!this.involvesPlayer(ev) && !this.opts.verbose) return [];
        return [
          `${this.time(ev)}  ${this.text.raw("narrate.delayed", { a: this.name(ev.actors[0]), place: this.place(ev.location), weather: WEATHER_WORDS[String(d.weather)] }, ev.id)}`,
        ];
      case "arrived":
        return this.renderArrival(ev);
      case "goal_achieved":
        return [`  * ${this.name(ev.actors[0])} reached a personal goal: ${String(d.goalId)}.`];
      case "quest_started":
      case "quest_step":
      case "quest_check":
      case "quest_completed":
      case "quest_failed":
        return this.renderQuest(ev);
      case "day_settled":
        return this.renderSettlement(ev);
      case "player_choice":
        return [
          d.street
            ? `${this.time(ev)}  You set off down the street.`
            : `${this.time(ev)}  You decide to go to ${this.place(String(d.goTo))}.`,
        ];
      default:
        return [];
    }
  }

  private weatherSummary(ev: LedgerEvent): string {
    const windows = (ev.data.windows as { from: number; to: number; heavy: boolean }[]) ?? [];
    const base = WEATHER_WORDS[String(ev.data.base)] ?? String(ev.data.base);
    if (windows.length === 0) return `${base} all day`;
    const spells = windows.map(
      (w) => `${w.heavy ? "heavy rain" : "rain"} ${formatClock(w.from)}-${formatClock(w.to)}`,
    );
    return `${base}, with ${spells.join(" and ")}`;
  }

  private priceNote(worldEventId: string): string {
    const def = this.world.content.worldEvents.find((e) => e.id === worldEventId);
    if (!def?.prices) return "";
    const parts = Object.entries(def.prices).map(([k, v]) => `${k} x${v}`);
    return ` (prices: ${parts.join(", ")})`;
  }

  private renderArrival(ev: LedgerEvent): string[] {
    if (!this.involvesPlayer(ev)) return [];
    if (ev.data.street) {
      return [`${this.time(ev)}  ${this.name(ev.actors[0])} stopped on the street.`];
    }
    const src = String(ev.data.source);
    if (src === "routine" && !this.opts.verbose) return [];
    const why =
      src === "player"
        ? this.playerArrivalReason(ev)
        : src === "variation"
          ? `today's change of routine: ${String(ev.data.sourceId)}`
          : src === "world_event"
            ? "because of today's news"
            : src === "closed_fallback"
              ? "the place was closed"
              : "routine";
    const mins = Number(ev.data.minutes ?? 0);
    const trip = mins > 0 ? `, ${mins} min on the way` : "";
    return [
      `${this.time(ev)}  ${this.name(ev.actors[0])} got to ${this.place(ev.location)} (${why}${trip}).`,
    ];
  }

  /** The pieces of a resolved encounter: what happened, what was said, why, what changed. */
  encounterParts(ev: LedgerEvent): EncounterParts {
    const d = ev.data;
    const a = String(d.asker);
    const b = String(d.giver);
    const kind = String(d.kind);
    const sub = String(d.subtype);
    const outcome = String(d.outcome);
    const vars = {
      a: this.name(a),
      b: this.name(b),
      amount: d.amount ? this.money(Number(d.amount)) : null,
      target: d.targetLocation ? this.place(String(d.targetLocation)) : null,
      reason: REASON_WORDS[String(d.reason)] ?? String(d.reason),
      opportunity: OPPORTUNITY_WORDS[sub] ?? sub,
    };
    const key =
      kind === "passing"
        ? `narrate.passing.${outcome}`
        : kind === "help"
          ? `narrate.help.${sub}.${outcome}`
          : `narrate.opportunity.${outcome}`;
    const start = getEvent(this.world, ev.causes[0]!);
    const weather = WEATHER_WORDS[String(start.data.weather)] ?? "";
    const headline = `${this.place(ev.location)}${weather && weather !== "dry" ? ` (${weather})` : ""}: ${this.text.raw(key, vars, ev.id)}`;
    const lines = ((d.lines as { speaker: string; key: string }[]) ?? []).map((l) => {
      const other = l.speaker === a ? b : a;
      const text = this.text.line(
        l.key,
        {
          other: this.world.characters[other]?.name ?? other,
          amount: vars.amount,
          target: vars.target,
        },
        `${ev.id}:${l.speaker}`,
      );
      return {
        speakerId: l.speaker,
        speaker: this.world.characters[l.speaker]?.name ?? l.speaker,
        text,
      };
    });
    return {
      headline,
      lines,
      why: this.whyLine(start),
      changed: this.effectSummary(ev.effects, false),
      brief: this.effectSummary(ev.effects, true),
    };
  }

  private renderEncounter(ev: LedgerEvent): string[] {
    const p = this.encounterParts(ev);
    const head = `${this.time(ev)}  ${p.headline}`;
    // Passing chats between other people are one line unless verbose.
    if (String(ev.data.kind) === "passing" && !this.involvesPlayer(ev) && !this.opts.verbose) {
      return [`${head}${p.brief ? `  [${p.brief}]` : ""}`];
    }
    const out = [head];
    for (const l of p.lines) out.push(`      ${l.speaker}: "${l.text}"`);
    if (p.why) out.push(`      why: ${p.why}`);
    if (p.changed) out.push(`      changed: ${p.changed}`);
    return out;
  }

  /** A feed entry for an event, or null if it isn't the kind of thing people gossip about. */
  gist(ev: LedgerEvent): GistEntry | null {
    const base = {
      id: ev.id,
      tick: ev.tick,
      mine: this.involvesPlayer(ev),
      locationId: ev.location,
      lines: [] as GistEntry["lines"],
      why: null,
      changed: null,
    };
    switch (ev.type) {
      case "encounter_resolved": {
        const p = this.encounterParts(ev);
        return {
          ...base,
          kind: "encounter",
          headline: p.headline,
          lines: p.lines,
          why: p.why || null,
          changed: p.changed || null,
        };
      }
      case "rumour_shared":
        return { ...base, kind: "rumour", headline: this.renderRumour(ev)[0]!.trim() };
      case "world_event_started":
      case "world_event_ended":
        return { ...base, kind: "news", headline: this.renderOne(ev)[0]!.trim() };
      case "quest_started":
      case "quest_step":
      case "quest_check":
      case "quest_completed":
      case "quest_failed": {
        const line = this.renderQuest(ev)[0];
        return line ? { ...base, kind: "quest", headline: line.replace(/^\s*\*\s*/, "") } : null;
      }
      case "debt_repaid":
      case "debt_overdue": {
        const line = this.renderOne(ev)[0];
        return line ? { ...base, kind: "debt", headline: line.replace(/^.*? {2}(! )?/, "") } : null;
      }
      default:
        return null;
    }
  }

  /** Turn an encounter's cause ids into a plain-language reason they were both there. */
  whyLine(start: LedgerEvent): string {
    const parts: string[] = [];
    const sd = start.data;
    const asker = this.name(String(sd.asker));
    const arrivedActors = new Set<string>();
    for (const id of start.causes) {
      const c = getEvent(this.world, id);
      const d = c.data;
      switch (c.type) {
        case "arrived": {
          arrivedActors.add(c.actors[0]!);
          const who = this.name(c.actors[0]);
          const act = String(d.activity).replace(/_/g, " ");
          const src = String(d.source);
          const how =
            src === "routine"
              ? "routine"
              : src === "variation"
                ? `change of routine: ${String(d.sourceId).replace(/_/g, " ")}`
                : src === "world_event"
                  ? this.worldEventName(String(d.sourceId))
                  : src === "player"
                    ? this.playerArrivalReason(c)
                    : "plans changed";
          parts.push(`${who} came for ${act} (${how}, ${formatClock(minuteOfDay(c.tick))})`);
          break;
        }
        case "delayed":
          parts.push(
            `${this.name(c.actors[0])} was held here by ${WEATHER_WORDS[String(d.weather)]}${d.noDanfo ? " (no danfo)" : ""}`,
          );
          break;
        case "short_of_money":
          parts.push(
            `${this.name(c.actors[0])} was short ${this.money(Number(d.amount))} for ${d.kind === "transport_money" ? "the fare" : "food"}`,
          );
          break;
        case "weather_changed":
          parts.push(`${WEATHER_WORDS[String(d.to)]} since ${formatClock(minuteOfDay(c.tick))}`);
          break;
        case "world_event_started":
          parts.push(`${String(d.name)}`);
          break;
        case "day_planned":
          parts.push(
            `${this.name(c.actors[0])} was trying to find ${sd.targetLocation ? this.place(String(sd.targetLocation)) : "a place"} for today's plan`,
          );
          break;
        case "player_choice":
        case "player_intent":
          parts.push(
            `${this.name(c.actors[0])} set off to ${this.place(String(d.goTo ?? d.locationId))}`,
          );
          break;
        case "world_created":
          if (sd.kind === "opportunity") {
            parts.push(
              `${asker} has been looking for ${OPPORTUNITY_WORDS[String(sd.subtype)] ?? "a break"}`,
            );
          } else if (sd.subtype === "directions" && sd.targetLocation) {
            parts.push(`${asker} has wanted to find ${this.place(String(sd.targetLocation))}`);
          }
          break;
        default:
          break;
      }
    }
    for (const actor of start.actors) {
      if (!arrivedActors.has(actor)) parts.push(`${this.name(actor)} was already here`);
    }
    return [...new Set(parts)].join("; ");
  }

  private playerArrivalReason(arrival: LedgerEvent): string {
    const cause = arrival.causes[0] ? getEvent(this.world, arrival.causes[0]) : null;
    if (cause?.type === "player_intent") return "heading there for a quest";
    return "their own choice";
  }

  private worldEventName(id: string): string {
    return this.world.content.worldEvents.find((e) => e.id === id)?.name ?? id;
  }

  /** Compact description of what an event changed. */
  effectSummary(effects: Effect[], brief: boolean): string {
    const rel = new Map<string, string[]>();
    const other: string[] = [];
    for (const e of effects) {
      switch (e.kind) {
        case "relationship": {
          if (brief && e.dim !== "familiarity" && e.dim !== "warmth") continue;
          const k = `${this.world.characters[e.from]?.name}->${this.world.characters[e.to]?.name}`;
          const list = rel.get(k) ?? [];
          list.push(`${DIM_SHORT[e.dim]} ${signed(e.delta)}`);
          rel.set(k, list);
          break;
        }
        case "money":
          if (!brief)
            other.push(
              `${this.world.characters[e.who]?.name} ${e.delta > 0 ? "+" : "-"}${this.money(Math.abs(e.delta))}`,
            );
          break;
        case "mood":
          if (!brief)
            other.push(`${this.world.characters[e.who]?.name} mood ${signed(Math.round(e.delta))}`);
          break;
        case "memory":
          if (!brief) other.push(`${this.world.characters[e.who]?.name} will remember this`);
          break;
        case "flag":
          other.push(`${this.world.characters[e.who]?.name} gained "${e.flag}"`);
          break;
        case "knows_location":
          other.push(
            `${this.world.characters[e.who]?.name} now knows the way to ${this.place(e.locationId)}`,
          );
          break;
        case "debt":
          if (e.status === "open") other.push(`debt ${this.money(e.amount)} recorded`);
          break;
        case "goal":
          other.push(`${this.world.characters[e.who]?.name} achieved goal "${e.goalId}"`);
          break;
        default:
          break;
      }
    }
    const relText = [...rel.entries()].map(([k, v]) => `${k} ${v.join(", ")}`);
    return [...relText, ...other].join("; ");
  }

  private renderRumour(ev: LedgerEvent): string[] {
    const d = ev.data;
    const speaker = String(d.speaker);
    const listener = String(d.listener);
    const subject = String(d.subject);
    const said = this.text.line(
      `rumour.${String(d.memoryKind)}`,
      {
        subject: this.world.characters[subject]?.name ?? subject,
        place: this.place(d.place ? String(d.place) : null),
      },
      ev.id,
    );
    const orig = getEvent(this.world, String(d.originalEventId));
    const when = `Day ${dayNumber(orig.tick)} ${formatClock(minuteOfDay(orig.tick))}`;
    if (listener === this.opts.playerCharId) {
      return [
        `      >> You heard some gist from ${this.name(speaker)}: "${said}"  (about ${when})`,
      ];
    }
    return [
      `      >> gist: ${this.name(speaker)} told ${this.name(listener)} about ${this.name(subject)}: "${said}"`,
    ];
  }

  private renderQuest(ev: LedgerEvent): string[] {
    const d = ev.data;
    const def = getQuestDef(this.world, String(d.questId));
    const who = this.name(ev.actors[0]);
    const step = def.steps.find((s) => s.id === String(d.next ?? d.stepId));
    const title = this.questTitle(def.title, d.bindings, ev);
    switch (ev.type) {
      case "quest_started":
        return [
          `  * QUEST (${def.kind}) started for ${who}: "${title}"${step ? ` -> ${step.objective}` : ""}`,
        ];
      case "quest_step":
        return [
          `  * QUEST "${title}": step "${String(d.completedStep)}" done${step ? ` -> next: ${step.objective}` : ` -> ${String(d.next)}`}`,
        ];
      case "quest_check":
        return [
          `  * QUEST "${title}": attempt ${String(d.attempt)}/${String(d.maxAttempts)} at "${String(d.check)}" (${String(d.chance)}% chance): ${d.success ? "SUCCESS" : "not this time"}`,
        ];
      case "quest_completed":
        return [`  * QUEST COMPLETED: "${title}"  [${this.effectSummary(ev.effects, false)}]`];
      case "quest_failed":
        return [
          `  * QUEST FAILED (${String(d.reason)}): "${title}"  [${this.effectSummary(ev.effects, false)}]`,
        ];
      default:
        return [];
    }
  }

  private questTitle(title: string, _bindings: unknown, ev: LedgerEvent): string {
    const inst = this.world.quests.find((q) => q.instanceId === String(ev.data.instanceId));
    const creditor = inst?.bindings.creditor;
    return creditor ? `${title} (${this.world.characters[creditor]?.name})` : title;
  }

  private renderSettlement(ev: LedgerEvent): string[] {
    if (!this.involvesPlayer(ev) && !this.opts.verbose) return [];
    const d = ev.data;
    const c = getChar(this.world, ev.actors[0]!);
    const money = ev.effects.find((e) => e.kind === "money");
    const balance = money && money.kind === "money" ? money.value : c.needs.money;
    const spent = Number(d.fares) + Number(d.meals) + Number(d.drinks) + Number(d.homeMeal);
    return [
      `  End of day for ${this.name(c.id)}: earned ${this.money(Number(d.income))}, spent ${this.money(spent)} (fares ${this.money(Number(d.fares))}, food out ${this.money(Number(d.meals))}, drinks ${this.money(Number(d.drinks))}, home meal ${this.money(Number(d.homeMeal))})${d.wentHungry ? ", went to bed hungry" : ""}. Balance ${this.money(balance)}.`,
    ];
  }
}

export function dayOfTick(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY) + 1;
}

export const HOUR_TICKS = 60 / TICK_MINUTES;
