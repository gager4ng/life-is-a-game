# Life Is A Game: working rules

A living-world life simulation set in Nigeria (working title; brand and domain decided later).
This repo is separate from Gist365. Design reference: the owner's design doc v1.2.

## Working rules

- **Commit locally only, never push.** The owner pushes. Never commit `.env` or secrets.
- **Decision log** in `docs/DECISIONS.md` with IDs G-001, G-002, … (next free ID at the bottom).
  **Progress** in `docs/PROGRESS.md`.
- **Rules and state machines decide every fact.** AI is never required. At most it may later
  phrase dialogue. The game must run with no AI service.
- **All characters are fictional.** Never use real people as characters.
- **Player-facing wording that will ship must be shown to the owner for approval.** Until then,
  text is placeholder and must be marked so in the content files (`"$meta": { "status": "PLACEHOLDER" }`);
  the CLI prints placeholder lines with a `[PH]` prefix.
- **The owner's laptop is low on memory: keep test runs light.** Vitest runs one worker with no
  file parallelism; Turborepo runs tests with `--concurrency=1`. Don't add heavy test runs or watchers.

## Layout

- `packages/engine`: pure, deterministic TypeScript. No I/O, no wall clock, no `Math.random`
  (enforced by ESLint and by `types: []` in its tsconfig). Runs unchanged in a browser or on a server.
- `packages/content`: zod-validated JSON data (regions, locations, characters, quests, world
  events, placeholder dialogue). New regions are data only.
- `packages/narrative`: turns ledger events into text (journal, Gist feed); shared by both apps.
- `apps/sim`: the CLI (`pnpm sim …`) that runs the world and prints a journal.
- `apps/web`: the browser prototype (Vite + PixiJS 8). Everything is drawn in code: no image
  files. Placeholder UI wording lives in `packages/content/src/ui/web.json`. The only third-party
  files are small CC0 sounds in `apps/web/public/audio/`; log every one in `docs/ASSETS.md`.

## Commands

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm format` ·
`pnpm sim --seed 42 --days 3` · `pnpm sim --seed 42 --interactive` · `pnpm dev` (`--host` for
the phone) · `pnpm e2e` (one Playwright smoke test, 1 worker; `SHOTS=1` retakes screenshots)

## Engine invariants (keep them true)

- Same seed + same inputs ⇒ same world (`saveWorld` output is byte-identical).
- The ledger is append-only; every event except `world_created` cites earlier causes.
- Money and relationships change only through ledgered effects (tests replay them).
- Relationship dimensions stay within bounds; money never goes negative.
- Chance is rolled only after rules say a thing is believable.
- Travel takes time along the street grid; people on the way are at no place (G-013).
