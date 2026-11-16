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
- `apps/sim`: the CLI (`pnpm sim …`) that runs the world and prints a journal.

## Commands

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm format` ·
`pnpm sim --seed 42 --days 3` · `pnpm sim --seed 42 --interactive`

## Engine invariants (keep them true)

- Same seed + same inputs ⇒ same world (`saveWorld` output is byte-identical).
- The ledger is append-only; every event except `world_created` cites earlier causes.
- Money and relationships change only through ledgered effects (tests replay them).
- Relationship dimensions stay within bounds; money never goes negative.
- Chance is rolled only after rules say a thing is believable.
