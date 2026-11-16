import type {
  CharacterDef,
  ContentBundle,
  QuestDef,
  RegionDef,
  RegionMap,
} from "../src/content-types";

/**
 * A tiny, fully controlled world for unit tests. Two regions on purpose: the second one is
 * plain data, proving a new region needs no engine change.
 */
const dryAllYear = Array.from({ length: 12 }, () => ({
  dry: 1,
  rain: 0,
  heavy_rain: 0,
  harmattan: 0,
}));
const wetAllYear = Array.from({ length: 12 }, () => ({
  dry: 0,
  rain: 0,
  heavy_rain: 1,
  harmattan: 0,
}));

const region = (id: string, climate = dryAllYear): RegionDef => ({
  id,
  name: id,
  areas: [{ id: "centre", name: "Centre" }],
  climate,
  prices: { transportFare: 500, mealOut: 1500, mealHome: 700, drink: 1000 },
});

const sameDay = [
  { from: "00:00", at: "home", activity: "sleep" },
  { from: "07:00", at: "t_park", activity: "hustle" },
  { from: "12:00", at: "t_buka", activity: "lunch" },
  { from: "14:00", at: "home", activity: "rest" },
  { from: "22:00", at: "home", activity: "sleep" },
];

function person(id: string, over: Partial<CharacterDef> = {}): CharacterDef {
  return {
    id,
    name: id,
    shortName: id,
    regionId: "testville",
    homeId: "t_home",
    role: "tester",
    job: null,
    traits: [],
    items: [],
    start: { energy: 80, money: 5000, mood: 60 },
    knownLocations: ["t_park", "t_buka", "t_venue"],
    routine: { weekday: sameDay, weekend: sameDay, variations: [] },
    goals: [],
    offers: [],
    playable: false,
    ...over,
  };
}

const neverFlag = { type: "has_flag", flag: "never" } as const;

export const QUESTS: QuestDef[] = [
  {
    id: "tq_branch",
    kind: "main",
    title: "Branching test",
    summary: "",
    repeatable: false,
    prerequisites: [],
    failWhen: [{ type: "has_flag", flag: "bad" }],
    startStep: "lead",
    steps: [
      {
        id: "lead",
        kind: "condition",
        objective: "",
        completeWhen: {
          type: "any",
          of: [
            { type: "has_flag", flag: "lead:venue" },
            { type: "has_flag", flag: "lead:duet" },
          ],
        },
        next: [{ when: { type: "has_flag", flag: "lead:duet" }, goto: "duet" }, { goto: "venue" }],
      },
      {
        id: "venue",
        kind: "condition",
        objective: "",
        completeWhen: { type: "has_flag", flag: "done" },
        effects: { money: 1000 },
        next: [{ goto: "complete" }],
      },
      {
        id: "duet",
        kind: "check",
        objective: "",
        attemptWhen: { type: "has_flag", flag: "lead:duet" },
        chance: { base: 0, min: 0, max: 0 },
        maxAttempts: 2,
        retryAfterTicks: 0,
        onSuccess: "complete",
        onFailure: "duet",
        onExhausted: "fail",
      },
    ],
    rewards: { money: 5000, flags: ["rewarded"] },
    failurePenalty: { mood: -10 },
  },
  {
    id: "tq_deadline",
    kind: "side",
    title: "Deadline test",
    summary: "",
    repeatable: false,
    prerequisites: [{ type: "has_flag", flag: "start_deadline" }],
    deadline: { daysAfterStart: 1 },
    failWhen: [],
    startStep: "wait",
    steps: [
      {
        id: "wait",
        kind: "condition",
        objective: "",
        completeWhen: neverFlag,
        next: [{ goto: "complete" }],
      },
    ],
    rewards: {},
    failurePenalty: { mood: -5 },
  },
  {
    id: "tq_debt",
    kind: "emergent",
    title: "Debt test",
    summary: "",
    bind: "debt",
    repeatable: true,
    prerequisites: [{ type: "owes_money", to: "$creditor" }],
    deadline: { daysAfterStart: 3 },
    failWhen: [],
    startStep: "repay",
    steps: [
      {
        id: "repay",
        kind: "condition",
        objective: "",
        completeWhen: { type: "debt_repaid", debt: "$debt" },
        next: [{ goto: "complete" }],
      },
    ],
    rewards: { relationships: [{ with: "$creditor", dim: "respect", delta: 3 }] },
    failurePenalty: {},
  },
];

