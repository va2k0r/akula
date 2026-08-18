# Akula 971 — Frostbite Canyon prototype

The first playable Akula 971 vertical slice tests one question: can the accepted
acoustic-code system support a dramatic, gamepad-first nuclear-submarine action
game in a spacious, cold North Sea 3D map?

The slice includes:

- a licensed Project 971 / Akula player model;
- a real 8.0 × 8.0 km Kartverket / MAREANO multibeam patch with a broad
  meandering channel, pockmarks, furrows and seabed-use traces; its playable
  datum is compressed to a 22–180 m shelf with bounded sand waves, triplanar
  rock detail and slope-aligned individual boulders shared by rendering,
  collision, sonar occlusion and the chart;
- a localized cold-sea ecology layer: 2,820 distance-graded fish sprites in
  species-coherent persistent schools, close-range plankton flashes, sparse CC0
  cold-water coral colonies, Barents-style pockmarks, and map-scale glacial
  scours;
- a dual-JONSWAP North Atlantic surface: independent 13.5 s remote swell and
  5.6 s local wind sea drive the rendered mesh, whitecaps, and surfaced-boat
  heave/attitude from the same deterministic wave field;
- sparse surface activity: separated tanker, cargo, trawler, supply and patrol
  routes; spectrum-deformed persistent wakes, sea-state bow spray, one lit
  production rig with flare/crane/supply traffic, an occasional helicopter,
  localized gulls, and moving rain/squall/haze/clearing fronts;
- spatial benthic geography: shallow coastal kelp only, demersal cod, three
  colonized wrecks with ghost nets and sediment clouds, plus charted export
  pipeline and communications cables; open-water visibility and particles
  respond to depth, late-winter bloom, weather, bottom clearance and wreck
  disturbance;
- five persistent telegraph settings, inertial motion, rudder banking, dive
  planes, ballast, turbulence, and a chase camera that fades into a schematic
  tactical chart; indicated knots retain their acoustic/handling meaning while
  horizontal world travel uses a 4× gameplay distance scale;
- passive-sonar signal quality coupled to physical range and own-ship flow
  noise;
- a controller-first pre-contact bearing cue whose sparse, irregular pulses
  become more frequent as physical signal quality improves, before the passive
  ring becomes readable;
- the accepted three-rate acoustic engine and live synchronized scope;
- a licensed bank of 15 finite one-shots derived from authentic hydroacoustic,
  ship-engine, pump and rotating-machinery recordings: each channel can be
  isolated for counting, while the complete signature rides on one continuous
  rotating-propeller bed;
- permanent `ЦЕЛЬ N` tracks, editable three-number class hypotheses, and an
  acoustic-rate-derived assumed speed with no correct/wrong feedback;
- an automatic bearing-only TMA plot: historical observations, deterministic
  trajectory hypotheses constrained to the operational 2–25 km field, best
  solution, course projection, LOST handling, and up to 24 seconds of sanitized
  passive-bearing history retained before contact assignment;
- procedural underwater ambience, ballast noise, impacts, and active ping.
- a licensed North Sea tension cue on a separate music bus, automatically
  ducked while the passive array is live so the accepted acoustic ratio stays
  countable.

## Run

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4173/`. This is Akula 971's single canonical local origin:
both development and preview use it with strict port locking, and alternate
localhost ports stay digitally silent. If the port is already occupied by Akula
971, reuse that running instance instead of starting another server. The dive
begins automatically as soon as the hull and world assets are ready. A standard
gamepad is the intended input. Keyboard fallback is available.

Open `http://127.0.0.1:4173/?sound-library=1` for the countable contact sound
repository. It can isolate A/B/C or play all three together as one continuous
rotating signature for every neutral and hostile class in the current catalog.
Each class also exposes three overlaid modulation traces and a time-binned RMS
histogram calculated from the recorded WAVs. See
[`CONTACT_SOUND_REPOSITORY.md`](./CONTACT_SOUND_REPOSITORY.md).

