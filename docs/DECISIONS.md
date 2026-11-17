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

## G-013: Travel takes time, on a street grid

**Date:** 2026-11-16 · **Status:** accepted · Roadmap step 2

- Each region may have a street grid (`packages/content/src/regions/<region>/map.json`): rows of tile
  codes (sidewalk, zebra crossing, yard, grass, road, building lot, water), where each place sits
  (its area, its roofed part, its door tile) and which places are off the map (the Island office is
  reached by a 50-minute danfo ride from the park). Yaba is hand-made for now, 44 × 36 tiles; an
  OpenStreetMap import can replace the data later without engine changes.
- Path-finding lives in the engine (`map.ts`): a deterministic Dijkstra over 4-way steps. Walking
  costs 1 on sidewalks, crossings and yards, 2 on grass and 6 on the road, so people keep to the
  pavement and cross at the zebras. Equal-cost ties always break the same way. The browser uses
  the very same paths to draw people walking.
- Trip time = path length × `minutesPerTile` (0.6 for Yaba) plus any ride, rounded up to whole
  10-minute ticks (at least one). A region without a map has fixed 10-minute trips, so a new
  region still works as data only.
- People on the way are at no place: they can't meet anyone, and they don't count towards
  capacity. Setting off is not ledgered. The `arrived` event records where from, when they left
  and how many minutes it took, and cites the plan or choice that sent them (plus any rain delay),
  so traceability is unchanged.
- Players can also walk to a spot on the street (any walkable tile). They stand there, outside
  every place, until their choice runs out, then go back to their routine. A player who changes
  their mind mid-walk turns round from the nearest path tile; on a danfo they can't get off until
  it arrives.
- Rain still holds people back before they set off. Walking in the open counts as outdoors for
  getting wet.
- The world shape changed, so the save version is now 2. G-001 saves are rejected with a clear
  message.
- Tests: path-finding (sidewalks over roads, determinism, blocked tiles), trip length to ticks,
  off-map rides, no meetings while travelling, street spots and changing course, and a
  determinism check with travel and street choices. All G-001 tests still pass unchanged,
  including the 30-day soak and the byte-identical determinism checks.

## G-014: Browser prototype stack

**Date:** 2026-11-16 · **Status:** accepted

- `apps/web`: Vite 8 + TypeScript + PixiJS 8 (WebGL). The engine, content and narrative packages
  run unchanged in the page; there is no server.
- `pnpm dev` serves it on port 5173. `pnpm dev --host` also serves it on the local network so a
  phone on the same Wi-Fi can open it. Vite prints the `Network:` URL.
- One save slot in `localStorage` (`liag:save:v2`): autosaved every game hour, after each
  encounter and when the tab is hidden. The title screen offers Continue (if there is a save) and
  New game (which asks before overwriting). A save is the whole world, about 80 KB per game day,
  so the browser's roughly 5 MB limit allows about two months of play. If saving fails (private
  mode, quota) the game carries on unsaved.
- New games use a random seed. `?seed=N` in the URL fixes it (tests and screenshots use this).
- `window.__liag` exposes a few test hooks (state, run until an encounter, jump ahead on
  autopilot). They are used by the Playwright tests.

## G-015: Drawing the city in code

**Date:** 2026-11-16 · **Status:** accepted

- No image files and no third-party assets. No CC0 assets were needed. Everything is Pixi
  `Graphics` (polygons, ellipses, rects) or inline SVG for the HUD weather icons.
- Isometric 64 × 32 tiles. The ground is one `Graphics` in its own render group, built once.
  Buildings are cut into one-tile columns, and every column on the same diagonal (x + y) shares
  one `Graphics`. That gives exact back-to-front order with people and vehicles slotted in between
  diagonals, using about 80 static objects for the whole district. That keeps draw calls low.
- Filler buildings are cut from every remaining lot by a seeded hash: plot sizes, 1–4 floors,
  painted walls, zinc or flat roofs, water tanks, AC units and shop signboards (only on sides that
  face a street). Places get their own look: buka (canopy, benches, cooking pots), market (stalls
  with umbrellas), danfo park (parked yellow danfos, shelter, a conductor waving people in), live
  spot (stage, speakers, coloured lights that swing at night), polytechnic (fence, gate pillars,
  arch sign, flag) and compounds (walled yard, gate, clothesline, chair).
