#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { loadContent, loadDialogue, parseWorldEvents } from "@liag/content";
import type { World } from "@liag/engine";
import {
  TICKS_PER_DAY,
  checkInvariants,
  createWorld,
  loadWorld,
  runUntil,
  saveWorld,
} from "@liag/engine";
import { playInteractive } from "./interactive";
import { Journal } from "./journal";
import { peopleSummary, questSummary, relationshipSummary, statsLine } from "./summary";
import { Text } from "./text";

const HELP = `Life Is A Game: text simulation (roadmap step 1)

Usage:
  pnpm sim --seed 42 --days 3            run unattended and print the journal
  pnpm sim --seed 42 --interactive       play the player character
  pnpm sim --load world.json --days 2    continue a saved world

Options:
  --seed <n|text>     world seed (default 42)
  --days <n>          days to simulate (default 3)
  --interactive       play the player character yourself
  --player <id>       character to play (default c_tobi)
  --start <date>      day 1 as YYYY-MM-DD (default 2026-06-01, rainy season)
  --events <file>     world events JSON (default: the bundled placeholder file)
  --save <file>       save the whole world as JSON when finished
  --load <file>       load a saved world instead of creating one
  --verbose           show every event, including other people's small talk details
  --help              show this help
`;

function main(): Promise<void> | void {
  const { values } = parseArgs({
    options: {
      seed: { type: "string", default: "42" },
      days: { type: "string", default: "3" },
      interactive: { type: "boolean", default: false },
      player: { type: "string", default: "c_tobi" },
      start: { type: "string" },
      events: { type: "string" },
      save: { type: "string" },
      load: { type: "string" },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a whole number >= 1");
  const interactive = values.interactive;
  const playerId = "p1";

  let world: World;
  if (values.load) {
    world = loadWorld(readFileSync(values.load, "utf8"));
    if (values.events || values.start) {
      console.warn("Note: --events/--start are ignored when loading; the save has its own.");
    }
    const p = world.players[playerId];
    if (p) p.autopilot = !interactive;
  } else {
    const content = loadContent();
    const worldEvents = values.events
      ? parseWorldEvents(JSON.parse(readFileSync(values.events, "utf8")))
      : undefined;
    world = createWorld(content, {
      seed: /^\d+$/.test(values.seed) ? Number(values.seed) : values.seed,
      ...(values.start ? { startDate: values.start } : {}),
      ...(worldEvents ? { worldEvents } : {}),
      players: [{ playerId, characterId: values.player, autopilot: !interactive }],
    });
  }

  const playerCharId = world.players[playerId]?.characterId ?? null;
  const text = new Text(loadDialogue());
  const journal = new Journal(world, text, {
    playerCharId,
    verbose: values.verbose,
    focus: interactive,
  });
  const startMoney = Object.fromEntries(
    Object.values(world.characters).map((c) => [c.id, c.needs.money]),
  );
  const print = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };

  print(
    `Life Is A Game: text simulation · seed ${world.seed} · ${days} day(s)${values.load ? ` · loaded ${values.load}` : ""}`,
  );
  if (text.placeholder)
    print("All names and dialogue are PLACEHOLDER content ([PH]); nothing here is approved text.");
  const endTick = world.tick + days * TICKS_PER_DAY;

  const finish = (): void => {
    for (const l of questSummary(world)) print(l);
    for (const l of relationshipSummary(world, playerCharId)) print(l);
    for (const l of peopleSummary(world, startMoney)) print(l);
    print("");
    print(statsLine(world));
    const problems = checkInvariants(world);
    print(
      problems.length
        ? `  INVARIANT PROBLEMS:\n  - ${problems.join("\n  - ")}`
        : "  Invariants: all OK",
    );
    if (values.save) {
      writeFileSync(values.save, saveWorld(world));
      print(`  Saved world to ${values.save}`);
    }
  };

  if (!interactive) {
    runUntil(world, endTick, (r) => {
      for (const l of journal.render(r.events)) print(l);
    });
    finish();
    return;
  }

  const rl = createInterface({ input: process.stdin, terminal: Boolean(process.stdin.isTTY) });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt: string): Promise<string | null> => {
    process.stdout.write(prompt);
    const next = await lines.next();
    if (next.done) return null;
    if (!process.stdin.isTTY) process.stdout.write(`${next.value}\n`);
    return next.value.trim();
  };
  return playInteractive(world, playerId, endTick, text, journal, ask, print).then((how) => {
    rl.close();
    if (how === "quit") print("\n(You stepped away. The world will keep its place.)");
    finish();
  });
}

Promise.resolve()
  .then(main)
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
