import { z } from "zod";
import {
  LOCATION_TYPES,
  OPPORTUNITY_KINDS,
  REL_DIMS,
  TRAITS,
  WEATHER_KINDS,
  type Condition,
} from "@liag/engine";

/**
 * Every content file carries a $meta block saying whether its player-facing text is
 * placeholder or approved. Nothing is APPROVED until the owner signs it off.
 */
export const MetaSchema = z.object({
  status: z.enum(["PLACEHOLDER", "APPROVED"]),
  note: z.string(),
});

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "expected HH:MM");
const id = z.string().regex(/^[a-z0-9_]+$/, "ids are lower_snake_case");
const trait = z.enum(TRAITS);

const ClimateSchema = z.object({
  dry: z.number().min(0),
  rain: z.number().min(0),
  heavy_rain: z.number().min(0),
  harmattan: z.number().min(0),
});

const PricesSchema = z.object({
  transportFare: z.number().int().positive(),
  mealOut: z.number().int().positive(),
  mealHome: z.number().int().positive(),
  drink: z.number().int().positive(),
});

export const RegionSchema = z.object({
  id,
  name: z.string(),
  areas: z.array(z.object({ id, name: z.string() })).min(1),
  climate: z.array(ClimateSchema).length(12),
  prices: PricesSchema,
});

export const LocationSchema = z.object({
  id,
  regionId: id,
  areaId: id,
  name: z.string(),
  type: z.enum(LOCATION_TYPES),
  hours: z.object({ open: hhmm, close: hhmm }).nullable(),
  capacity: z.number().int().positive(),
  outdoor: z.boolean(),
});

const SlotSchema = z.object({ from: hhmm, at: z.string(), activity: z.string() });

const VariationSchema = z.object({
  id,
  chance: z.number().min(0).max(1),
  days: z.enum(["weekday", "weekend", "any"]),
  onlyIfRainy: z.boolean().optional(),
  requiresFlag: z.string().optional(),
  from: hhmm,
  to: hhmm,
  at: z.string(),
  activity: z.string(),
});

export const CharacterSchema = z.object({
  id,
  name: z.string(),
  shortName: z.string(),
  regionId: id,
  homeId: id,
  role: z.string(),
  job: z
    .object({
      title: z.string(),
      workplaceId: id,
      dailyIncome: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    })
    .nullable(),
  traits: z.array(trait),
  items: z.array(z.string()),
  start: z.object({
    energy: z.number().min(0).max(100),
    money: z.number().int().nonnegative(),
    mood: z.number().min(0).max(100),
  }),
  knownLocations: z.array(id),
  routine: z.object({
    weekday: z.array(SlotSchema).min(1),
    weekend: z.array(SlotSchema).min(1),
    variations: z.array(VariationSchema),
  }),
  goals: z.array(
    z.object({
      id,
      kind: z.enum(["seek_opportunity", "learn_place", "save_money"]),
      opportunity: z.enum(OPPORTUNITY_KINDS).optional(),
      location: id.optional(),
      amount: z.number().int().positive().optional(),
      priority: z.number(),
    }),
  ),
  offers: z.array(
    z.object({
      id,
      kind: z.enum(OPPORTUNITY_KINDS),
      grantsFlag: z.string(),
      revealsLocation: id.optional(),
      minTrust: z.number(),
      uses: z.number().int().positive(),
    }),
  ),
  playable: z.boolean(),
});

const bounded = (lo: number, hi: number) => z.number().int().min(lo).max(hi);

export const RelationshipSeedSchema = z.object({
  from: id,
  to: id,
  mutual: z.boolean(),
  trust: bounded(-100, 100),
  familiarity: bounded(0, 100),
  respect: bounded(-100, 100),
  warmth: bounded(-100, 100),
  tension: bounded(0, 100),
});

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("all"), of: z.array(ConditionSchema) }),
    z.object({ type: z.literal("any"), of: z.array(ConditionSchema) }),
    z.object({ type: z.literal("not"), of: ConditionSchema }),
    z.object({ type: z.literal("has_flag"), flag: z.string() }),
    z.object({ type: z.literal("money_at_least"), amount: z.number().int() }),
    z.object({
      type: z.literal("relationship"),
      with: z.string(),
      dim: z.enum(REL_DIMS),
      atLeast: z.number().optional(),
      atMost: z.number().optional(),
    }),
    z.object({ type: z.literal("at_location"), location: z.string() }),
    z.object({ type: z.literal("time_between"), from: hhmm, to: hhmm }),
    z.object({ type: z.literal("present"), character: z.string() }),
    z.object({ type: z.literal("day_at_least"), day: z.number().int().positive() }),
    z.object({ type: z.literal("owes_money"), to: z.string().optional() }),
    z.object({ type: z.literal("debt_repaid"), debt: z.string() }),
    z.object({ type: z.literal("weather"), is: z.array(z.enum(WEATHER_KINDS)) }),
    z.object({ type: z.literal("world_event_active"), id: z.string() }),
    z.object({ type: z.literal("knows_location"), location: z.string() }),
  ]),
) as z.ZodType<Condition>;