- Day/night and weather come from the engine clock and weather. Night and rain tint the scene
  darker. Lit windows, shop fronts, lamps and stage lights sit in separate layers that fade in, so
  nothing is redrawn as the light changes. Rain is a pool of sprites sharing one texture, and
  harmattan is a dusty haze.
- People are layered (skin tone, build, hairstyle, outfit, gele/cap/fila/headscarf, colours) with
  front and back views, an idle frame and four walk frames, all pre-built once per look. Left-facing
  directions mirror the right-facing ones. Each character's look is data in the content
  (`look` on the character, never read by the simulation).
- Background traffic (danfos, keke, okada keeping right on the roads) and passers-by are
  decoration with their own seeded random stream. The engine never sees them. They thin out at
  night and in rain.
- Resolution is capped at 2× device pixels.
- **Measured:** our per-frame JavaScript is about 0.4 ms. With the laptop's integrated GPU
  (Chromium, Pixel 7 viewport) it holds 60 fps even with the CPU slowed 6×. Headless Chromium on
  a software GPU manages only about 10 fps, which is a limit of the software renderer, not of the
  scene. **Not yet checked on a real mid-range Android phone.**

## G-016: Continuous game time

**Date:** 2026-11-16 · **Status:** accepted

- 1x = one engine tick (10 game minutes) every 5 real seconds. There are also pause, 2x and 4x.
  At most one tick runs per frame, and long frames (a tab in the background) don't cause a burst.
- Between ticks, walkers are placed by how far the clock has run towards the next tick, so
  movement is smooth while the simulation stays in whole ticks.
- The clock stops by itself whenever the engine is waiting for the player's reply, and resumes
  when the result card is closed.
- A tap to move takes effect at the next tick (up to 5 s at 1x). A flag marks the destination
  straight away.

## G-017: Encounters on screen

**Date:** 2026-11-16 · **Status:** accepted

- When the engine starts an encounter that needs Tobi's reply, the view switches to a side-on
  street scene drawn in code. The backdrop is the place (buka front with pots, market stalls, a
  danfo, the stage, the polytechnic gate, a compound, the office, or plain shops), lit for the time
  of day.
- Both people are drawn large, facing each other, with four expressions (neutral, happy, annoyed,
  surprised). The faces after the reply follow the outcome from the ledger: pleased when it went
  well, the one turned down annoyed, surprise when someone walks off.
- A caption says what is going on (the same placeholder prompt keys as the CLI). 2–4 large reply
  buttons come from the engine's options. After the reply, the lines appear as speech bubbles
  (tap to skip). Then a result card says what changed, built from the ledger effects as seen from
  Tobi ("Uncle Tunde trusts you more", "+₦15,000", "You now know the way to …") plus any quest
  progress.
- Encounters between other people near Tobi show their first lines as small bubbles over their
  heads in the city. Everything also lands in the Gist feed with its "why".

## G-018: Placeholder wording in the browser

**Date:** 2026-11-16 · **Status:** accepted

- Interface labels (buttons, HUD words, result phrases, feelings) live in
  `packages/content/src/ui/web.json`, marked `PLACEHOLDER` like every other content file.
- Speech, prompts and gist lines carry the `[PH]` prefix, exactly as in the CLI. Shorter labels
  are covered by a permanent "[PH] Placeholder text" badge on screen and on the title page.
  Writing [PH] on every button would make the prototype hard to use.
- Place names, character names and looks, and quest objectives come from the existing
  placeholder content.

## G-019: Shared narrative package

**Date:** 2026-11-16 · **Status:** accepted

- The journal and text rendering moved from `apps/sim` to `packages/narrative` (`@liag/narrative`)
  so the CLI and the browser read the ledger the same way. It adds structured gist entries
  (headline, lines, why, what changed) for the browser's feed, and a currency option (`N` in the
  terminal, `₦` in the browser). The CLI output is unchanged, apart from arrivals now saying how
  long the trip took.

## G-020: Browser tests, kept light

**Date:** 2026-11-16 · **Status:** accepted

- Pure client modules are unit-tested with Vitest (one worker): the iso projection, the city model
  built from the map, path-finding on the Yaba map, the engine-state-to-sprite mapping (asleep,
  walking along the path, off-map), the clock, the save slot, the result card wording and
  lighting. Pixi itself is not loaded in unit tests.
