import type { ContentBundle, RegionMap, WorldEventDef } from "@liag/engine";
import { validateContentRefs } from "@liag/engine";
import lagosDialogueJson from "./regions/lagos/dialogue.json";
import lagosJson from "./regions/lagos/region.json";
import lagosMapJson from "./regions/lagos/map.json";
import uiTextJson from "./ui/web.json";
import questsJson from "./quests/quests.json";
import worldEventsJson from "./data/world-events.json";
import {
  DialogueFileSchema,
  MapFileSchema,
  QuestFileSchema,
  UiTextFileSchema,
  RegionPackSchema,
  WorldEventFileSchema,
  type DialogueFile,
  type RegionPack,
} from "./schema";

export * from "./schema";

/**
 * Region packs. To add Abuja, Port Harcourt or Kano: create regions/<name>/region.json and
 * dialogue.json in the same shape and list them here. No engine change is needed.
 */
const RAW_REGION_PACKS: unknown[] = [lagosJson];
const RAW_DIALOGUE: Record<string, unknown> = { lagos: lagosDialogueJson };
/** Street grids, one per region (optional: a region without one has fixed 10-minute trips). */
const RAW_MAPS: unknown[] = [lagosMapJson];

export function parseMap(raw: unknown): RegionMap {
  const { $meta: _meta, ...map } = MapFileSchema.parse(raw);
  return map;
}

export function parseRegionPack(raw: unknown): RegionPack {
  return RegionPackSchema.parse(raw);
}

export function parseWorldEvents(raw: unknown): WorldEventDef[] {
  return WorldEventFileSchema.parse(raw).events;
}

/** Combine region packs, quests and world events into one validated bundle. */
export function buildBundle(
  packs: RegionPack[],
  quests: ContentBundle["quests"],
  worldEvents: WorldEventDef[],
  maps: RegionMap[] = [],
): ContentBundle {
  const bundle: ContentBundle = {
    regions: packs.map((p) => p.region),
    maps,
    locations: packs.flatMap((p) => p.locations),
    characters: packs.flatMap((p) => p.characters),
    relationships: packs.flatMap((p) => p.relationships),
    quests,
    worldEvents,
  };
  const errors = validateContentRefs(bundle);
  if (errors.length) throw new Error(`Content has broken references:\n- ${errors.join("\n- ")}`);
  return bundle;
}

export function loadContent(): ContentBundle {
  const packs = RAW_REGION_PACKS.map(parseRegionPack);
  const quests = QuestFileSchema.parse(questsJson).quests;
  return buildBundle(packs, quests, parseWorldEvents(worldEventsJson), RAW_MAPS.map(parseMap));
}

export interface DialogueBank {
  /** True when any merged dialogue file is still placeholder. */
  placeholder: boolean;
  lines: Record<string, string[]>;
}

export function loadDialogue(): DialogueBank {
  const files: DialogueFile[] = Object.keys(RAW_DIALOGUE)
    .sort()
    .map((k) => DialogueFileSchema.parse(RAW_DIALOGUE[k]));
  const lines: Record<string, string[]> = {};
  for (const f of files) Object.assign(lines, f.lines);
  return { placeholder: files.some((f) => f.$meta.status !== "APPROVED"), lines };
}

/** Status of every content file, for the "is this text approved?" check. */
export function contentStatus(): { file: string; status: string }[] {
  return [
    { file: "regions/lagos/region.json", status: RegionPackSchema.parse(lagosJson).$meta.status },
    {
      file: "regions/lagos/dialogue.json",
      status: DialogueFileSchema.parse(lagosDialogueJson).$meta.status,
    },
    { file: "regions/lagos/map.json", status: MapFileSchema.parse(lagosMapJson).$meta.status },
    { file: "ui/web.json", status: UiTextFileSchema.parse(uiTextJson).$meta.status },
    { file: "quests/quests.json", status: QuestFileSchema.parse(questsJson).$meta.status },
    {
      file: "data/world-events.json",
      status: WorldEventFileSchema.parse(worldEventsJson).$meta.status,
    },
  ];
}

export interface UiText {
  placeholder: boolean;
  text: Record<string, string>;
}

/** Interface wording for the browser client. */
export function loadUiText(): UiText {
  const f = UiTextFileSchema.parse(uiTextJson);
  return { placeholder: f.$meta.status !== "APPROVED", text: f.text };
}
