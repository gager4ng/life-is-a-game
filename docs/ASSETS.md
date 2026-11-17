# Third-party assets

Everything visual is built in code: the 3D city, people, vehicles and signs are geometry and
canvas-drawn text made at start-up, with no model or texture files. The only third-party files
are a few sounds, all
**CC0 (public domain dedication)**, downloaded from OpenGameArt.org on 2026-11-17. They live
in `apps/web/public/audio/` and are fetched only after the city is on screen (and only once
sound has been switched on by the first tap). Total: about **0.4 MB**.

Each file was trimmed, mixed down and re-encoded with ffmpeg as Ogg Vorbis (smaller,
loudness-normalised). The ambience loops also got a 1-second self-crossfade so they loop
without a click.

| File in the repo    | Used for                                                         | Original file, author                             | Source page                                                        | Licence | Changes                                                         |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ | ------- | --------------------------------------------------------------- |
| `audio/traffic.ogg` | Traffic hum                                                      | `gatve Varniu_2.ogg`, IgnasD                      | https://opengameart.org/content/high-traffic-road-sounds           | CC0     | First 30 s, mono 32 kHz, loop crossfade, normalised             |
| `audio/chatter.ogg` | Market chatter; short bursts as voices calling at the danfo park | `crowd_shouting.ogg`, StarNinjas                  | https://opengameart.org/content/crowd-shoutingspeaking-ambience    | CC0     | Mono 32 kHz, loop crossfade, normalised; low-passed in the game |
| `audio/horn1.ogg`   | Car horns                                                        | `Car_Horn.ogg` (Car Sound Effects Pack), GGBotNet | https://opengameart.org/content/car-sound-effects-pack-low-quality | CC0     | Mono 32 kHz, normalised                                         |
| `audio/horn2.ogg`   | Car horns                                                        | `car2.wav`, Yaroslav_Novikov                      | https://opengameart.org/content/car-signal                         | CC0     | Mono 32 kHz, normalised                                         |

Credit is not required under CC0, but the authors are named here anyway (StarNinjas asks for a
link to their profile if possible: https://opengameart.org/users/starninjas).

Removed in G-004: `audio/music.ogg` (Feel Good Island loop, CC0) and `audio/livemusic.ogg`
(Tropical loop, CC0). The music is now generated in code (below).

## Music

The background music and the live spot's band are an Afrobeats-style groove generated with Web
Audio (`apps/web/src/audio/groove.ts` and `music.ts`): log drum, kick, shaker, bell, rim, bass,
chords and percussion, synthesised. No samples or files.

Licensed tracks can be dropped into `apps/web/public/music/` and listed in `tracks.json` (see
the README). **Log every licensed track here** with its title, artist or producer, licence,
the date and the proof of licence.

| File in `public/music/` | Mode | Title, artist / producer | Licence and proof | Date |
| ----------------------- | ---- | ------------------------ | ----------------- | ---- |
| (none yet)              |      |                          |                   |      |

## Made in code (no files)

Rain, heavy rain, thunder, harmattan wind, night insects, buka frying sizzle and pot clinks,
the traffic rumble used before the recording loads, and every UI sound (tap, walk, encounter
chime, quest step, money gained or lost) are generated with the Web Audio API in
`apps/web/src/audio/sound.ts`.

## Not found as CC0

No CC0 recording of Nigerian danfo conductors calling routes ("Oshodi! Obalende!") was found.
For now, short bursts of the CC0 crowd clip play near the park in their place. A real recording
(made by us, or properly licensed) should replace it.
