# Progress

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

- Travel is instant between places. The danfo park stands in for commuting; there is no journey
  time or route.
- Per-tick energy and mood drift is not ledgered (by design, see G-003).
- World events use day numbers, not real dates. A news-feed adapter will be needed.
- Balancing is first-pass: wages, prices, encounter rates and quest odds need tuning with play.
- The three quests are written for Tobi but start for whichever character is played
  (e.g. `--player c_funmi`). Per-character quest eligibility is a small follow-up.
- Only one player is wired into the CLI. The engine supports more (tested).
- Saves include the full ledger and grow about 80 KB per simulated day. Compaction or archiving
  is a later concern.
