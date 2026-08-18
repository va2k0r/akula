# AKULA prototype asset register

This file records every third-party asset shipped with the first playable
prototype. Runtime code and procedural geometry are original project work.

## North Sea marine-life encounters

- **Use:** spatially fixed, low-duty-cycle habitat encounters: rare orca,
  baleen whale, grey seal and three-animal harbour-porpoise group, plus two
  longer but still intermittent jellyfish drifts. Nothing follows the camera.
- **License:** all five selected works are
  [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Sources and attribution:**
  - [“ORCA”](https://sketchfab.com/3d-models/orca-db32f6164828462eaf8d3fe87c0aad85)
    by Cenker Turhan
  - [“Blue whale (Animated, downloadable)”](https://sketchfab.com/3d-models/blue-whale-animated-downloadable-1fc22d7e249b41b995dbff1052bb2a1a)
    by Андрей
  - [“Seal”](https://sketchfab.com/3d-models/seal-0616281841b44983b1c113b578c0f0ce)
    by rkuhlf
  - [“Jellyfish”](https://sketchfab.com/3d-models/jellyfish-c8ba1a3e4ca54af099e62cd89ba1b661)
    by MrDeivid
  - [“Dolphin model (with easy texture)”](https://sketchfab.com/3d-models/dolphin-model-with-easy-texture-ece0cd544108424ba1e665db2149d74d)
    by Sky4gj
- **Downloaded:** 2026-08-17
- **Untouched archives, normalized metadata, checksums, conversion record:**
  `assets/source/sketchfab-marine-life/`
- **Runtime directory:** `public/assets/models/marine-life/`
- **Conversion:** glTF-Transform 4.4.2; all source geometry retained and Draco
  compressed. Orca and whale PBR maps were reduced from 4K to a maximum of 1K
  and encoded as WebP; the originals remain untouched in the source archives.
- **Animation:** the whale uses its supplied `Play` clip and the seal its
  supplied `Swim` clip. Orca, jellyfish, and cetacean proxy have deterministic runtime
  path, bank, pulse, and/or tail-flex animation because their glTF exports do
  not contain clips.
- **Porpoise proxy:** the lightweight dolphin source is rescaled to
  1.55–1.78 m and used only as a distant harbour-porpoise proxy. It is not
  presented as a species-accurate hero asset.
- **Fallback note:** no freely redistributable, exact, realistically textured
  animated seal met the other models' detail level. The exact rigged seal is
  retained instead of substituting the wrong species; it has 610 faces and
  three embedded clips.

## Sparse North Sea surface fleet and oil rig

- **Use:** one tanker and one weathered cargo vessel on separated commercial
  routes, one platform supply vessel, one distant fishing trawler, and one
  fixed production rig. Route, roll, pitch, bow spray, persistent wake, fog
  reveal, industrial lights, flare, crane and helicopter behavior are runtime
  systems rather than baked animation.
- **Runtime directory:** `public/assets/models/north-sea/`
- **CC BY 4.0 sources:**
  - [“Tanker”](https://sketchfab.com/3d-models/tanker-7348ef4bc7da4540a28d307409106467)
    by James Neal
  - [“Cargo ship”](https://sketchfab.com/3d-models/cargo-ship-b7c97df584824ca682d26daabf401f87)
    by hungry_drifter
  - [“Supplyship”](https://sketchfab.com/3d-models/supplyship-fe110d01a17d4689bda8304092e490d5)
    by 1to3fall5
  - [“Oil Rig”](https://sketchfab.com/3d-models/oil-rig-2a9fadae585f4bbfa030772e54e64ace)
    by AnsysLearn
- **CC0 source:** [Kenney Watercraft Kit 2.0](https://opengameart.org/content/watercraft-kit),
  `boat-fishing-small.glb`, used as the distant trawler source.
- **Downloaded / promoted:** 2026-08-17 / 2026-08-18
- **Untouched research library and provenance:**
  `assets/research/north-sea-1980s/`; original filenames, source URLs, creator,
  license, review status and checksums are in `MANIFEST.tsv`, `CATALOG.md` and
  `CHECKSUMS.sha256`.
- **Runtime SHA-256:** tanker
  `9a0d55c03c6bb9852b6719794dcd13231bfac212d2e908f658f13ceffc7eb82e`;
  cargo ship
  `20de84b0404a6e414543caeb7fc988fe12ef92c4b4b15bd5a94afcacfa628f2e`;
  supply vessel
  `5ea2521dc560a4ff877b9be2307a28d19280cdb54c70d80a85364779417e370d`;
  oil rig
  `22ec6e051ef0bde27d586f9c7830f528e2fe69e34e73ad370e6b0ce9dc7dd4c3`;
  fishing trawler
  `f6a03c86e7147764de6aac135433a428ee503d42852ecd101c1795a278480742`;
  trawler palette texture
  `311138350e74e35c5497a1bd8076a01740b7c302bed11027639fa553459a68de`.
- **Runtime changes:** `scripts/normalize-north-sea-glb.mjs` converts the
  tanker's deprecated `KHR_materials_pbrSpecularGlossiness` block to standard
  metallic/roughness values without changing geometry or image payloads. The
  other stored GLBs are unchanged. Source transforms are normalized in code;
  procedural fallback silhouettes remain available if decoding fails.

## Generated North Atlantic fish atlas

- **Use:** realistic photographic sprites for localized cold-water fish
  schools
- **Species represented:** Atlantic herring, Atlantic mackerel, saithe/pollock,
  and juvenile Atlantic cod
- **Generated:** 2026-08-17 with the built-in OpenAI image-generation tool
- **Runtime format:** 1,536 × 1,024 transparent RGBA PNG at
  `public/assets/textures/fauna/north-atlantic-fish-atlas.png`
- **Source record and exact prompt:**
  `assets/source/generated-north-atlantic-fish-atlas/SOURCE.md`
- **Runtime SHA-256:**
  `b08dcb0a9027f13d8f9bac93b4a6fdb5db241d6fff4644c7d47ad6d21a761c51`
- **Changes:** none to the generated bitmap; runtime shader atlas selection,
  underwater grading, distance attenuation and subtle tail deformation do not
  alter the stored source pixels
- **Third-party stock material:** no

## Authentic countable contact sound bank

- **Use:** neutral and hostile propeller, pump, blade-wash, reduction-gear, and
  diesel-engine contact signatures
- **Source recordings:**
  - “Frachter I.ogg,” freight-ship cavitation, L. Ginkey / Forschungsanstalt
    der Bundeswehr für Wasserschall und Geophysik,
    [CC BY 2.5](https://creativecommons.org/licenses/by/2.5/), from
    https://commons.wikimedia.org/wiki/File:Frachter_I.ogg
  - “WWS IcebreakerKunashipsengine.ogg,” icebreaker _Kuna_ engine room, Monika
    Widzicka / Work With Sounds,
    [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), from
    https://commons.wikimedia.org/wiki/File:WWS_IcebreakerKunashipsengine.ogg
  - “WWS Maudslayengine.ogg,” pump engine, Ben Minto / Soundkids / Work With
    Sounds, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), from
    https://commons.wikimedia.org/wiki/File:WWS_Maudslayengine.ogg
  - “WWS Valvefeedingmachine.ogg,” rotating valve machinery, Maasa Järvinen /
    Work With Sounds, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
    from https://commons.wikimedia.org/wiki/File:WWS_Valvefeedingmachine.ogg
  - “WWS ModelAhotbulbboatengine.ogg,” hot-bulb boat engine, Torsten Nilsson /
    Work With Sounds,
    [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), from
    https://commons.wikimedia.org/wiki/File:WWS_ModelAhotbulbboatengine.ogg
- **Downloaded / derivatives generated:** 2026-08-17
- **Untouched originals and checksums:** `assets/source/contact-recordings/`
- **Runtime format:** 15 mono 48 kHz, 16-bit PCM WAV one-shots under
  `public/assets/audio/contacts/countable/v1/`
- **Generator:** `scripts/generate-contact-sound-bank.mjs`
- **Manifest:** `public/assets/audio/contacts/countable/v1/MANIFEST.json`
- **Third-party material:** yes; all five original recordings and their runtime
  excerpts remain under the licenses above
- **Changes:** source-range selection, channel selection, resampling/playback-
  rate adjustment, light high/low-pass filtering, anti-click and tail fades,
  peak normalization, and mono PCM export; exact ranges and edits are in the
  manifest
- **Design constraint:** one natural recorded mechanical event per file, with
  pre-roll, readable attack, finite tail, and true silence in isolated playback
  so literal class ratios remain countable; no synthesized transient, generated
  noise, modeled machinery, or drone-only WAV is used. `PLAY ALL` adds a
  continuous overlap-add bed derived from recorded A without adding a fourth
  countable rate.

## Recorded hull-stress micro-event bank

- **Use:** sparse internal steel-pressure events during fast descent and
  torsional events during high-speed turns
- **Source recordings:** audition items 27 and 28 from the USC Optical Sound
  Effects Library: “Car body crushed by machine; leaks and moans” and “Steel
  girders wrench and tear; creaking metal”
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- **Untouched originals, collection metadata, and checksums:**
  `assets/research/submarine-sfx-2026-08-17/`
- **Original SHA-256:**
  `c0e18e0ab464efbd2fa902bf33e6e1863c61d7ea31477e865e3343058eb64a73`
  (item 27) and
  `1068d8af03371a3d59ac554428e59a0703d9e73892fa2a4299eb3e71e57a36f3`
  (item 28)
- **Runtime format:** 19 finite mono 48 kHz, 16-bit PCM WAV one-shots under
  `public/assets/audio/hull-stress/v1/`: 8 pressure/descent events and 11
  torsion/maneuver events
- **Generator:** `scripts/generate-hull-stress-bank.mjs`
- **Manifest:** `public/assets/audio/hull-stress/v1/MANIFEST.json`; it records
  every selected source range, playback-rate adjustment, filter, fade, level,
  duration, and runtime checksum
- **Changes:** individual segment selection, restrained playback-rate change,
  light high/low-pass filtering, anti-click and tail fades, peak normalization,
  silent tail, and PCM16 export; no synthesized metal or procedural noise
- **Runtime behavior:** no loop. Event cadence and gain grow gradually with
  actual positive descent rate or with the product of actual horizontal speed
  and actual yaw rate. Controller/rudder amplitude is not a trigger.
- **Mix boundary:** the bank enters the existing own-ship duck bus, so focused
  passive-sonar listening clears it without changing the approved A/B/C contact
  signatures.

## North Sea — Freight Hop

- **Use:** looping Frostbite Canyon gameplay score; the music runs on a
  dedicated bus and is ducked while the passive sonar array is live
- **Track:** `freight_hop - loop - tensed - action.mp3`
- **Author:** Makoto Hiramatsu
- **Source:** https://makotohiramatsu.itch.io/north-sea
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0)
- **License URL:** https://creativecommons.org/licenses/by/4.0/
- **Downloaded:** 2026-08-16
- **Source archive:** `assets/source/makoto-north-sea/north_sea_mp3.zip`
- **Runtime file:** `public/assets/audio/music/north-sea/freight-hop.mp3`
- **Changes:** no edit to the supplied recording; the runtime copy is renamed
  and its playback level is mixed dynamically in code
- **Archive SHA-256:**
  `f3becc9bf5424686505c167ba52183c65ea94c85bd04032ca3c1b6a20d6a93b0`
- **Runtime SHA-256:**
  `83c1797fa5fa8738033ab66278920898716f0837bd6a6518be7a43bfdce2f86f`
- **Attribution:** “Freight Hop” from _North Sea_ by Makoto Hiramatsu,
  licensed under CC BY 4.0.

## Piper Russian sonarist voice

- **Use:** offline-generated Russian contact reports with live bearing digits
- **Voice:** `ru_RU-denis-medium`
- **Source:** https://huggingface.co/rhasspy/piper-voices/tree/main/ru/ru_RU/denis/medium
- **License:** CC0 1.0 Universal
- **Generated:** 2026-08-16
- **Runtime format:** 22,050 Hz mono AAC-LC in M4A containers under
  `public/assets/audio/comms/ru/denis-new-contact/`
- **Runtime dependency:** none; Piper was used only for offline generation

## North Sea surface storm

- **Use:** diegetic open-ocean storm above the moving waterline; the dedicated
  surface bus closes rapidly to a near-silent, low-frequency pressure trace as
  the camera enters the water
- **Recording:** “Storm at Sea”
- **Author:** Codeine
- **Source:** https://freesound.org/people/Codeine/sounds/331435/
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- **Research source:**
  `assets/research/north-sea-1980s/audio/freesound-previews/331435-storm-at-sea-cc0.mp3`
- **Runtime file:**
  `public/assets/audio/environment/north-sea/storm-at-sea-cc0.mp3`
- **Runtime format:** 196.702 s stereo, 44.1 kHz MP3 Freesound preview
- **Runtime SHA-256:**
  `1e1d18b6dcafe9ff1f1d27277cc5a9784cf836386275d1a0847e075673251cdd`
- **Manifest:**
  `public/assets/audio/environment/north-sea/MANIFEST.json`
- **Changes:** no file edit; gain, low-pass opening, and waterline transition
  are applied non-destructively at runtime
- **Mix boundary:** this recording never enters the sonar-contact, comms, or
  own-ship buses, so it does not retune or synthesize any accepted A/B/C layer
- **Prototype note:** this is the catalogued Freesound preview. Replace it with
  the original master before a final distributable audio package if available.

## WaterThreeJS rendering reference

- **Use:** MIT-licensed basis for the ocean reflection, refraction, optical
  depth, underwater window, detail-normal, and foam pipeline; AKULA replaces
  the source wave progression with its own dual-JONSWAP component generator.
- **Author:** mohamedachrefelouafi
- **Source:** https://github.com/achrefelouafi/WaterThreeJS
- **License:** MIT
- **Reviewed:** 2026-08-16
- **Compatibility:** upstream uses Three.js 0.185 and WebGL2, matching the
  prototype renderer generation.
- **Notice:** full license text is retained in `THIRD_PARTY_NOTICES.md`.

## MAREANO 5 m multibeam bathymetry

- **Use:** survey-derived macro terrain for the complete 8 × 8 km Frostbite
  maneuver chart
- **Provider / attribution:** Kartverket / MAREANO
- **Dataset:** _Depth data - terrain models 5 metres grid_
- **Source:**
  https://data.norge.no/en/datasets/21edd19c-1f1c-3204-a733-160caab90481/dybdedata-terrengmodeller-5-meters-grid
- **Service:** Kartverket DTM2 WCS, coverage `bathymetry05m`
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0)
- **License URL:** https://creativecommons.org/licenses/by/4.0/
- **Downloaded:** 2026-08-17
- **Source location:** 71.873203 N, 17.152673 E; 8 km square in
  `EPSG:25833`
- **Source record:** `assets/source/mareano-shelf-east/SOURCE.md`
- **Source file:**
  `assets/source/mareano-shelf-east/bathymetry05m.tif`
- **Runtime format:** deterministic 321 × 321 signed-height payload generated
  in `src/game/MareanoBathymetry.ts`
- **Conversion:** box-filtered from 5.033 m to 25 m spacing and quantized to
  0.1 m. Source elevations -375.01…-311.12 m are mapped to game heights
  -310…-145 m (2.5826× vertical exaggeration); horizontal coordinates and
  relative morphology are retained.
- **Source SHA-256:**
  `e01a769c077a5629ae49b0a3d347a7236bf72d821ba830cf606f66e586e78f95`
- **Attribution:** “Bathymetry: Kartverket / MAREANO, licensed under CC BY
  4.0; vertically exaggerated and downsampled for AKULA.”

## Soviet Submarine

- **Use:** player vehicle, NATO Akula / Project 971 visual stand-in
- **Author:** BlenderVoyage
- **Source:** https://blendervoyage.itch.io/soviet-submarine
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0)
- **License URL:** https://creativecommons.org/licenses/by/4.0/
- **Downloaded:** 2026-08-16
- **Source format:** ZIP containing FBX, GLB, and three JPEG textures
- **Source archive:** `assets/source/blendervoyage-soviet-submarine/SovietSub.zip`
- **Runtime format:** `public/assets/models/akula/akula.glb`
- **Conversion:** the supplied GLB was resized with glTF-Transform 4.4.2;
  embedded textures were reduced from 2K/4K to a maximum of 1K. Geometry,
  materials, UVs, and attribution were preserved. Runtime size is 1.3 MB,
  reduced from 5.83 MB.
- **Attribution:** “Soviet Submarine” by BlenderVoyage, licensed under CC BY
  4.0.

## Rock Face 01

- **Use:** legacy scanned wall source retained for provenance; no longer loaded
  by the current scene and never projected across the terrain
- **Author:** Dario Barresi
- **Source:** https://polyhaven.com/a/rock_face_01
- **License:** CC0 1.0 Universal
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Downloaded:** 2026-08-16
- **Runtime format:** glTF 2.0 with 1K JPEG PBR textures
- **Conversion:** none; the official Poly Haven 1K glTF variant is used.
- **Attribution:** not required by CC0; retained here for provenance.

## Rock 07

- **Use:** instanced three-dimensional boulder and talus fields
- **Author:** Jenelle van Heerden
- **Source:** https://polyhaven.com/a/rock_07
- **License:** CC0 1.0 Universal
- **License URL:** https://polyhaven.com/license
- **Downloaded:** 2026-08-16
- **Source files:** `assets/source/polyhaven-rock-07/`
- **Runtime format:** `public/assets/models/rock-07/rock_07_1k.glb`
- **Conversion:** welded and simplified with glTF-Transform 4.4.2 to 18% with
  a 0.4% mesh-radius error ceiling. The runtime mesh contains 2,670 triangles
  and retains the original UVs and embedded 1K PBR maps.
- **Runtime SHA-256:**
  `bdd279f438fcd7cad6dfc0043a9c73435bac5e340c8e78e5527925e05d462fb9`

## Rocks Ground 06

- **Use:** seamless seabed PBR material, projected in world space with
  triplanar blending
- **Author:** Rob Tuytel
- **Source:** https://polyhaven.com/a/rocks_ground_06
- **License:** CC0 1.0 Universal
- **License URL:** https://polyhaven.com/license
- **Downloaded:** 2026-08-16
- **Runtime format:** official 1K diffuse, OpenGL normal, and ARM JPEG maps in
  `public/assets/textures/rocks-ground-06/`
- **Conversion:** none. The source maps are tileable; AKULA does not reuse a
  model-specific UV atlas as a terrain texture.

## Coastal Cliff 01

- **Use:** retained as a reviewed source but no longer loaded by the scene. The
  elongated wall placements were removed in favor of slope-aligned instances
  of the individual Rock 07 asset.
- **Authors:** Rob Tuytel (photography and processing), Rico Cilliers (cleanup)
- **Source:** https://polyhaven.com/a/coastal_cliff_01
- **License:** CC0 1.0 Universal
- **License URL:** https://polyhaven.com/license
- **Downloaded:** 2026-08-16
- **Source format:** official 1K glTF with JPEG PBR textures
- **Source files:** `assets/source/polyhaven-coastal-cliff-01/`
- **Runtime format:** `public/assets/models/coastal-cliff/coastal_cliff_01.glb`
- **Conversion:** welded and simplified with glTF-Transform 4.4.2 to 12% of
  source vertices with a 0.3% mesh-radius error ceiling. The runtime GLB is
  3.51 MB and retains the source UVs and PBR material.
- **Runtime SHA-256:**
  `6926b4be9e4ad0bd4be7ed19994ef6f956f2c607b074f8e10df34c819eae3243`

## Solid Iceberg Bases

- **Use:** four distinct, closed iceberg volumes with scanned surface detail
- **Source assets:**
  - [Boulder 01](https://polyhaven.com/a/boulder_01), Rico Cilliers
  - [Namaqualand Boulder 03](https://polyhaven.com/a/namaqualand_boulder_03),
    Jenelle van Heerden and Dario Barresi
  - [Namaqualand Boulder 04](https://polyhaven.com/a/namaqualand_boulder_04),
    Jenelle van Heerden
  - [Namaqualand Boulder 06](https://polyhaven.com/a/namaqualand_boulder_06),
    Greg Zaal and Jenelle van Heerden
- **License:** CC0 1.0 Universal
- **License URL:** https://polyhaven.com/license
- **Downloaded:** 2026-08-16
- **Source files:** `assets/source/polyhaven-boulder_01/` and the three
  `assets/source/polyhaven-namaqualand_boulder_*` directories listed above
- **Runtime directory:** `public/assets/models/icebergs/`
- **Conversion:** official 1K glTF variants were welded and simplified with
  glTF-Transform 4.4.2. Runtime meshes contain 54,544, 31,112, 30,714, and
  30,548 triangles respectively and retain UVs plus 1K diffuse, normal, and ARM
  maps.
- **Topology verification:** all four source meshes have zero geometric
  boundary edges and zero non-manifold edges after positional seam welding.
  Runtime deformation changes only vertex positions, normals, and colors; it
  does not alter indices or UVs.
- **Runtime SHA-256:**
  - `boulder_01_ice.glb`:
    `b64a8aac295ba31f6beefec74393858a973df6a6effab006e440c74102536de2`
  - `namaqualand_boulder_03_ice.glb`:
    `dd838c0beacf9656c6827bce64ea4873bb71feb93d9c0790a6c92f9e33d42afd`
  - `namaqualand_boulder_04_ice.glb`:
    `740eb48744b1b81305d88b41b981235ab80134a8b70684591ed4ddaf1b5d8501`
  - `namaqualand_boulder_06_ice.glb`:
    `6921e1025c21e99f2407c89b738fee784ba574a59b164ea025c3b017515b3e4b`

## Snow 02

- **Use:** PBR diffuse, OpenGL normal, roughness, and displacement sources for
  pack-ice surface detail
- **Author:** Rob Tuytel
- **Source:** https://polyhaven.com/a/snow_02
- **License:** CC0 1.0 Universal
- **License URL:** https://polyhaven.com/license
- **Downloaded:** 2026-08-16
- **Runtime format:** official 1K JPEG maps in
  `public/assets/textures/snow-02/`
- **Conversion:** none.

## Lophelia pertusa cold-water coral

- **Use:** sparse instanced cold-water coral colonies on suitable Frostbite
  Canyon rift shoulders
- **Published name:** _Desmophyllum pertusum_ (syn. _Lophelia pertusa_)
- **Institution:** Smithsonian National Museum of Natural History,
  Invertebrate Zoology
- **Collection number:** USNM 1071877
- **Source:**
  https://3d.si.edu/object/3d/lophelia-pertusa%3A212a8c08-42e9-4895-803b-2bfc54e82c22
- **License:** CC0 / public domain under Smithsonian Open Access
- **License information:** https://www.si.edu/openaccess/faq
- **Downloaded:** 2026-08-17
- **Source record:** `assets/source/smithsonian-lophelia/SOURCE.md`
- **Runtime format:** Draco-compressed 20k Web3D GLB at
  `public/assets/models/lophelia/lophelia-20k.glb`
- **Conversion:** no geometry or texture conversion; the runtime copy is the
  official 20k Smithsonian derivative with a shorter filename
- **Runtime SHA-256:**
  `f5cea852e7d6a6879a253925c3fbb39a7b1a54bc2c6c33ad5b5720a3e9c7f3e7`
- **Attribution:** “Lophelia pertusa, USNM 1071877,” Smithsonian National
  Museum of Natural History. CC0; credit retained for provenance.

## Reviewed but not shipped

- **P3POLYGON “Iceberg” (Sketchfab):** CC BY, but the download requires an
  authenticated Sketchfab account and its hand-painted low-poly treatment does
  not meet this pass's photoreal target. The shipped iceberg geometry instead
  starts from the four closed Poly Haven photogrammetry assets above.
- **TurboSquid / Free3D Akula models:** visually stronger commercial options
  were marked “Editorial Uses Only”, so they are unsuitable as the
  distributable game prototype base.
