# Decision log

Each decision has an ID (G-001, G-002, …). Newest at the bottom.

## G-001: Stack

**Date:** 2026-11-16 · **Status:** accepted

- pnpm workspaces + Turborepo, Node 24 LTS (`.nvmrc`), TypeScript strict
  (`noUncheckedIndexedAccess` on), Vitest, ESLint (flat config, typescript-eslint) + Prettier.
- **TypeScript is pinned to 5.9.** TypeScript 7 is out, but typescript-eslint supports only
  `<6.1`. Revisit when typescript-eslint supports 7.
- Packages: `@liag/engine` (pure logic), `@liag/content` (data + zod schemas), `@liag/sim` (CLI).
- Internal packages export their TypeScript source ("just-in-time" packages). Vitest, tsx and the
  type checker read source directly, so nothing needs building first. `build` still compiles
  engine and content with `tsc` (catches standalone compile errors, emits declarations). The CLI
  is bundled with esbuild into one `apps/sim/dist/cli.js`.
- zod 4 validates content at load time; the engine owns the TypeScript content contract
  (`content-types.ts`) and the content package checks its data against it at compile time.
- Tests run in one forked worker, files in sequence, with `isolate: false`, and Turborepo runs
  test tasks with `--concurrency=1`. The full suite (36 tests, including a 30-day soak) takes about
  a second per package.
- CI (GitHub Actions): install → format check → lint → typecheck → test → build → 3-day smoke run.

## G-002: Determinism

**Date:** 2026-11-16 · **Status:** accepted

- One seedable RNG (mulberry32). Its whole state is one uint32 stored in the world, so saving
  the world also saves the random stream.
- World clock in 10-minute ticks (144 per day). The calendar is pure arithmetic from a start date
  and never reads the wall clock.
- Everything iterates in a fixed order (sorted ids). No `Map`/`Set` in saved state. State is plain
  JSON.
- ESLint bans `Math.random`, `Date.now`, `new Date()`, `console`, `process` and Node imports
  inside `packages/engine/src`. The engine tsconfig has `types: []` and no DOM lib, so I/O APIs
  don't even type-check.
- **Chance only acts inside believable conditions:** rules decide eligibility first (both awake,
  same place, someone has an umbrella, it is actually raining, the place is open). Only then is a
  probability rolled, and that probability is itself computed from traits, relationships, needs,
  weather and crowding.
- Player inputs (replies, "go somewhere") are recorded as ledger events, so the same seed and
  the same inputs reproduce the same world. Tests check this byte-for-byte on `saveWorld` output.

## G-003: Event ledger design

**Date:** 2026-11-16 · **Status:** accepted

- Append-only array in the world. Ids are sequential (`e1`, `e2`, …); `seq` equals position.
- Every event has: id, tick, type, actors, location, `causes` (ids of earlier events) and
  `effects` (what changed), plus small `data` for rendering.
- `appendEvent` rejects any event other than `world_created` that has no causes, and any cause
  that is not strictly earlier. So every event traces back to the world's creation (tested).
- Cause chains are concrete: an encounter cites both people's `arrived` events, any rain `delayed`
  event holding them there, the `weather_changed` event if the weather mattered, the need that
  drove it (e.g. `short_of_money`), and any world event that crowded the place. Arrivals cite the
  day's `day_planned` (which cites the world events and flags that shaped it) or the player's
  `player_choice`/`player_intent`.
- Effects record the change **actually applied** after clamping, plus the resulting value.
  Money and relationship changes happen **only** through ledgered effects. A test replays the
  ledger from the starting content and must arrive at the exact current money and relationship
  values.
- Continuous per-tick drift (energy draining, mood easing back to normal, getting wet) is not
  ledgered. It would add thousands of events with no story value. Anything that happens _to_ a
  character (encounters, trekking home, going hungry, quest results) is ledgered.
- A 30-day Lagos run is about 3,800 events and about 2.5 MB of JSON. Compaction can come later if
  needed.

## G-004: Multiplayer-ready model

**Date:** 2026-11-16 · **Status:** accepted

- `world.players` maps a `playerId` to the character it controls. Any number of players.
  Characters controlled by players have `controlledBy = playerId`. Everyone else is computer-run.
- An encounter lists the characters still `awaiting` a human reply. NPC replies are computed at
  once. `stepTick` refuses to advance while a human reply is outstanding, so the world never
  moves on without the player. Two players in one encounter each answer independently, and the
  outcome cites both `player_replied` events.
- A player can be put on **autopilot**. The engine then answers for them with the same rules it
  uses for computer-run characters, and steers them towards their active quest steps. The
  unattended CLI run uses this.
- The API is transport-agnostic: `stepTick`, `pendingChoices(playerId)`,
  `chooseReply(playerId, encounterId, option)`, `setPlayerDestination(playerId, place)`. A future
  server can drive the same calls for real players nearby. The CLI uses one player for now.

## G-005: Content is validated data; text is kept out of the engine

**Date:** 2026-11-16 · **Status:** accepted

- Each region is a "region pack" JSON file (region, locations, characters, relationships) plus
  a dialogue file. Adding Abuja, Port Harcourt or Kano means adding those files and listing them
  in `packages/content/src/index.ts`. The engine doesn't change. A test builds a bundle with a
  second region, and the engine fixture runs two regions with separate weather.
- Every content file carries `$meta.status` (`PLACEHOLDER` | `APPROVED`). Everything is
  `PLACEHOLDER` until the owner approves it. A test fails if anything claims to be approved, so
  approving text is a deliberate edit. The CLI prefixes placeholder speech with `[PH]`.
