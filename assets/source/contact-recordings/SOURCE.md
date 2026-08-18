# Authentic contact-recording sources

These five original Ogg Vorbis files are retained unchanged. AKULA extracts
short mechanical events from them; it does not redistribute them as a generic
sound-effects pack. Downloaded from Wikimedia Commons on 2026-08-17.

## Sources and attribution

### Freight-ship cavitation

- Local file: `frachter-i-cavitation.ogg`
- Original: “Frachter I.ogg”
- Subject: hydroacoustic cavitation noise from a freight ship
- Author: L. Ginkey
- Institution: Forschungsanstalt der Bundeswehr für Wasserschall und Geophysik
- Source: https://commons.wikimedia.org/wiki/File:Frachter_I.ogg
- License: Creative Commons Attribution 2.5 Generic
- License: https://creativecommons.org/licenses/by/2.5/
- SHA-256:
  `0f9863b34e4c121dcb86a1af43fe84826e107382fef4523d072069c37412ea82`

### Icebreaker _Kuna_ engine room

- Local file: `icebreaker-kuna-engine-room.ogg`
- Original: “WWS IcebreakerKunashipsengine.ogg”
- Subject: SW 680 combustion engine operating in the icebreaker’s engine room
- Recordist: Monika Widzicka / Work With Sounds
- Institution: Museum of Municipal Engineering
- Source:
  https://commons.wikimedia.org/wiki/File:WWS_IcebreakerKunashipsengine.ogg
- License: Creative Commons Attribution 4.0 International
- License: https://creativecommons.org/licenses/by/4.0/
- SHA-256:
  `a9ae970fc4571fb57fa2487f374fa01b5a7e04c0cff8db5ccb9abb9d8376651b`

### Maudslay pump engine

- Local file: `maudslay-pump-engine.ogg`
- Original: “WWS Maudslayengine.ogg”
- Subject: Maudslay beam engine directly driving a water pump
- Recordist: Ben Minto / Soundkids / Work With Sounds
- Source: https://commons.wikimedia.org/wiki/File:WWS_Maudslayengine.ogg
- License: Creative Commons Attribution 4.0 International
- License: https://creativecommons.org/licenses/by/4.0/
- SHA-256:
  `a21d491c6c0c4a21033177c1defee8c0dc4e8490d37e47787a2a7b23109b6f4e`

### Valve-feeding machine

- Local file: `valve-feeding-machine.ogg`
- Original: “WWS Valvefeedingmachine.ogg”
- Subject: rotating industrial machine that orients valves for aerosol cans
- Recordist: Maasa Järvinen / Work With Sounds
- Institution: Werstas
- Source: https://commons.wikimedia.org/wiki/File:WWS_Valvefeedingmachine.ogg
- License: Creative Commons Attribution 4.0 International
- License: https://creativecommons.org/licenses/by/4.0/
- SHA-256:
  `e3399162e1f631686c626a18afa2165a01e4966eb71133c150f702bf3bf3757b`

### Hot-bulb boat engine

- Local file: `hot-bulb-boat-engine.ogg`
- Original: “WWS ModelAhotbulbboatengine.ogg”
- Subject: 1930s hot-bulb boat engine operating a chain-link scoop mechanism
- Recordist: Torsten Nilsson / Work With Sounds
- Source:
  https://commons.wikimedia.org/wiki/File:WWS_ModelAhotbulbboatengine.ogg
- License: Creative Commons Attribution 4.0 International
- License: https://creativecommons.org/licenses/by/4.0/
- SHA-256:
  `90c1c873d9142d56b6d89163eeb9dc4cd30d407f4db2f94ab2a61884d2971237`

## Derivative editing

`scripts/generate-contact-sound-bank.mjs` verifies every source hash, decodes
the Ogg recording, selects an explicitly recorded mechanical onset with
pre-roll, and exports a mono 48 kHz PCM WAV. Permitted edits are channel
selection, resampling/playback-rate adjustment, light high/low-pass filtering,
anti-click fade-in, natural-tail fade, peak normalization, and a 3 ms digital-
silence tail. No oscillator, synthetic transient, generated noise, or modeled
machine layer is added.

The exact source range and every transformation for all 15 derivatives are
recorded in `public/assets/audio/contacts/countable/v1/MANIFEST.json`.