- One Playwright smoke test (load, tap to walk, play one encounter, open the Gist) against the
  production build, in one browser (Chromium, Pixel 7 emulation) with one worker. The screenshot
  spec only runs with `SHOTS=1`.
- `@playwright/test` is pinned to 1.64.0 because that version uses the Chromium build already
  installed on the owner's laptop, so nothing large has to be downloaded. CI installs Chromium
  itself.

## G-021: New games open at 06:40 on Tobi (bug fix)

**Date:** 2026-11-17 · **Status:** accepted · Roadmap step 3 ("G-003" in the brief)

- **Why it started at 03:50:** the engine's clock starts at midnight (tick 0 is 00:00 on day
  1), and the browser started running from there. At 1x it reached 03:50 after about two
  minutes. At night Tobi is asleep indoors, so his figure is hidden. The camera centred on his
  door, and the market below it filled the phone screen, so nothing showed you where you were.
- **Fix:** `Session.newGame` first simulates the night with Tobi on autopilot, up to world tick 41. A new game opens on day 1 at 06:40, with Tobi up at home. The engine is unchanged, and the
  night still lands in the ledger as normal, deterministic ticks.
- The camera places people once before centring, and opens zoomed in (1.2–1.6×) on Tobi.
- While Tobi sleeps, his marker stays visible over his home, so a game continued at night still
  shows where he is.
- **Continue** resumes from the save at the saved tick, centred on Tobi. The save is written
  right after the new-game run-up, every game hour, after each encounter and when the tab is
  hidden.

## G-022: Scripted scenes, run by the engine

**Date:** 2026-11-17 · **Status:** accepted

- Content can declare **scenes**: `regions/<region>/region.json → scenes`. A scene names who
  starts it (a computer-run character), where (`home` or a place), which player character it
  is for, and the days and time window. It also lists what it gives if the player stays to
  listen: a place, flags, money, mood, relationships, where `$asker` means the person speaking.
- There is no dice roll. When the normal rules allow the meeting (both people awake, free and at
  the place, inside the window) the scene starts through `startEncounter`. It is checked before
  random encounters each tick. It is ledgered like any encounter (`data.scene`), with causes:
  the day and both people's arrivals.
- The resolution is a normal chat (relationships, mood, memories, gossip), plus the scene's
  effects if the player didn't walk off. The flag `scene:<id>` marks it done either way, so it
  never repeats.
- Dialogue keys: `prompt.scene.<id>`, `scene.<id>.open`, `scene.<id>.tip`. A content test
  checks they exist. Validation checks the asker, the place, the days and the effects.
