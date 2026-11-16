import type { Condition, ContentBundle } from "./content-types";
import { WALK_COST, findPath, isWalkable, placeTile } from "./map";
import { parseHHMM } from "./time";

/**
 * Referential checks a schema cannot express: ids that must exist, homes that must be homes,
 * quest gotos that must point at real steps. Returns human-readable problems (empty = valid).
 */
export function validateContentRefs(c: ContentBundle): string[] {
  const errs: string[] = [];
  const regions = new Set(c.regions.map((r) => r.id));
  const locs = new Map(c.locations.map((l) => [l.id, l]));
  const chars = new Set(c.characters.map((x) => x.id));

  const dupes = (ids: string[], what: string): void => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errs.push(`duplicate ${what} id ${id}`);
      seen.add(id);
    }
  };
  dupes(
    c.regions.map((r) => r.id),
    "region",
  );
  dupes(
    c.locations.map((l) => l.id),
    "location",
  );
  dupes(
    c.characters.map((x) => x.id),
    "character",
  );
  dupes(
    c.quests.map((q) => q.id),
    "quest",
  );
  dupes(
    c.worldEvents.map((w) => w.id),
    "world event",
  );

  const time = (s: string, where: string): number | null => {
    try {
      return parseHHMM(s);
    } catch {
      errs.push(`${where}: bad time "${s}"`);
      return null;
    }
  };

  for (const r of c.regions) {
    if (r.climate.length !== 12) errs.push(`region ${r.id}: climate needs 12 months`);
  }
  for (const l of c.locations) {
    const region = c.regions.find((r) => r.id === l.regionId);
    if (!region) errs.push(`location ${l.id}: unknown region ${l.regionId}`);
    else if (!region.areas.some((a) => a.id === l.areaId))
      errs.push(`location ${l.id}: unknown area ${l.areaId}`);
    if (l.hours) {
      time(l.hours.open, `location ${l.id}`);
      time(l.hours.close, `location ${l.id}`);
    }
    if (l.capacity < 1) errs.push(`location ${l.id}: capacity must be >= 1`);
  }

  for (const m of c.maps ?? []) {
    const w = `map ${m.regionId}`;
    if (!regions.has(m.regionId)) errs.push(`${w}: unknown region`);
    const width = m.tiles[0]?.length ?? 0;
    if (width === 0) errs.push(`${w}: no tiles`);
    if (m.tiles.some((r) => r.length !== width)) errs.push(`${w}: rows must be the same length`);
    if (m.tiles.some((r) => /[^szpgR#~]/.test(r))) errs.push(`${w}: unknown tile code`);
    if (!(m.minutesPerTile > 0)) errs.push(`${w}: minutesPerTile must be > 0`);
    for (const p of m.places) {
      const l = locs.get(p.locationId);
      if (!l || l.regionId !== m.regionId) errs.push(`${w}: place ${p.locationId} not in region`);
      if (!isWalkable(m, p.door)) errs.push(`${w}: door of ${p.locationId} is not walkable`);
    }
    for (const o of m.offMap) {
      const l = locs.get(o.locationId);
      if (!l || l.regionId !== m.regionId) errs.push(`${w}: off-map ${o.locationId} not in region`);
      if (!m.places.some((p) => p.locationId === o.via))
        errs.push(`${w}: off-map ${o.locationId} rides from ${o.via}, which is not on the map`);
      if (!(o.rideMinutes > 0)) errs.push(`${w}: off-map ${o.locationId} needs rideMinutes > 0`);
    }
    const inRegion = c.locations.filter((l) => l.regionId === m.regionId);
    const first = m.places[0];
    for (const l of inRegion) {
      const t = placeTile(m, l.id);
      if (!t) {
        errs.push(`${w}: location ${l.id} has no place on the map`);
        continue;
      }
      if (first && isWalkable(m, t) && !findPath(m, first.door, t, WALK_COST))
        errs.push(`${w}: ${l.id} can't be reached on foot`);
    }
  }

  const locRef = (ref: string, where: string, regionId: string, hasJob: boolean): void => {
    if (ref === "home") return;
    if (ref === "work") {
      if (!hasJob) errs.push(`${where}: uses "work" without a job`);
      return;
    }
    const l = locs.get(ref);
    if (!l) errs.push(`${where}: unknown location ${ref}`);
    else if (l.regionId !== regionId) errs.push(`${where}: ${ref} is in another region`);
  };

  for (const ch of c.characters) {
    const w = `character ${ch.id}`;
    const hasJob = ch.job !== null;
    if (!regions.has(ch.regionId)) errs.push(`${w}: unknown region ${ch.regionId}`);
    const home = locs.get(ch.homeId);
    if (!home) errs.push(`${w}: unknown home ${ch.homeId}`);
    else if (home.type !== "home") errs.push(`${w}: home ${ch.homeId} is not a home`);
    if (ch.job) locRef(ch.job.workplaceId, `${w} job`, ch.regionId, hasJob);
    for (const k of ch.knownLocations) locRef(k, `${w} knownLocations`, ch.regionId, hasJob);
    for (const [kind, slots] of [
      ["weekday", ch.routine.weekday],
      ["weekend", ch.routine.weekend],
    ] as const) {
      if (slots.length === 0 || slots[0]!.from !== "00:00")
        errs.push(`${w}: ${kind} routine must start at 00:00`);
      let prev = -1;
      for (const s of slots) {
        const m = time(s.from, w);
        if (m !== null) {
          if (m <= prev) errs.push(`${w}: ${kind} routine times must increase`);
          prev = m;
        }
        locRef(s.at, `${w} routine`, ch.regionId, hasJob);
      }
    }
    for (const v of ch.routine.variations) {
      time(v.from, w);
      time(v.to, w);
      locRef(v.at, `${w} variation ${v.id}`, ch.regionId, hasJob);
      if (v.chance < 0 || v.chance > 1) errs.push(`${w}: variation ${v.id} chance must be 0..1`);
    }
    for (const o of ch.offers) {
      if (o.revealsLocation) locRef(o.revealsLocation, `${w} offer ${o.id}`, ch.regionId, hasJob);
    }
    for (const g of ch.goals) {
      if (g.kind === "seek_opportunity" && !g.opportunity)
        errs.push(`${w}: goal ${g.id} needs an opportunity kind`);
      if (g.kind === "learn_place" && !g.location) errs.push(`${w}: goal ${g.id} needs a location`);
      if (g.kind === "save_money" && !g.amount) errs.push(`${w}: goal ${g.id} needs an amount`);
    }
  }

  for (const r of c.relationships) {
    if (!chars.has(r.from)) errs.push(`relationship: unknown character ${r.from}`);
    if (!chars.has(r.to)) errs.push(`relationship: unknown character ${r.to}`);
  }

  const checkCond = (cond: Condition, where: string): void => {
    switch (cond.type) {
      case "all":
      case "any":
        cond.of.forEach((x) => checkCond(x, where));
        break;
      case "not":
        checkCond(cond.of, where);
        break;
      case "at_location":
      case "knows_location":
        if (!cond.location.startsWith("$") && !locs.has(cond.location))
          errs.push(`${where}: unknown location ${cond.location}`);
        break;
      case "present":
        if (!cond.character.startsWith("$") && !chars.has(cond.character))
          errs.push(`${where}: unknown character ${cond.character}`);
        break;
      case "relationship":
        if (!cond.with.startsWith("$") && !chars.has(cond.with))
          errs.push(`${where}: unknown character ${cond.with}`);
        break;
      case "time_between":
        time(cond.from, where);
        time(cond.to, where);
        break;
      default:
        break;
    }
  };

  for (const q of c.quests) {
    const steps = new Set(q.steps.map((s) => s.id));
    const w = `quest ${q.id}`;
    if (!steps.has(q.startStep)) errs.push(`${w}: unknown start step ${q.startStep}`);
    const go = (g: string): void => {
      if (g !== "complete" && g !== "fail" && !steps.has(g)) errs.push(`${w}: unknown goto ${g}`);
    };
    q.prerequisites.forEach((p) => checkCond(p, w));
    q.failWhen.forEach((p) => checkCond(p, w));
    for (const s of q.steps) {
      if (s.kind === "condition") {
        checkCond(s.completeWhen, `${w}/${s.id}`);
        if (s.next.length === 0) errs.push(`${w}/${s.id}: needs at least one branch`);
        for (const b of s.next) {
          go(b.goto);
          if (b.when) checkCond(b.when, `${w}/${s.id}`);
        }
      } else {
        checkCond(s.attemptWhen, `${w}/${s.id}`);
        [s.onSuccess, s.onFailure, s.onExhausted].forEach(go);
        if (s.maxAttempts < 1) errs.push(`${w}/${s.id}: maxAttempts must be >= 1`);
      }
    }
    if (q.bind && q.kind !== "emergent") errs.push(`${w}: only emergent quests bind world facts`);
  }

  for (const e of c.worldEvents) {
    const w = `world event ${e.id}`;
    if (e.regionId && !regions.has(e.regionId)) errs.push(`${w}: unknown region ${e.regionId}`);
    if (e.toDay < e.fromDay) errs.push(`${w}: toDay is before fromDay`);
    for (const o of e.routineOverrides ?? []) {
      time(o.from, w);
      time(o.to, w);
      if (o.at !== "home" && o.at !== "work" && !locs.has(o.at))
        errs.push(`${w}: unknown location ${o.at}`);
    }
    for (const b of e.crowdBoost ?? []) {
      if (!locs.has(b.locationId)) errs.push(`${w}: unknown location ${b.locationId}`);
    }
  }
  return errs;
}
