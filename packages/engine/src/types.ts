import type {
  ContentBundle,
  Tile,
  OpportunityKind,
  RelDim,
  Tone,
  TraitId,
  WeatherKind,
} from "./content-types";
import type { RngState } from "./rng";

export const WORLD_VERSION = 2;

export const REL_BOUNDS: Record<RelDim, readonly [number, number]> = {
  trust: [-100, 100],
  familiarity: [0, 100],
  respect: [-100, 100],
  warmth: [-100, 100],
  tension: [0, 100],
};

/** Directed: how `from` sees `to`. Each dimension is tracked and bounded separately. */
export interface Relationship {
  from: string;
  to: string;
  trust: number;
  familiarity: number;
  respect: number;
  warmth: number;
  tension: number;
  lastEventId: string;
}

export interface Needs {
  energy: number;
  /** Naira, whole numbers, never negative. */
  money: number;
  mood: number;
}

export type MemoryKind =
  | "met"
  | "helped_me"
  | "refused_me"
  | "i_helped"
  | "i_refused"
  | "got_lead"
  | "gave_lead"
  | "lent_money"
  | "repaid_me"
  | "failed_to_repay"
  | "heard_rumour";

export interface Memory {
  id: string;
  eventId: string;
  tick: number;
  kind: MemoryKind;
  /** The person the memory is mainly about. */
  subject: string;
  /** Everyone involved (subject included). */
  about: string[];
  /** -1 (bad) .. 1 (good), from the rememberer's point of view. */
  valence: number;
  importance: number;
  /** Starts at importance, decays daily; the memory is forgotten below a threshold. */
  strength: number;
  secondhand: boolean;
  /** For rumours: the kind of the original memory. */
  sourceKind: MemoryKind | null;
  /** People this memory has already been told to. */
  toldTo: string[];
  locationId: string | null;
}

export interface GoalState {
  id: string;
  kind: "seek_opportunity" | "learn_place" | "save_money";
  opportunity: OpportunityKind | null;
  location: string | null;
  amount: number | null;
  priority: number;
  status: "active" | "achieved";
  eventId: string;
}

export interface PlanSegment {
  /** minute of day, inclusive */
  from: number;
  /** minute of day, exclusive */
  to: number;
  locationId: string;
  activity: string;
  source: "routine" | "variation" | "world_event" | "closed_fallback";
  sourceId: string | null;
}

export interface ShortOfMoney {
  kind: "transport_money" | "chop_money";
  amount: number;
  locationId: string;
  eventId: string;
}

/** A trip in progress. People on the way are not at any place (no encounters on the move). */
export interface Travel {
  /** Where they set off from: a place, or a street spot. */
  from: { locationId: string } | { tile: Tile };
  /** Where they're going. */
  to: { locationId: string } | { tile: Tile };
  departTick: number;
  arriveTick: number;
  activity: string;
  /** Ledger ids the arrival will cite (the plan or choice that sent them, any rain delay). */
  causes: string[];
  source: string;
  sourceId: string | null;
}

export interface CharacterState {
  id: string;
  name: string;
  regionId: string;
  homeId: string;
  workplaceId: string | null;
  /** playerId of the controlling human, or null for a computer-run character. */
  controlledBy: string | null;
  traits: TraitId[];
  items: string[];

  /** The place they are at, or (while travelling or out on the street) the last place they left. */
  locationId: string;
  activity: string;
  /** Ledger id of the event that put them where they are. */
  arrivalEventId: string;
  /** Set while walking or riding between places. */
  travel: Travel | null;
  /** Set while standing on a street spot (players only), outside any place. */
  street: Tile | null;

  needs: Needs;
  lastMoneyEventId: string;

  memories: Memory[];
  /** flag -> ledger id of the event that set it */
  flags: Record<string, string>;
  /** locationId -> ledger id of the event through which they learned it */
  knownLocations: Record<string, string>;
  goals: GoalState[];
  /** offerId -> times given */
  offerUses: Record<string, number>;
  /** `${offerId}>${receiverId}` -> ledger id */
  offersGiven: Record<string, string>;

  plan: PlanSegment[];
  planEventId: string;
  /** A player's choice (or quest autopilot). `tile` set = a spot on the street. */
  override: {
    locationId: string;
    tile?: Tile;
    activity: string;
    untilTick: number;
    eventId: string;
  } | null;
  delay: { forLocation: string; untilTick: number; eventId: string | null } | null;
  /** A location they want to reach but don't know the way to. */
  seeking: { locationId: string; causeId: string } | null;
  shortOf: ShortOfMoney | null;
  shelteredUntil: number;
  busyUntil: number;
  today: { ticksWorked: number; trips: number; mealsOut: number; drinks: number };
}

export interface Debt {
  id: string;
  debtor: string;
  creditor: string;
  amount: number;
  createdTick: number;
  eventId: string;
  status: "open" | "repaid";
  overdue: boolean;
  settledEventId: string | null;
}

export type EncounterKind = "passing" | "help" | "opportunity";
export type EncounterSubtype =
  "small_talk" | "umbrella" | "transport_money" | "chop_money" | "directions" | OpportunityKind;