- **First scene, `welcome_ada`:** on day 1, between 06:50 and 07:30, Ada greets Tobi at home and
  tells him Uncle Tunde at Bluelight Live Spot gives new acts a stage. Tobi learns the way to
  the live spot (flag `tip:gig_leads`, Ada's warmth +2). To give the window room, Ada now leaves
  for work at 07:30 on weekdays instead of 07:00 (placeholder content).
- In the browser, the scene is due on the first tick after the guided start. The game runs that
  tick at once, so the encounter shows within seconds of the guide closing.
- Engine tests: once only, ledgered, effects applied, walk-away gives nothing, wrong day or wrong
  player never triggers it, validation, determinism. All earlier tests still pass.

## G-023: Guidance (guided start, Show me, arrow, hints, quest panel)

**Date:** 2026-11-17 · **Status:** accepted

- **Guided start:**
  - An intro card says who Tobi is and what his goal is.
  - Then five coach marks, one at a time: Tobi, the street, the quest line, the time controls,
    the Gist button.
  - The guide is skippable at every step and can be replayed from the ☰ menu. The clock is held
    while it is up.
  - It shows on every new game, not on Continue.
- **"Show me"** (on the quest line) asks the pure module `game/guide.ts`, which reads only
  engine state and content:
  - **Step with a fixed place** (from `questTarget`): the camera pans there. A sheet shows the
    walking minutes, the time window or opening hours, and **Walk there**.
  - **Step with no fixed place**, such as "find someone who can get you on a stage":
    - It takes the flags the step waits for and finds who has an offer granting them that they
      can still give to the player (`findOffer`).
    - It lists where each person's plan for today takes them: now, later, or usually. Other
      people's homes and sleep are left out.
    - It follows the engine's own rules: a competitive rival chasing the same break is left out
      while warmth is below 30; low trust ranks lower; the buka and the music venue rank higher.
    - Each line can be tapped to walk there.
- **Edge arrow:**
  - When the place being pointed at is off screen, a round arrow at the screen edge points to it,
    with the walking minutes from the engine's path-finding.
  - Tapping it is the same as "Show me".
  - The yellow map marker follows the same place.
- **Idle hint:**
  - After about 20 s without a touch (and no panel, guide or night skip up), a hint bubble shows
    the suggested next action. For example: "Uncle Tunde will be at Bluelight Live Spot from
    16:00. Go and say hello."
  - Tapping it opens "Show me". No hint while asleep or while a reply is due.
- **Quest panel:**
  - Shows active quests with the current step, who could help, the steps already done (from
    `quest_step` events in the ledger) and the deadline in days.
  - Finished and failed quests are listed below.
- Unit tests cover suggestions, the rival rule, used-up offers, fixed-place steps, hints (including
  none while asleep or mid-encounter), done steps, and the new-game start.

## G-024: HUD for a 360 px phone

**Date:** 2026-11-17 · **Status:** accepted

- **Top bar:**
  - Day, time, weather and money, plus a sound button and the ☰ menu.
  - Mood and energy bars.
  - The quest line, which opens the quest panel, with **Show me** beside it.
- **Bottom row:**
  - One compact time control on the left: ❚❚/▶, a speed button that cycles 1x→2x→4x, and 🔍,
    which opens zoom in, find Tobi and zoom out.
  - **Quests** and **Gist** always visible on the right.
  - It fits 360 px in portrait (checked at 360 × 760). Every touch target is at least 44 px.
- In an encounter on a narrow screen, speech bubbles stay on screen and can be wider.

## G-025: Sound

**Date:** 2026-11-17 · **Status:** accepted

- Web Audio, started by the first tap (a browser rule). A 🔊 pop-over has sound on/off, a volume
  slider and music on/off. The settings are remembered in `localStorage` (`liag:sound`).
- **Ambient layers:** traffic, market chatter, voices and horns at the danfo park, buka sizzle
  and pots, live-spot music, night insects, rain, thunder and wind. Their mix comes from the
  pure, tested `audio/mix.ts`:
  - **Time:** traffic is louder in the rush hours and quieter at night; the market is open
    06:30–19:30; the live spot plays from 16:00 and fully from 18:00; insects play at night.
  - **Weather:** rain, heavy rain with thunder, harmattan wind.
  - **Distance:** each place's sound falls off with distance from the camera centre. Zooming out
    makes everything further away. Sounds are panned left or right.
- **UI sounds:** tap, walk start, encounter chime, quest step, money gained and money lost.
  Ambience ducks during encounters.
- A light music loop runs on its own bus. It fades out where the live spot is playing.
- Generated in code: rain, wind, thunder, insects, sizzle, pots and all UI sounds. CC0 files for
  traffic, voices, horns and both music tracks, listed in `docs/ASSETS.md`. They come to about
  0.8 MB, fetched after the city appears. If a file fails to load, that layer stays silent (or
  generated) and the game carries on.

## G-026: Pace: 1x is 3 s per tick, nights are skipped

**Date:** 2026-11-17 · **Status:** accepted

- 1x = one 10-minute tick every **3 s** (was 5 s); 2x and 4x as before.
- **Night skip:**
  - While Tobi is asleep at home, the clock runs a tick every 120 ms (a night takes about
    a minute), with a "Sleeping…" overlay and the clock on it.
  - It stops by itself when something involving Tobi happens (an encounter, a quest event, a
    world event). It stays off until he is up again.
  - Pause still pauses.

## G-027: Why move the city to 3D

**Date:** 2026-11-17 · **Status:** accepted · Roadmap step 4 ("G-004" in the brief)

- The owner asked for a low-poly 3D Yaba. 3D gives three things the flat isometric view could
  not:
  - **Street level:** encounters happen down at street level, at the real place, with the two
    people standing there. The separate flat backdrop scene is gone.
  - **Follow Tobi:** a camera that walks behind him.
  - **Turning the view:** the city can be rotated, so buildings no longer hide streets
    permanently.
- **The engine is untouched:**
  - The renderer is replaced; the HUD, guidance, sound, save and controls stay.
  - Engine tests and the determinism checks are unchanged.
  - The city model (tiles, buildings, places, spots), the people mapping (`personView`) and the
    looks are reused as they were.

## G-028: Renderer: Three.js, everything built in code

**Date:** 2026-11-17 · **Status:** accepted

- **Three.js 0.170** (WebGL), pinned. PixiJS is removed. Three.js is the smallest mature 3D
  library that does instancing, shadows and fog out of the box. Babylon.js and PlayCanvas are
  heavier and engine-shaped; raw WebGL would cost weeks.
- **No model files and no textures from outside.**
  - Everything is built from boxes, cylinders, cones and spheres in code
    (`apps/web/src/three/`), with flat Lambert shading and colour per vertex.
  - Shop signs and the polytechnic arch are text drawn on one canvas (an atlas). Glows, blob
    shadows and rain are canvas or shader drawn.
  - Sign names are placeholder text in `ui/web.json` (`sign.0`…`sign.15`); places use their
    own names.
- **What is built:**
  - **City fabric:** ground, roads with lane dashes, raised sidewalks with kerbs, zebra
    crossings, yards, grass and water.
  - **Buildings:** Lagos-style blocks with floor ledges, zinc gable or flat parapet roofs, water
    tanks, AC units, windows (half of them lit at night), shop shutters with a glow behind, and
    signboards.
  - **Street furniture:** streetlights with halos, and trees.
  - **Places:**
    - buka canopy, benches and cooking pots on glowing coals
    - market stalls with produce and umbrellas
    - danfo park with parked danfos and a shelter
    - live-spot stage, speakers, truss and swinging coloured lights
    - polytechnic fence, gate, name arch and flag
    - compound walls, clothesline and plastic chair
- **Vehicles:** danfo (yellow, black stripes, roof rack), keke and okada with a rider.
- **People:**
  - Low-poly figures built from parts, using the same layered looks as before: skin, build,
    hair (low cut, afro, braids, locs, bun, twists), gele, cap, fila or headscarf, and outfit
    with colours.
  - A walk cycle (legs and arms swing, a little bob), poses (idle, walk, talk, wave, ride) and
    four expressions shown by eyes, brows and mouth (neutral, happy, annoyed, surprised).
- **Cameras:**
  - **City view:** an angled orthographic view like before. Drag pans, pinch or wheel zooms,
    a two-finger twist (or ⟲ ⟳ under 🔍) turns it in 90° steps, double-tap finds Tobi.
  - **Follow Tobi (🎥):** a street-level camera behind him. Drag or double-tap goes back to the
    city view.
  - **Encounters:**
    - The camera comes down beside the two people at their real spot.
    - It picks a side with open ground and nothing (wall, canopy, clothesline) between it and
      their faces, checked by ray casts.
    - Tobi always stands on the left.
- **Light and weather:**
  - The sun moves across the sky by time of day (`sunAt`, unit-tested) with warm low light at
    dawn and dusk and a weak blue moon at night.
  - The sky colour, darkness and glow come from the same `lightingFor` as before.
  - Rain is GPU-animated streaks around the camera. Wet roads go darker and shiny.
  - Harmattan is a dusty fog, heavy rain a grey murk.
- **Tapping:**
  - People are picked on screen near their figure.
  - Places are picked by ray casts against invisible boxes.
  - Anything else is the ground tile under the finger.
  - Place labels, speech bubbles, the edge arrow and coach marks are projected from 3D.

## G-029: Performance approach

**Date:** 2026-11-17 · **Status:** accepted

- **Few draw calls:**
  - Everything static is merged at start-up into a handful of meshes: ground, buildings and
    props, signs, night lights, baked shadows, lamp halos, stage lights.
  - People are drawn as instanced body parts: every leg in the city is one draw call, every
    head another, and so on.
  - Vehicles are one instanced mesh per kind.
  - The whole scene is about **21–23 draw calls** and 54–58k triangles.
- **Cheap shadows:** on Low and Medium, buildings have baked footprint shadows on the ground and
  people and vehicles have soft blob shadows. High adds a real 1024² sun shadow map.
- **No per-frame allocation in hot paths;** rain costs no CPU at all.
- **Graphics setting (☰ menu): Low / Medium / High.**
  - Pixel ratio is capped at 1, 1.5 and 2.
  - Rain drops: 350, 800 and 1400.
  - Background walkers and vehicles vary with the level.
  - Shadows and antialiasing are on High only.
  - The default is Low on phones (mobile or touch-first browser) and on machines with ≤4 cores
    or ≤4 GB. Otherwise Medium. The choice is remembered (`liag:gfx`).
  - Resolution and crowd size change at once. Shadows and antialiasing apply after a reload.
- **Measured** on the laptop's integrated GPU (Chromium, Pixel 7 size, Low), with
  `PERF=1 pnpm e2e`:
  - **59–60 fps** in the city view, the Follow view and a rainy night, with the CPU slowed 4×.
  - Our own per-frame JavaScript takes about 1.6 ms.
  - Even headless Chromium with software rendering managed about 25 fps, against about 10 for
    the old 2D renderer.
  - **Not yet measured on a real mid-range Android.** Its GPU is weaker than this laptop's, so
    please check it on the phone.

## G-030: Music: an Afrobeats-style groove generated in code

**Date:** 2026-11-17 · **Status:** accepted

- The two CC0 music files are removed; music is now generated with Web Audio:
  - `audio/groove.ts` writes the patterns and timing; it is pure and unit-tested.
  - `audio/music.ts` plays them.
- **The groove:**
  - **Instruments:** log drum (a pitched, dropping bass hit), kick, shaker, agogo-style bell,
    rim, sub bass, warm detuned chords (pad plus off-beat stabs) and a conga-like tom.
  - **Feel:** 16 steps a bar with swing on the off-beats, at 100–108 BPM.
  - **Harmony:** chord loops in A minor (for example Am9 → Dm9 → G6 → Cmaj7).
- **Variation, so it doesn't loop obviously:**
  - Each bar's hits come from a seeded generator, so a few change from bar to bar.
  - There are fills every fourth bar.
  - A layer drops out for a few bars now and then.
  - Phrases pick different chord loops.
  - The same seed always gives the same music.
- **Modes:**
  - **Day:** the full groove, light.
  - **Night:** slower, no kick or log drum, darker tone.
  - **Live spot:** a separate, fuller groove at 108 BPM, placed at the live spot. It is louder
    up close and in the evening (from 16:00, fully from 18:00); the background music gives way
    there.
  - The day/night switch happens on a bar line.
  - Notes are scheduled 0.6 s ahead. A source that can't be heard (muted, music off, far from
    the live spot) does no work.
