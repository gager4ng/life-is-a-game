# Progress

## Roadmap step 2 ("G-002" in the brief): playable browser prototype of Yaba. **Done (2026-11-16)**

Decisions for this step are G-013 to G-020 in `docs/DECISIONS.md`.

### Built

- **Engine: travel takes time** (G-013). A street grid per region, deterministic path-finding,
  trips that last as long as the walk (plus a danfo ride to the off-map Island office), no
  meetings on the move, players walking to street spots and changing course. Save version 2.
- **Content:** a hand-made 44 × 36 Yaba grid (`regions/lagos/map.json`) with every place on it,
  a `look` for every character, and interface wording in `ui/web.json`. All of it is
  **PLACEHOLDER**.
- **`packages/narrative`:** the journal moved out of the CLI so the browser shares it, plus
  structured Gist entries.
- **`apps/web`** (Vite + PixiJS 8):
  - A code-drawn isometric Yaba: streets, kerbs, gutters, zebra crossings, painted multi-storey
    buildings with water tanks and shop signs, streetlights and trees. The buka, market, danfo
    park, live spot, polytechnic and three compounds each have their own look.
  - Day/night and weather from the engine: darker and bluer at night, lit windows, shop fronts
    and streetlights, swinging stage lights, rain, a gloomy heavy-rain sky, harmattan haze.
  - Background danfos, keke and okada, passers-by (some with umbrellas in rain) and a park
    conductor.
  - Every engine character drawn with layered parts and a 4-direction walk, following their real
    routines along the streets. Tobi has a ring and a bobbing marker.
  - Camera: drag to pan, pinch, wheel or buttons to zoom, double-tap (or ◎) to find Tobi.
  - Tap a place or a street spot and Tobi walks there. You're told if you don't know the way yet
    or it's closed. Tap anyone to see their name, job, where they are and how they feel about you.
  - Continuous time (1x = 10 game minutes per 5 s, pause/2x/4x) that stops for encounters.
  - HUD: day and time, weather icon, money, mood and energy bars, current quest step. A bobbing
    marker shows where the quest step needs you.
  - "Gist" feed: what happened around Yaba, newest first, with the why and what changed.
  - Encounter scene: side-on backdrop of the place, both people large with expressions, a
    caption, 2–4 big reply buttons, speech bubbles, then a result card. Other people's encounters
    near Tobi show as small bubbles in the city.
  - One save slot in the browser with Continue / New game.
- **Tests:** 32 engine (9 new for travel), 5 content, 1 narrative, 8 CLI and 16 browser unit
  tests, plus one Playwright smoke test (load, tap to walk, one encounter, Gist). CI runs the
  smoke test too.
- **Screenshots** (Pixel 7 size): `docs/screenshots/01-day-street.png`,
  `02-night-rain.png`, `03-encounter.png`, `04-gist.png`.

### Needs the owner's approval before anything ships

- Everything from step 1, plus all browser wording (`ui/web.json`), the character looks, the Yaba
  layout and the place names on the map.

### Known limitations / candidates for the next step

- **Not yet tried on a real phone.** Performance was measured on the laptop with an emulated
  Pixel 7 screen (60 fps with integrated graphics, even with the CPU slowed 6×). Please try it
  on a mid-range Android over Wi-Fi (see README).
- A tap to move starts at the next tick (up to 5 s at 1x). A flag shows the destination at once.
- Encounters happen only at places, not on the street or on the way.
- In an encounter the other person's lines appear after you reply (the engine decides both sides
  together). Before that, a caption sets the scene.
- Walking looks brisk, because 10 game minutes pass in 5 seconds.
- Labels can overlap when zoomed far out (they hide below half zoom).
- `localStorage` holds about two months of game time (saves are the whole ledger). Compaction is
  still a later concern.

## Roadmap step 1: text-only proof of the encounter engine and event ledger. **Done (2026-11-16)**

### Built

