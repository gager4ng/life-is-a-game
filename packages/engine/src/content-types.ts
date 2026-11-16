/**
 * The content contract: everything the engine needs to know about a region, its places,
 * people and quests. Content is pure data. Adding a region (Abuja, Port Harcourt, Kano…)
 * means adding data that satisfies these types; the engine never changes.
 */

export const TRAITS = [
  "sociable",
  "shy",
  "generous",
  "stingy",
  "playful",
  "no_nonsense",
  "warm",
  "hot_tempered",
  "prepared",
  "competitive",
  "ambitious",
  "curious",
  "talkative",
  "shrewd",
  "football_fan",
  "talented",
  "proud",
  "night_owl",
  "early_riser",
] as const;
export type TraitId = (typeof TRAITS)[number];

export const LOCATION_TYPES = [
  "home",
  "workplace",
  "market",
  "buka",
  "transport_hub",
  "music_venue",
  "school",
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const WEATHER_KINDS = ["dry", "rain", "heavy_rain", "harmattan"] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

export const OPPORTUNITY_KINDS = ["gig_lead", "business_tip", "job_contact"] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

export const TONES = ["friendly", "firm", "funny", "walk_away"] as const;
export type Tone = (typeof TONES)[number];

export const REL_DIMS = ["trust", "familiarity", "respect", "warmth", "tension"] as const;
export type RelDim = (typeof REL_DIMS)[number];

/** Relative weights for the kind of day: dry, a rain shower day, a heavy-rain day, or harmattan. */
export type ClimateWeights = Record<WeatherKind, number>;

export interface Prices {
  transportFare: number;
  mealOut: number;
  mealHome: number;
  drink: number;
}
export type PriceKey = keyof Prices;

export interface RegionDef {
  id: string;
  name: string;
  areas: { id: string; name: string }[];
  /** Twelve entries, January first. */
  climate: ClimateWeights[];
  prices: Prices;
}

export interface OpeningHours {
  /** "HH:MM" */
  open: string;
  /** "HH:MM"; "24:00" allowed. If close < open the place is open across midnight. */
  close: string;
}

export interface LocationDef {
  id: string;
  regionId: string;
  areaId: string;
  name: string;
  type: LocationType;
  /** null = always open */
  hours: OpeningHours | null;
  capacity: number;
  outdoor: boolean;
}

/** "home" and "work" resolve to the character's own home / workplace. */
export type LocationRef = string;

export interface RoutineSlotDef {
  /** Slot starts at this time and lasts until the next slot starts (or midnight). */
  from: string;
  at: LocationRef;
  activity: string;
}

export interface RoutineVariationDef {
  id: string;
  /** 0..1, rolled once per day when the variation applies. */
  chance: number;
  days: "weekday" | "weekend" | "any";
  onlyIfRainy?: boolean;
  /** Only possible once the character holds this flag (e.g. after getting a gig lead). */
  requiresFlag?: string;
  from: string;
  to: string;
  at: LocationRef;
  activity: string;
}

export interface GoalDef {
  id: string;
  kind: "seek_opportunity" | "learn_place" | "save_money";
  opportunity?: OpportunityKind;
  location?: string;
  amount?: number;
  priority: number;
}

export interface OfferDef {
  id: string;
  kind: OpportunityKind;
  grantsFlag: string;
  revealsLocation?: string;
  /** Below this trust (their trust in the asker) they are reluctant. */
  minTrust: number;
  /** How many people they will ever pass this on to. */
  uses: number;
}

export interface JobDef {
  title: string;
  workplaceId: string;
  dailyIncome: [number, number];
}

export const SKIN_TONES = 6;
export const HAIRSTYLES = ["low_cut", "afro", "braids", "locs", "bald", "bun", "twists"] as const;
export const HEADWEAR = ["none", "gele", "cap", "fila", "headscarf"] as const;
export const OUTFITS = ["tshirt", "shirt", "kaftan", "dress", "blouse_wrapper", "suit"] as const;

/** How a character looks, for drawing only (the simulation never reads it). */
export interface CharacterLook {
  /** 0 (lightest) .. SKIN_TONES-1 (deepest). */
  skin: number;
  build: "slim" | "average" | "broad";
  hair: (typeof HAIRSTYLES)[number];
  headwear: (typeof HEADWEAR)[number];
  outfit: (typeof OUTFITS)[number];
  /** "#rrggbb" colours for the main garment, the lower garment and a detail. */
  colors: { top: string; bottom: string; accent: string };
}

export interface CharacterDef {
  id: string;
  name: string;
  shortName: string;
  regionId: string;
  homeId: string;
  job: JobDef | null;
  /** Short description for journals, e.g. "danfo conductor". */
  role: string;
  traits: TraitId[];
  items: string[];
  start: { energy: number; money: number; mood: number };
  /** Places they already know how to reach (home and workplace are always known). */
  knownLocations: string[];
  routine: {
    weekday: RoutineSlotDef[];
    weekend: RoutineSlotDef[];
    variations: RoutineVariationDef[];
  };
  goals: GoalDef[];
  offers: OfferDef[];
  /** Whether a human player may control this character. */
  playable: boolean;
  look?: CharacterLook;
}

export interface RelationshipSeed {
  from: string;
  to: string;
  /** If true the same values are applied in both directions. */
  mutual: boolean;
  trust: number;
  familiarity: number;
  respect: number;
  warmth: number;
  tension: number;
}

// ---------------------------------------------------------------------------
// Quests: declarative conditions, steps and branches evaluated by rules.
// Strings beginning with "$" are bindings (e.g. "$creditor").
// ---------------------------------------------------------------------------

export type Condition =
  | { type: "all"; of: Condition[] }
  | { type: "any"; of: Condition[] }
  | { type: "not"; of: Condition }
  | { type: "has_flag"; flag: string }
  | { type: "money_at_least"; amount: number }
  | {
      type: "relationship";
      /** The other character; their view of the player is checked. */
      with: string;
      dim: RelDim;
      atLeast?: number;
      atMost?: number;
    }
  | { type: "at_location"; location: string }
  | { type: "time_between"; from: string; to: string }
  | { type: "present"; character: string }
  | { type: "day_at_least"; day: number }
  | { type: "owes_money"; to?: string }
  | { type: "debt_repaid"; debt: string }
  | { type: "weather"; is: WeatherKind[] }
  | { type: "world_event_active"; id: string }
  | { type: "knows_location"; location: string };

export interface QuestEffects {
  money?: number;
  mood?: number;
  flags?: string[];
  relationships?: { with: string; dim: RelDim; delta: number }[];
  revealLocation?: string;
}

/** "complete", "fail", or a step id. */
export type Goto = string;

export interface ChanceSpec {
  base: number;
  traits?: Partial<Record<TraitId, number>>;
  relationship?: { with: string; dim: RelDim; per: number };
  moodAbove?: { value: number; bonus: number };
  energyBelow?: { value: number; penalty: number };
  min: number;
  max: number;
}

export interface ConditionStepDef {
  id: string;
  kind: "condition";
  objective: string;
  completeWhen: Condition;
  effects?: QuestEffects;
  /** First branch whose `when` holds (or has no `when`) is taken. */
  next: { when?: Condition; goto: Goto }[];
}

export interface CheckStepDef {
  id: string;
  kind: "check";
  objective: string;
  attemptWhen: Condition;
  chance: ChanceSpec;
  maxAttempts: number;
  retryAfterTicks: number;
  effects?: QuestEffects;
  onSuccess: Goto;
  onFailure: Goto;
  onExhausted: Goto;
}

export type QuestStepDef = ConditionStepDef | CheckStepDef;

export interface QuestDef {
  id: string;
  kind: "main" | "side" | "emergent";
  title: string;
  summary: string;
  /** Emergent quests can bind world facts, e.g. "debt" binds $debt and $creditor. */
  bind?: "debt";
  repeatable: boolean;
  prerequisites: Condition[];
  deadline?: { day?: number; daysAfterStart?: number };
  failWhen: Condition[];
  startStep: string;
  steps: QuestStepDef[];
  rewards: QuestEffects;
  failurePenalty: QuestEffects;
}

export interface WorldEventDef {
  id: string;
  name: string;
  kind: string;
  /** null = applies everywhere. */
  regionId: string | null;
  /** Inclusive day numbers counted from the world's start (day 1). */
  fromDay: number;
  toDay: number;
  /** Multipliers on regional prices. */
  prices?: Partial<Record<PriceKey, number>>;
  moodDelta?: number;
  routineOverrides?: {
    who: { all?: boolean; traits?: TraitId[]; ids?: string[] };
    from: string;
    to: string;
    at: LocationRef;
    activity: string;
  }[];
  crowdBoost?: { locationId: string; factor: number }[];
}

/** A tile coordinate [x, y] on a region's street grid. */
export type Tile = [number, number];

/** Where a location sits on the street grid. `door` is the walkable tile people go to. */
export interface MapPlace {
  locationId: string;
  /** Full area of the place (building plus yard), in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
  door: Tile;
  /** The roofed part, if the place is not all building (drawing only). */
  building?: { x: number; y: number; w: number; h: number };
}

/** A place beyond the edge of the map, reached by a ride from an on-map place. */
export interface OffMapPlace {
  locationId: string;
  via: string;
  rideMinutes: number;
}

/**
 * A region's street grid. Tile codes: `s` sidewalk, `z` zebra crossing, `p` paved yard,
 * `g` grass, `R` road (walkable but avoided), `#` building lot, `~` water (both blocked).
 */
export interface RegionMap {
  regionId: string;
  /** Walking minutes per tile. */
  minutesPerTile: number;
  tiles: string[];
  places: MapPlace[];
  offMap: OffMapPlace[];
}

export interface ContentBundle {
  regions: RegionDef[];
  /** Street grids. A region without one has fixed 10-minute trips. */
  maps: RegionMap[];
  locations: LocationDef[];
  characters: CharacterDef[];
  relationships: RelationshipSeed[];
  quests: QuestDef[];
  worldEvents: WorldEventDef[];
}
