import type { PendingChoice, World } from "@liag/engine";
import {
  TICKS_PER_DAY,
  available,
  calendar,
  charDef,
  chooseReply,
  currentWeather,
  dayIndex,
  dayNumber,
  formatClock,
  getChar,
  getLocation,
  getQuestDef,
  minuteOfDay,
  occupants,
  pendingChoices,
  questTarget,
  reachablePlaces,
  setPlayerDestination,
  stepTick,
} from "@liag/engine";
import { questSummary, relationshipSummary } from "./summary";
import { HOUR_TICKS, naira, type Journal, type Text } from "@liag/narrative";

export type Ask = (prompt: string) => Promise<string | null>;
export type Print = (line: string) => void;

const WEATHER_WORDS: Record<string, string> = {
  dry: "dry",
  rain: "raining",
  heavy_rain: "heavy rain",
  harmattan: "harmattan haze",
};

function status(world: World, charId: string): string[] {
  const c = getChar(world, charId);
  const cal = calendar(world.startDate, dayIndex(world.tick));
  const loc = getLocation(world, c.locationId);
  const around = occupants(world, c.locationId)
    .filter((o) => o.id !== charId)
    .map((o) => `${o.name} (${charDef(world, o.id).role}, ${o.activity.replace(/_/g, " ")})`);
  const quests = world.quests
    .filter((q) => q.characterId === charId && q.status === "active")
    .map((q) => {
      const def = getQuestDef(world, q.questId);
      const step = def.steps.find((s) => s.id === q.stepId);
      const target = questTarget(world, q);
      const lost =
        target && !c.knownLocations[target.locationId] ? " (you don't know the way yet)" : "";
      return `  Quest: ${def.title} -> ${step?.objective ?? q.stepId}${lost}`;
    });
  return [
    "",
    `-- Day ${dayNumber(world.tick)}, ${cal.label}, ${formatClock(minuteOfDay(world.tick))} · ${loc.name} · ${WEATHER_WORDS[currentWeather(world, c.regionId)]} --`,
    `  ${c.name}: mood ${Math.round(c.needs.mood)} · energy ${Math.round(c.needs.energy)} · ${naira(c.needs.money)} (can spend ${naira(available(world, c))})`,
    `  Around you: ${around.length ? around.join(", ") : "nobody you know"}`,
    ...quests,
  ];
}

async function handleChoice(
  world: World,
  choice: PendingChoice,
  text: Text,
  journal: Journal,
  ask: Ask,
  print: Print,
): Promise<boolean> {
  const other = getChar(world, choice.otherId);
  const vars = {
    other: `${other.name} (${charDef(world, other.id).role})`,
    amount: choice.amount ? naira(choice.amount) : null,
    target: choice.subtype === "directions" ? targetName(world, choice) : null,
  };
  const key =
    choice.kind === "passing"
      ? "prompt.chat"
      : choice.role === "giver" && choice.kind === "opportunity"
        ? "prompt.giver"
        : `prompt.${choice.subtype}.${choice.role}`;
  print("");
  print(`>> ${text.line(key, vars, choice.encounterId)}`);
  choice.options.forEach((o, i) => {
    print(`   ${i + 1}) ${text.option(o.labelKey, vars, choice.encounterId)}`);
  });
  for (;;) {
    const ans = await ask(`   Your reply [1-${choice.options.length}]: `);
    if (ans === null) return false;
    const n = Number(ans);
    const opt = Number.isInteger(n) ? choice.options[n - 1] : undefined;
    if (!opt) {
      print("   Pick one of the numbers above.");
      continue;
    }
    const events = chooseReply(world, choice.playerId, choice.encounterId, opt.id);
    for (const line of journal.render(events)) print(line);
    return true;
  }
}

function targetName(world: World, choice: PendingChoice): string | null {
  const enc = world.encounters.find((e) => e.id === choice.encounterId);
  return enc?.targetLocation ? getLocation(world, enc.targetLocation).name : null;
}

/**
 * Play one character. The world runs in 10-minute ticks; we stop when something involves
 * you (an encounter, a move, a quest update, gist you hear) or every hour while you're awake.
 */
export async function playInteractive(
  world: World,
  playerId: string,
  endTick: number,
  text: Text,
  journal: Journal,
  ask: Ask,
  print: Print,
): Promise<"done" | "quit"> {
  const charId = world.players[playerId]!.characterId;
  let lastPromptTick = -Infinity;
  let showStatus = true;
  while (world.tick < endTick) {
    const pending = pendingChoices(world, playerId);
    if (pending.length > 0) {
      if (showStatus) for (const l of status(world, charId)) print(l);
      showStatus = false;
      if (!(await handleChoice(world, pending[0]!, text, journal, ask, print))) return "quit";
      continue;
    }
    const c = getChar(world, charId);
    const awake = c.activity !== "sleep";
    if (awake && world.tick - lastPromptTick >= HOUR_TICKS) {
      for (const l of status(world, charId)) print(l);
      showStatus = false;
      lastPromptTick = world.tick;
      const cmd = await ask(
        "  [Enter] wait 10 min  [h] wait 1 hour  [g] go somewhere  [q] quests  [r] relationships  [x] quit: ",
      );
      if (cmd === null || cmd === "x") return "quit";
      if (cmd === "q") {
        for (const l of questSummary(world)) print(l);
        lastPromptTick = -Infinity;
        continue;
      }
      if (cmd === "r") {
        for (const l of relationshipSummary(world, charId, 6)) print(l);
        lastPromptTick = -Infinity;
        continue;
      }
      if (cmd === "g") {
        const places = reachablePlaces(world, playerId);
        if (places.length === 0) {
          print("  Nowhere you know is open right now.");
          lastPromptTick = -Infinity;
          continue;
        }
        places.forEach((p, i) => print(`   ${i + 1}) ${getLocation(world, p).name}`));
        const ans = await ask(`   Where to? [1-${places.length}, Enter to cancel]: `);
        const pick = places[Number(ans) - 1];
        if (pick) {
          for (const l of journal.render([setPlayerDestination(world, playerId, pick, 3)]))
            print(l);
        }
        lastPromptTick = -Infinity;
        continue;
      }
      if (cmd !== "h") lastPromptTick = world.tick - HOUR_TICKS + 1; // Enter: just one tick
    }
    const wasAsleep = !awake;
    const r = stepTick(world);
    const lines = journal.render(r.events);
    const touchedMe = r.events.some(
      (e) =>
        e.actors.includes(charId) &&
        [
          "arrived",
          "encounter_resolved",
          "rumour_shared",
          "quest_started",
          "quest_step",
          "quest_check",
          "quest_completed",
          "quest_failed",
        ].includes(e.type),
    );
    for (const l of lines) print(l);
    if (touchedMe) lastPromptTick = -Infinity;
    if (wasAsleep && getChar(world, charId).activity !== "sleep") lastPromptTick = -Infinity;
    if (world.tick % TICKS_PER_DAY === 0) showStatus = true;
  }
  return "done";
}
