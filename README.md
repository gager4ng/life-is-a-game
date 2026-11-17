# Life Is A Game (working title)

A living-world life simulation set in Nigeria. This repository holds **roadmap step 1** (a
text-only proof of the encounter engine and the event ledger), **roadmap step 2** (a playable
browser prototype of Yaba running that engine in the page), **roadmap step 3** (a first-play
experience with a guided start, "what next" guidance and sound) and **roadmap step 4**: Yaba as a
low-poly 3D city built in code (Three.js), with Afrobeats-style music generated in code.

People in a small slice of Lagos live their routines in 10-minute ticks. When schedules, places
and circumstances overlap (rain holding everyone at the danfo park, the lunch rush at the buka,
a cup final night), rules decide whether they greet, help, refuse, pass on gist, or open a door
for each other. Every outcome is written to an append-only ledger and can be traced back through
its causes. No AI service is needed: rules decide every fact.

> All characters are fictional. All names and dialogue are **placeholder** text (`[PH]`) until
> approved.

## Requirements

- Node 24 LTS (see `.nvmrc`)
- pnpm 9 (`corepack enable` will pick up the pinned version)

## Setup

```sh
pnpm install
```

## Play in the browser

```sh
pnpm dev          # http://localhost:5173 on this computer
pnpm dev --host   # also on your Wi-Fi, for your phone
```

**On your phone:** connect the phone to the same Wi-Fi as the laptop, run `pnpm dev --host`,
and open the `Network:` address Vite prints, in Chrome. On the owner's laptop it is currently:

> **http://192.168.100.3:5173**

(The address can change when the router hands out a new one; the `Network:` line is always
right. If the phone can't connect, allow Node.js through the Windows firewall for private
networks.)

How to play:

- A new game opens on day 1 at 06:40 with Tobi at home. A short **guided start** shows you
  around; skip it any time, replay it from the ☰ menu. Right after it, a housemate drops by
  with a tip.
- Not sure what to do? Tap **Show me** on the quest line: the camera goes to where you're
  needed (or lists who could help, and where and when to find them) and offers **Walk there**.
  An arrow at the screen edge points to it when it's off screen. Stay idle for 20 s and a hint
  appears. **📜 Quests** lists your quests, the step you're on, what's done and deadlines.
- **Tap a place or a spot on the street** and Tobi walks there along the streets. You can only go
  to places you know the way to. Ask around, and people may tell you.
- **Drag** to look around, **pinch** (or 🔍 then + / −) to zoom, **twist two fingers** (or 🔍 then
  ⟲ ⟳) to turn the view a quarter, **double-tap** (or 🔍 then ◎) to find Tobi.
- **🎥 Follow Tobi**: a street-level camera that walks behind him. Drag or double-tap to go back
  to the city view. When someone talks to you, the camera comes down beside the two of you.
- **☰ → Graphics**: Low / Medium / High. Phones start on Low (aim: 30 fps or better).
- **Tap anyone** to see who they are and how they feel about you.
- Time runs on its own: **1x** is 10 game minutes every 3 seconds. ❚❚ pauses; the speed button
  cycles 1x, 2x and 4x. Nights skip quickly while Tobi sleeps. Time stops by itself when someone
  talks to you. Pick a reply; afterwards a card shows what changed.
- **Gist** shows what has been happening around Yaba, and why.
- **Sound** starts with your first tap. 🔊 has sound on/off, volume and music on/off. The music is
  an Afrobeats-style groove generated in code (calmer at night, a live band at Bluelight in the
  evening). Sources of the few sound files are in `docs/ASSETS.md`.

### Music: using licensed tracks

Put the audio files (mp3, ogg or m4a) in `apps/web/public/music/` and list their file names in
`apps/web/public/music/tracks.json`:

```json
{ "day": ["street-groove.mp3"], "night": ["late-night.mp3"], "live": ["band-set.mp3"] }
```