- **Monorepo:** pnpm + Turborepo, TypeScript strict, Vitest, ESLint + Prettier, Node 24 LTS,
  GitHub Actions CI (install, format check, lint, typecheck, test, build, smoke run).
- **Engine (`packages/engine`)**, pure and deterministic, no I/O:
  - 10-minute world clock, calendar, day/night; seeded daily weather per region (dry, rain,
    heavy rain, harmattan) with rain spells that delay departures.
  - One seedable RNG whose state lives in the world.
  - Entities: Region, Location (type, hours, capacity, outdoor), Character (job, traits, needs,
    routine with variations, goals, offers, memories, known places), Goal, Relationship (trust,
    familiarity, respect, warmth, tension, each tracked and bounded), Memory (importance, decay),
    Event, Encounter, Quest (main, side, emergent; steps, prerequisites, branching, checks,
    deadlines, fail conditions, rewards, penalties), Debt.
  - Append-only event ledger with cause ids and recorded effects; full traceability.
  - Collision of Worlds: co-presence each tick; needs-driven and passing encounters; three
    encounter types (passing, practical help, opportunity); computer-run characters refuse by
    rule; player picks friendly, firm, funny or walk away.
  - Independent lives and rumours: NPCs lend, borrow, repay, get leads and pass on gist; the
    player hears it second-hand.
  - Multiplayer-ready: any number of players, each with a `playerId`; the world blocks only on
    human replies; autopilot available.
  - World events loaded from JSON (prices, mood, routine overrides, crowding).
  - Save/load the whole world as JSON.
- **Content (`packages/content`)**, all **PLACEHOLDER**: Lagos (Yaba area plus an Island office):
  buka, market, danfo park, live-music spot, polytechnic, office, three homes; 10 computer-run
  characters plus the player character (Tobi); quests "Get your first paid gig" (main, branches
  into an audition or a duet), "Open a stall in the market" (side, branches on whether Mama Ngozi
  vouches for you), and the emergent "Pay back what you owe"; three world events (cup final
  night, fuel price rise, street carnival); English and Pidgin placeholder dialogue.
- **CLI (`apps/sim`)**: unattended journal (`--seed --days`), interactive play
  (`--interactive`), `--save` / `--load`, `--events`, `--start`, `--verbose`.
- **Tests (36):** determinism (fixture and Lagos), ledger traceability, ledger completeness
  (money and relationships replay), relationship bounds, quest branching, check exhaustion, fail
  conditions, deadlines, emergent quest binding, refusals (broke, rival, distrust, and the player
  refusing), multiplayer replies, second region as data, rain delays citing weather, save/load
  round trip (including continuing after load), content validation and placeholder marking,
  journal rendering, interactive replies, and a 30-day soak with invariants checked daily.

### Observed in runs (seed 42 unless noted)

- About 25 encounters a day, with umbrella sharing in rain, loans at the danfo park and buka,
  directions, leads, refusals, and gist spreading through compounds and the market.
- 30-day runs on seeds 42, 7 and 99: no errors, all invariants hold. On seed 99 the main quest
  fails at its day-21 deadline after Uncle Tunde and Ada keep refusing, which is a believable
  failure.

### Needs the owner's approval before anything ships

- **All player-facing text is placeholder:** character names and roles, place names, quest
  titles and objectives, all dialogue lines, option labels and journal narration. The world
  events are fictional stand-ins.

### Known limitations / candidates for the next step

- ~~Travel is instant between places.~~ Fixed in step 2 (G-013).
- Per-tick energy and mood drift is not ledgered (by design, see G-003).
- World events use day numbers, not real dates. A news-feed adapter will be needed.
- Balancing is first-pass: wages, prices, encounter rates and quest odds need tuning with play.
- The three quests are written for Tobi but start for whichever character is played
  (e.g. `--player c_funmi`). Per-character quest eligibility is a small follow-up.
- Only one player is wired into the CLI. The engine supports more (tested).
- Saves include the full ledger and grow about 80 KB per simulated day. Compaction or archiving
  is a later concern.