- **Licensed tracks later:**
  - Drop audio files into `apps/web/public/music/` and list them in
    `public/music/tracks.json` (`day`, `night`, `live`).
  - Listed tracks replace the generated music for that mode. Night falls back to the day list,
    and the generated groove fills any empty mode.
  - No code change is needed.
- Ambient sounds, UI sounds and the sound settings are unchanged (G-025).

## G-031: Readable result lines and non-overlapping bubbles (bug fixes)

**Date:** 2026-11-17 · **Status:** accepted

- **"New lead: welcome ada":**
  - **Cause:** the result card turned raw flag ids into text, and the scene's bookkeeping flag
    (`scene:welcome_ada`) was shown too.
  - **Fix:**
    - Flags now show only their own placeholder wording from `ui/web.json`
      (`flag.<id>`, for example "Ada told you where to find gig leads").
    - Bookkeeping flags (`scene:*`) are never shown.
    - A flag with no wording is left out rather than shown as an id.
  - **Second leak:** the new test then found the Gist's "Changed" line printing flag and goal
    ids. The shared journal now takes wording hooks; the browser passes readable text, and the
    CLI keeps its ids for debugging.
- **The test that guards it:**
  - Every literal interface key in the code exists in the content.
  - Every flag the content can give has wording.
  - Four days of real play go through the result card and the Gist, and any id-shaped text
    fails the test.
  - The Playwright smoke test also reads the real result card on screen.
- **Bubbles hidden under each other:** speech bubbles are now laid out by a pure, tested
  function:
  - The line being said stays over its speaker.
  - The older bubble moves up out of the way, or beside it when there is no room above.
  - Bubbles stay on screen and below the caption.

<!-- Next free ID: G-032 -->