Open `http://127.0.0.1:4173/?sfx-audition=1` for the numbered 01–37 research-SFX
audition page. It plays one local master at a time, preserves Tieni / Scarta /
Incerto decisions in the browser, and produces a text report that can be pasted
back into the task. The research masters remain outside `public/` and are only
served by the local Vite development server.

| Action                       | Gamepad     | Keyboard                         |
| ---------------------------- | ----------- | -------------------------------- |
| Rudder port / starboard      | Left stick  | `A` / `D`                        |
| Brake / faster telegraph     | `LB` / `RB` | `S` / `W`                        |
| Dive / rise                  | `LT` / `RT` | `F` / `R`                        |
| Flood / blow ballast         | —           | `G` / `B`                        |
| Camera / map rotate and zoom | Right stick | Arrow keys                       |
| Tactical chart               | `R3`        | `M`                              |
| Plan / close torpedo cursor  | `B`         | `T`                              |
| Set run-to-enable point      | `R3`        | `M` while plotting               |
| Select weapon category       | D-pad ↑ / ↓ | `+` / `−`                        |
| Cycle contextual TMA target  | D-pad ← / → | `[` / `]` while plotting         |
| Fire selected weapon         | `A`         | Enter                            |
| Center chase camera          | —           | `C`                              |
| Active ping                  | `Y`         | `P`                              |
| Reveal / edit contact code   | D-pad       | `[` / `]`, `-` / `+`, or `1`–`9` |
| Apply identity hypothesis    | `A`         | Enter                            |
| Reset vehicle                | View        | Backspace                        |

The telegraph is deliberately discrete: `REVERSE`, `STOP`, `SILENT`, `CRUISE`,
and `FLANK`. Each bumper press moves exactly one setting and the boat's mass
determines how quickly the actual speed catches up.

In the strategic chart, each R3 click while the torpedo cursor is open adds one
run-to-enable point to the pending salvo. `A` releases every set torpedo
together. While positioning, the nearest future TMA track is selected
automatically and projected to the torpedo's arrival time at the marker,
assuming the displayed course and speed stay constant. D-pad left/right cycles
the available TMA tracks without exposing hidden target truth. The vertical
selector also shows `РАКЕТЫ` and `МИНЫ`, but those two categories are
deliberately marked unavailable and have no weapon simulation yet.

Append `?debug=1` to expose latching pilot controls and a machine-readable
runtime state output for browser QA.

## Verify and build

```sh
npm run check
npm run preview
```

`npm run check` runs unit tests, TypeScript, ESLint, formatting validation, and
the production build.

`npm run audio:contact-bank` deterministically regenerates the 15 original WAV
one-shots and their hash manifest.

`python3 scripts/build-mareano-bathymetry.py` regenerates the synchronous 25 m
runtime grid from the retained 5 m source GeoTIFF. It requires Pillow and
NumPy; exact source coordinates, transformation and attribution are recorded
in `assets/source/mareano-shelf-east/SOURCE.md`.

## Repository baseline

`origin/main` is the stable, runnable Akula 971 baseline. Git contains the code,
tests, documentation, runtime files under `public/`, and the compact source
inputs needed to regenerate the contact bank and MAREANO grid. Large acquisition
and research libraries remain intact on the development machine under
`assets/research/` and the excluded portions of `assets/source/`; their catalogs,
checksums, licenses, and provenance notes remain versioned.

## Sonar canon

The accepted invariants remain in
[`ACOUSTIC_CODE_CANON.md`](./ACOUSTIC_CODE_CANON.md). Contact signatures are
unordered primitive integer ratios. Speed can change the shared cycle duration
but cannot alter class identity. The game continues to use the existing audio
engine as an isolated reusable module under `src/audio/`. The current Frostbite
contact deliberately uses the easy `1:2:4` ratio.

## Third-party assets

Sources, authors, licenses, hashes, conversion notes, and attribution are in
[`ASSET_CREDITS.md`](./ASSET_CREDITS.md). The player Akula and MAREANO
bathymetry are CC BY 4.0; the Poly Haven terrain detail and Smithsonian
cold-water coral are CC0. Software notices for adapted MIT rendering work are retained in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