const EffectsSchema = z.object({
  money: z.number().int().optional(),
  mood: z.number().optional(),
  flags: z.array(z.string()).optional(),
  relationships: z
    .array(z.object({ with: z.string(), dim: z.enum(REL_DIMS), delta: z.number().int() }))
    .optional(),
  revealLocation: z.string().optional(),
});

const StepSchema = z.discriminatedUnion("kind", [
  z.object({
    id,
    kind: z.literal("condition"),
    objective: z.string(),
    completeWhen: ConditionSchema,
    effects: EffectsSchema.optional(),
    next: z.array(z.object({ when: ConditionSchema.optional(), goto: z.string() })).min(1),
  }),
  z.object({
    id,
    kind: z.literal("check"),
    objective: z.string(),
    attemptWhen: ConditionSchema,
    chance: z.object({
      base: z.number(),
      traits: z.partialRecord(trait, z.number()).optional(),
      relationship: z
        .object({ with: z.string(), dim: z.enum(REL_DIMS), per: z.number() })
        .optional(),
      moodAbove: z.object({ value: z.number(), bonus: z.number() }).optional(),
      energyBelow: z.object({ value: z.number(), penalty: z.number() }).optional(),
      min: z.number(),
      max: z.number(),
    }),
    maxAttempts: z.number().int().positive(),
    retryAfterTicks: z.number().int().nonnegative(),
    effects: EffectsSchema.optional(),
    onSuccess: z.string(),
    onFailure: z.string(),
    onExhausted: z.string(),
  }),
]);

export const QuestSchema = z.object({
  id,
  kind: z.enum(["main", "side", "emergent"]),
  title: z.string(),
  summary: z.string(),
  bind: z.literal("debt").optional(),
  repeatable: z.boolean(),
  prerequisites: z.array(ConditionSchema),
  deadline: z
    .object({
      day: z.number().int().positive().optional(),
      daysAfterStart: z.number().int().positive().optional(),
    })
    .optional(),
  failWhen: z.array(ConditionSchema),
  startStep: id,
  steps: z.array(StepSchema).min(1),
  rewards: EffectsSchema,
  failurePenalty: EffectsSchema,
});

export const WorldEventSchema = z.object({
  id,
  name: z.string(),
  kind: z.string(),
  regionId: id.nullable(),
  fromDay: z.number().int().positive(),
  toDay: z.number().int().positive(),
  prices: z
    .partialRecord(z.enum(["transportFare", "mealOut", "mealHome", "drink"]), z.number().positive())
    .optional(),
  moodDelta: z.number().optional(),
  routineOverrides: z
    .array(
      z.object({
        who: z.object({
          all: z.boolean().optional(),
          traits: z.array(trait).optional(),
          ids: z.array(id).optional(),
        }),
        from: hhmm,
        to: hhmm,
        at: z.string(),
        activity: z.string(),
      }),
    )
    .optional(),
  crowdBoost: z.array(z.object({ locationId: id, factor: z.number().positive() })).optional(),
});

/** One region's data: drop a new file like this in to add Abuja, Port Harcourt or Kano. */
export const RegionPackSchema = z.object({
  $meta: MetaSchema,
  region: RegionSchema,
  locations: z.array(LocationSchema),
  characters: z.array(CharacterSchema),
  relationships: z.array(RelationshipSeedSchema),
});

export const QuestFileSchema = z.object({ $meta: MetaSchema, quests: z.array(QuestSchema) });
export const WorldEventFileSchema = z.object({
  $meta: MetaSchema,
  events: z.array(WorldEventSchema),
});

/** Placeholder dialogue: key -> list of variants. Speaker lines use {vars}. */
export const DialogueFileSchema = z.object({
  $meta: MetaSchema,
  lines: z.record(z.string(), z.array(z.string()).min(1)),
});

export type RegionPack = z.infer<typeof RegionPackSchema>;
export type DialogueFile = z.infer<typeof DialogueFileSchema>;