/**
 * Testville's street grid. Doors: home (1,3), buka (5,1), park (9,3), venue (5,5).
 * Home to park is 8 tiles = 20 minutes = 2 ticks; home to buka is 6 tiles = 15 min = 2 ticks.
 */
export const TESTVILLE_MAP: RegionMap = {
  regionId: "testville",
  minutesPerTile: 2.5,
  tiles: [
    "###########",
    "#sssssssss#",
    "#s###R###s#",
    "#sssssssss#",
    "#s###s###s#",
    "#sssssssss#",
    "###########",
  ],
  places: [
    { locationId: "t_home", x: 2, y: 2, w: 3, h: 1, door: [1, 3] },
    { locationId: "t_buka", x: 6, y: 0, w: 3, h: 1, door: [5, 1] },
    { locationId: "t_park", x: 6, y: 2, w: 3, h: 1, door: [9, 3] },
    { locationId: "t_venue", x: 6, y: 4, w: 3, h: 1, door: [5, 5] },
  ],
  offMap: [],
};

export function fixture(opts: { wet?: boolean } = {}): ContentBundle {
  return {
    regions: [region("testville", opts.wet ? wetAllYear : dryAllYear), region("otherland")],
    maps: [JSON.parse(JSON.stringify(TESTVILLE_MAP)) as RegionMap],
    locations: [
      {
        id: "t_home",
        regionId: "testville",
        areaId: "centre",
        name: "Home",
        type: "home",
        hours: null,
        capacity: 20,
        outdoor: false,
      },
      {
        id: "t_buka",
        regionId: "testville",
        areaId: "centre",
        name: "Buka",
        type: "buka",
        hours: { open: "06:00", close: "22:00" },
        capacity: 20,
        outdoor: false,
      },
      {
        id: "t_park",
        regionId: "testville",
        areaId: "centre",
        name: "Park",
        type: "transport_hub",
        hours: null,
        capacity: 50,
        outdoor: true,
      },
      {
        id: "t_venue",
        regionId: "testville",
        areaId: "centre",
        name: "Venue",
        type: "music_venue",
        hours: { open: "16:00", close: "24:00" },
        capacity: 20,
        outdoor: false,
      },
      {
        id: "o_home",
        regionId: "otherland",
        areaId: "centre",
        name: "Other home",
        type: "home",
        hours: null,
        capacity: 5,
        outdoor: false,
      },
    ],
    characters: [
      person("t_player", {
        playable: true,
        goals: [{ id: "gig", kind: "seek_opportunity", opportunity: "gig_lead", priority: 3 }],
      }),
      person("t_friend", { playable: true, traits: ["warm"] }),
      person("t_giver", {
        traits: ["generous", "warm"],
        items: ["umbrella"],
        offers: [
          {
            id: "slot",
            kind: "gig_lead",
            grantsFlag: "lead:venue",
            revealsLocation: "t_venue",
            minTrust: 0,
            uses: 1,
          },
        ],
      }),
      person("t_rival", {
        traits: ["competitive"],
        goals: [{ id: "gig", kind: "seek_opportunity", opportunity: "gig_lead", priority: 3 }],
        offers: [{ id: "duet", kind: "gig_lead", grantsFlag: "lead:duet", minTrust: 0, uses: 1 }],
      }),
      person("t_broke", { traits: ["generous"], start: { energy: 80, money: 0, mood: 60 } }),
      {
        ...person("o_person"),
        regionId: "otherland",
        homeId: "o_home",
        knownLocations: [],
        routine: {
          weekday: [
            { from: "00:00", at: "home", activity: "sleep" },
            { from: "08:00", at: "home", activity: "rest" },
          ],
          weekend: [{ from: "00:00", at: "home", activity: "sleep" }],
          variations: [],
        },
      },
    ],
    relationships: [
      {
        from: "t_player",
        to: "t_friend",
        mutual: true,
        trust: 20,
        familiarity: 30,
        respect: 10,
        warmth: 20,
        tension: 0,
      },
    ],
    quests: QUESTS,
    worldEvents: [],
  };
}