- The engine never produces prose. It emits dialogue **keys** (e.g. `help.umbrella.ask.funny`)
  and the CLI renders them from the content bank, picking a variant by hashing the event id. A
  future AI phraser could replace this rendering step without touching facts.
- Referential checks the schema can't express (ids exist, homes are homes, quest gotos point at
  real steps) live in the engine's `validateContentRefs`, so both content loading and
  `createWorld` reject broken data.

## G-006: Encounters are decided by rules ("Collision of Worlds")

**Date:** 2026-11-16 · **Status:** accepted

- Each tick, awake and free characters are grouped by location. Two passes:
  1. **Needs-driven.** Someone stranded without the fare, short of food money, getting soaked
     without an umbrella, lost, or chasing a goal (gig lead, business tip, job contact) looks for
     the best-placed person present (who must actually be able to help). Chance is weighted by
     familiarity, shyness, pride, ambition and the kind of place.
  2. **Passing.** Pairs may greet or chat. The chance depends on place type, familiarity, traits,
     energy, mood, heavy rain (huddling), night, crowding and world-event crowd boosts.
- Three encounter types: passing (small talk), practical help (umbrella, transport money, food
  money, directions) and opportunity (gig lead, business tip, job contact).
- Computer-run characters can refuse. Hard rules come first: they can't afford it, they're a
  competitive rival for the same break, they're exhausted. Then a willingness score from
  relationship, traits, how they were asked (tone vs. personality), memories of the asker and
  their own needs, with ±10 noise. Players choose 2–4 tones (friendly, firm, funny, walk away),
  plus "pay back" when they owe the other person and can afford it.
- Rain delays departures (heavy rain nearly always, light rain sometimes, less with an umbrella).
  That is what creates crowded danfo parks and unexpected meetings.
- Cooldowns stop the same pair repeating the same kind of encounter too often.

## G-007: Memory, rumours and independent lives

**Date:** 2026-11-16 · **Status:** accepted

- Significant encounters leave memories with importance (1–100) and a strength that fades daily
  (important ones fade slower). Faint memories are forgotten, and each character keeps at most 40.
- In a chat, a computer-run character may pass on a first-hand memory about a third person
  (helped me, refused me, gave me a lead, paid me back, still owes me). The listener gets a
  weaker second-hand memory, which is never passed on again, and their view of that person
  shifts. This is how the player hears about things that happened without them.
- The world runs the same whether or not a player is present. NPCs lend, borrow, repay, get leads
  and gossip among themselves. A goal achieved can unlock new routine variations (e.g. Ada
  performing once she has a gig lead).

## G-008: Quests are declarative state machines

**Date:** 2026-11-16 · **Status:** accepted

- Quests are data. Each has prerequisites, steps, an optional deadline (fixed day or days after
  start), fail conditions, rewards and a failure penalty.
- Two step kinds: `condition` (complete when a condition holds, then take the first matching
  branch) and `check` (a skill check that can be attempted when its condition holds, with a
  chance from traits, relationships, mood and energy, a retry delay, max attempts, and gotos for
  success, failure and exhaustion).
- Conditions are a small fixed vocabulary (flags, money, relationship thresholds, place, time,
  who is present, day, debts, weather, world events, known places) combined with
  `all`/`any`/`not`. Each evaluation returns the ledger ids that made it true, which become the
  quest event's causes.
- Kinds: main (starts at once), side (starts when prerequisites hold) and emergent (binds world
  facts). The emergent "Pay back what you owe" binds `$debt`/`$creditor`, so it only appears when
  the player actually borrowed money from someone.

## G-009: Money and the day's economy

**Date:** 2026-11-16 · **Status:** accepted

- Spending is committed during the day (fares when boarding at a danfo park, meals at a buka,
  drinks at a venue) and only if affordable. Otherwise the character is "short of money", which
  becomes a need. Wages and spending settle in one `day_settled` event per character at 23:50.
- "Available" money = money − today's committed spending. Loans, repayments and quest fees use
  available money, so money never goes negative (checked as an invariant).
- Loans create debts. Computer-run debtors repay when they meet the lender and can afford it.
  After 5 days an unpaid debt becomes overdue, sours the lender's view and becomes gossip.

## G-010: World events from a JSON file

**Date:** 2026-11-16 · **Status:** accepted

- World events (football night, fuel price rise, festival…) are loaded from JSON
  (`packages/content/src/data/world-events.json`, or `--events <file>`). They stand in for the
  future admin-approved daily news feed.
- They are keyed by day number relative to the world start (`fromDay`/`toDay`) and can multiply
  prices, nudge mood, override routines for matching characters (by trait, id or everyone) and
  boost crowding at places. Starting and ending are ledger events, and they are cited by the plans,
  arrivals, settlements and encounters they influence.
- When the real feed arrives, an adapter can convert dated news items into this shape.

## G-011: Save format

**Date:** 2026-11-16 · **Status:** accepted

- A save is the whole `World` as JSON: content snapshot, RNG state, clock, characters,
  relationships, quests, debts and the full ledger. It is versioned (`version: 1`). `loadWorld`
  rejects unknown versions.
- Saves are self-contained (content is copied in), so a save keeps working after content files
  change. Content migration is a later concern.

## G-012: Default start date in the rainy season

**Date:** 2026-11-16 · **Status:** accepted

- Day 1 defaults to Monday 1 June 2026. Lagos weather is rolled from monthly climate weights, and
  June is wet, so rain-driven collisions show up in short runs. `--start 2026-12-07` gives
  harmattan days instead.

<!-- Next free ID: G-013 -->
