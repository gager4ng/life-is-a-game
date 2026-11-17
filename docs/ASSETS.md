# Third-party assets

Everything visual is drawn in code. The only third-party files are a few sounds, all
**CC0 (public domain dedication)**, downloaded from OpenGameArt.org on 2026-11-17. They live
in `apps/web/public/audio/` and are fetched only after the city is on screen (and only once
sound has been switched on by the first tap). Total: about **0.8 MB**.

Each file was trimmed, mixed down and re-encoded with ffmpeg as Ogg Vorbis (smaller,
loudness-normalised). The ambience loops also got a 1-second self-crossfade so they loop
without a click.

| File in the repo      | Used for                                                         | Original file, author                                                  | Source page                                                        | Licence                                          | Changes                                                         |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------- |
| `audio/traffic.ogg`   | Traffic hum                                                      | `gatve Varniu_2.ogg`, IgnasD                                           | https://opengameart.org/content/high-traffic-road-sounds           | CC0                                              | First 30 s, mono 32 kHz, loop crossfade, normalised             |
| `audio/chatter.ogg`   | Market chatter; short bursts as voices calling at the danfo park | `crowd_shouting.ogg`, StarNinjas                                       | https://opengameart.org/content/crowd-shoutingspeaking-ambience    | CC0                                              | Mono 32 kHz, loop crossfade, normalised; low-passed in the game |
| `audio/horn1.ogg`     | Car horns                                                        | `Car_Horn.ogg` (Car Sound Effects Pack), GGBotNet                      | https://opengameart.org/content/car-sound-effects-pack-low-quality | CC0                                              | Mono 32 kHz, normalised                                         |
| `audio/horn2.ogg`     | Car horns                                                        | `car2.wav`, Yaroslav_Novikov                                           | https://opengameart.org/content/car-signal                         | CC0                                              | Mono 32 kHz, normalised                                         |
| `audio/music.ogg`     | Background music loop                                            | `feel_good_island_loop.ogg`, Brandon Morris (loop edit by AntumDeluge) | https://opengameart.org/content/feel-good-island-loop              | CC0 (dual-licensed OGA-BY 3.0 / CC0; we use CC0) | Normalised, re-encoded                                          |
| `audio/livemusic.ogg` | Live music from the live spot in the evening                     | `Tropical.wav`, wipics                                                 | https://opengameart.org/content/tropical-loop                      | CC0                                              | Mono 32 kHz, normalised, re-encoded                             |

Credit is not required under CC0, but the authors are named here anyway (StarNinjas asks for a
link to their profile if possible: https://opengameart.org/users/starninjas).

## Made in code (no files)

Rain, heavy rain, thunder, harmattan wind, night insects, buka frying sizzle and pot clinks,
the traffic rumble used before the recording loads, and every UI sound (tap, walk, encounter
chime, quest step, money gained or lost) are generated with the Web Audio API in
`apps/web/src/audio/sound.ts`.

## Not found as CC0

No CC0 recording of Nigerian danfo conductors calling routes ("Oshodi! Obalende!") was found.
For now, short bursts of the CC0 crowd clip play near the park in their place. A real recording
(made by us, or properly licensed) should replace it.
