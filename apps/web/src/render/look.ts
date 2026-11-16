import type { CharacterLook } from "@liag/engine";
import { HAIRSTYLES, OUTFITS, SKIN_TONES } from "@liag/engine";
import { PALETTE, SKIN, hex } from "./color";
import type { Rand } from "../util/random";
import { hash } from "../util/random";

/** A look resolved to drawable numbers. */
export interface Look {
  skin: number;
  hairColor: number;
  build: CharacterLook["build"];
  hair: CharacterLook["hair"];
  headwear: CharacterLook["headwear"];
  outfit: CharacterLook["outfit"];
  top: number;
  bottom: number;
  accent: number;
  /** Carrying an umbrella (opened in the rain). */
  umbrella: boolean;
}

export function resolveLook(look: CharacterLook, umbrella: boolean): Look {
  return {
    skin: SKIN[Math.max(0, Math.min(SKIN.length - 1, look.skin))]!,
    hairColor: 0x1b1410,
    build: look.build,
    hair: look.hair,
    headwear: look.headwear,
    outfit: look.outfit,
    top: hex(look.colors.top),
    bottom: hex(look.colors.bottom),
    accent: hex(look.colors.accent),
    umbrella,
  };
}

const CLOTH = [
  0xe63946, 0xf1faee, 0x457b9d, 0x1d3557, 0x2a9d8f, 0xe9c46a, 0xf4a261, 0x264653, 0x8338ec,
  0xff006e, 0x3a86ff, 0xfb5607, 0x6a994e, 0x333333, 0xffffff,
];

/** A made-up passer-by. */
export function randomLook(r: Rand): Look {
  const outfit = r.pick(OUTFITS);
  const feminine = outfit === "dress" || outfit === "blouse_wrapper" || r.chance(0.3);
  return resolveLook(
    {
      skin: r.int(1, SKIN_TONES - 1),
      build: r.pick(["slim", "average", "broad"] as const),
      hair: feminine ? r.pick(["braids", "bun", "afro", "twists"] as const) : r.pick(HAIRSTYLES),
      headwear: feminine
        ? r.pick(["none", "none", "gele", "headscarf"] as const)
        : r.pick(["none", "none", "cap", "fila"] as const),
      outfit,
      colors: {
        top: `#${r.pick(CLOTH).toString(16).padStart(6, "0")}`,
        bottom: `#${r.pick(CLOTH).toString(16).padStart(6, "0")}`,
        accent: `#${r.pick(CLOTH).toString(16).padStart(6, "0")}`,
      },
    },
    r.chance(0.35),
  );
}

/** A character with no look in the content still gets a stable one from their id. */
export function fallbackLook(id: string): CharacterLook {
  const h = hash(id);
  return {
    skin: h % SKIN_TONES,
    build: "average",
    hair: HAIRSTYLES[(h >>> 4) % HAIRSTYLES.length]!,
    headwear: "none",
    outfit: OUTFITS[(h >>> 8) % OUTFITS.length]!,
    colors: {
      top: `#${PALETTE.signs[(h >>> 12) % PALETTE.signs.length]!.toString(16).padStart(6, "0")}`,
      bottom: "#333333",
      accent: "#f2f2f2",
    },
  };
}