Listed tracks replace the generated music for that mode (night falls back to the day list;
any empty mode keeps the generated groove). No code change or rebuild of the logic is needed;
just restart `pnpm dev` or rebuild. Record each track's licence in `docs/ASSETS.md`.

- The game saves itself in the browser (one slot). **Continue** or **New game** on the title
  screen. `?seed=42` in the address starts a fixed world.

## Run the simulation (text)

```sh
# Run the world unattended for 3 days and print the journal
pnpm sim --seed 42 --days 3

# Play the player character (Tobi) yourself
pnpm sim --seed 42 --interactive

# Save, then continue later
pnpm sim --seed 42 --days 2 --save world.json
pnpm sim --load world.json --days 1
```

Options:

| Option            | Meaning                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `--seed <n>`      | World seed (default 42). Same seed + same inputs = same world.    |
| `--days <n>`      | Days to simulate (default 3).                                     |
| `--interactive`   | Play the player character; pick replies by number.                |
| `--player <id>`   | Character to play (default `c_tobi`; `c_funmi` is also playable). |
| `--start <date>`  | Day 1 as `YYYY-MM-DD` (default `2026-06-01`, rainy season).       |
| `--events <file>` | World events JSON (default: the bundled placeholder file).        |
| `--save <file>`   | Save the whole world as JSON at the end.                          |
| `--load <file>`   | Load a saved world and continue it.                               |
| `--verbose`       | Show every event in full.                                         |

The unattended journal shows, day by day, who met whom, where, **why** (the cause chain: who came
for what, rain delays, shortages, world events), what changed, gist being passed on, quest
progress, and a relationship summary at the end.

In interactive mode the game stops whenever something involves you, and otherwise every hour
while you're awake. You see the time, place, weather, who's around and your active quests. When
an encounter happens you pick a reply (friendly, firm, funny or walk away). You can also wait,
or go somewhere you know the way to.

## Development

```sh
pnpm lint        # ESLint
pnpm typecheck   # tsc, every package
pnpm test        # Vitest, one worker (light on memory)
pnpm build       # tsc for packages, esbuild bundle for the CLI, Vite build for the web app
pnpm format      # Prettier
pnpm e2e         # one Playwright smoke test (Chromium, 1 worker, production build)
SHOTS=1 pnpm e2e # also retake docs/screenshots at phone size
```

Screenshots: `docs/screenshots/01-day-street.png`, `02-night-rain.png`, `03-encounter.png`,
`04-gist.png`, `05-guided-start.png`, `06-show-me-arrow.png`, `07-follow-tobi.png`.
`PERF=1 pnpm e2e` prints the frame rate on Low (real GPU, CPU slowed 4x).

## Layout

```
packages/engine    Pure, deterministic simulation (no I/O). Runs in a browser or on a server.
packages/content   zod-validated JSON content: regions, street maps, places, characters (with
                   their looks), quests, world events, placeholder dialogue and UI wording.
packages/narrative Turns the ledger into readable text (journal, Gist feed). Shared.
apps/sim           The CLI: journal and interactive mode.
apps/web           The browser prototype (Vite + Three.js): the 3D city, people and cameras
                   (three/), HUD and encounters (ui/), guidance (game/guide.ts), sound and the
                   generated music (audio/).
docs/DECISIONS.md  Decision log (G-001 onwards).
docs/PROGRESS.md   What's done, what's next, what needs approval.
docs/ASSETS.md     Third-party files (a few CC0 sounds) with source and licence.
```

## Adding a region (Abuja, Port Harcourt, Kano…)

1. Create `packages/content/src/regions/<region>/region.json` (region, locations, characters,
   relationships) and `dialogue.json` in the same shape as Lagos, with
   `"$meta": { "status": "PLACEHOLDER", … }`.
2. Optionally add a street grid `map.json` (see `regions/lagos/map.json`). Without one, trips in
   that region take a fixed 10 minutes.
3. Add them to `RAW_REGION_PACKS` / `RAW_DIALOGUE` / `RAW_MAPS` in `packages/content/src/index.ts`.

The engine doesn't change. Schemas and reference checks reject anything malformed.