export type ReplyAction = "none" | "repay";

export interface EncounterReply {
  tone: Tone;
  action: ReplyAction;
  /** player_replied event, if a player chose it */
  eventId: string | null;
}

export interface Encounter {
  id: string;
  kind: EncounterKind;
  subtype: EncounterSubtype;
  tick: number;
  locationId: string;
  /** Who asks / starts. For passing encounters: the one who speaks first. */
  askerId: string;
  /** Who is asked / answers. */
  giverId: string;
  startEventId: string;
  /** character ids whose player has not replied yet */
  awaiting: string[];
  replies: Record<string, EncounterReply>;
  amount: number | null;
  targetLocation: string | null;
  /** Set when a content scene started it (scripted encounter). */
  scene?: string;
}

export type EncounterRole = "asker" | "giver" | "chat";

export interface ReplyOption {
  id: string;
  tone: Tone;
  action: ReplyAction;
  /** Key into the dialogue bank for the option label (text lives in content). */
  labelKey: string;
}

export interface PendingChoice {
  encounterId: string;
  playerId: string;
  characterId: string;
  otherId: string;
  role: EncounterRole;
  kind: EncounterKind;
  subtype: EncounterSubtype;
  locationId: string;
  amount: number | null;
  options: ReplyOption[];
  /** The content scene behind it, if scripted (null otherwise). */
  scene: string | null;
}

export interface QuestInstance {
  instanceId: string;
  questId: string;
  playerId: string;
  characterId: string;
  status: "active" | "completed" | "failed";
  stepId: string;
  startedTick: number;
  lastEventId: string;
  attempts: Record<string, number>;
  nextAttemptTick: number;
  bindings: Record<string, string>;
  deadlineTick: number | null;
}

export interface PlayerState {
  playerId: string;
  characterId: string;
  /** When true, the engine answers for this player using the character's own traits. */
  autopilot: boolean;
}

export interface DayWeather {
  base: "dry" | "harmattan";
  /** Rain spells, minutes of day [from, to). */
  windows: { from: number; to: number; heavy: boolean }[];
}

export interface RegionWeatherState {
  day: DayWeather;
  current: WeatherKind;
  setEventId: string;
  /** Ledger id of the event that produced the current weather. */
  eventId: string;
}

export type EventType =
  | "world_created"
  | "day_started"
  | "world_event_started"
  | "world_event_ended"
  | "weather_set"
  | "weather_changed"
  | "day_planned"
  | "arrived"
  | "delayed"
  | "short_of_money"
  | "went_without"
  | "encounter_started"
  | "player_replied"
  | "encounter_resolved"
  | "rumour_shared"
  | "debt_repaid"
  | "debt_overdue"
  | "day_settled"
  | "goal_achieved"
  | "player_choice"
  | "player_intent"
  | "quest_started"
  | "quest_step"
  | "quest_check"
  | "quest_completed"
  | "quest_failed";

export type Effect =
  | { kind: "relationship"; from: string; to: string; dim: RelDim; delta: number; value: number }
  | { kind: "money"; who: string; delta: number; value: number }
  | { kind: "mood"; who: string; delta: number; value: number }
  | { kind: "energy"; who: string; delta: number; value: number }
  | { kind: "memory"; who: string; memoryId: string; memoryKind: MemoryKind; subject: string }
  | { kind: "flag"; who: string; flag: string }
  | { kind: "knows_location"; who: string; locationId: string }
  | { kind: "location"; who: string; from: string; to: string }
  | { kind: "debt"; debtId: string; status: "open" | "repaid" | "overdue"; amount: number }
  | { kind: "goal"; who: string; goalId: string; status: "achieved" }
  | {
      kind: "quest";
      playerId: string;
      instanceId: string;
      questId: string;
      status: QuestInstance["status"];
      stepId: string;
    };

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface DialogueLine {
  speaker: string;
  key: string;
}

export interface LedgerEvent {
  id: string;
  seq: number;
  tick: number;
  type: EventType;
  actors: string[];
  location: string | null;
  /** Ids of earlier events that led to this one. Only world_created has none. */
  causes: string[];
  effects: Effect[];
  data: { [key: string]: JsonValue };
}

export interface World {
  version: typeof WORLD_VERSION;
  seed: string;
  rng: RngState;
  /** The next tick to be simulated. */
  tick: number;
  /** ISO date of day 1, "YYYY-MM-DD". */
  startDate: string;
  content: ContentBundle;
  rootEventId: string;
  dayEventId: string;
  regionWeather: Record<string, RegionWeatherState>;
  characters: Record<string, CharacterState>;
  relationships: Record<string, Relationship>;
  players: Record<string, PlayerState>;
  /** Encounters still waiting on a player's reply. */
  encounters: Encounter[];
  quests: QuestInstance[];
  debts: Debt[];
  /** world event id -> ledger id of its world_event_started event */
  activeWorldEvents: Record<string, string>;
  /** `${a}|${b}|${subtype}` -> tick from which they may have that kind of encounter again */
  cooldowns: Record<string, number>;
  ledger: LedgerEvent[];
  counters: { encounter: number; memory: number; debt: number; quest: number };
}
