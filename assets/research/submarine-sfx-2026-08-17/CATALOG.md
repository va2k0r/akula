# AKULA — Submarine weapons and damage SFX research

Research snapshot: 2026-08-17

This is a source library and acquisition shortlist, not a change to AKULA's
approved acoustic mix. The accepted A/B/C contact identity remains untouched.

## What is already local

- 37 original WAV masters, 293 MB on disk, 27 min 12.973 s total.
- Every local master is mono LPCM, 48 kHz, 24-bit.
- Every transfer was checked against the byte count and MD5 published by the
  source, then recorded with a local SHA-256 in `CHECKSUMS.sha256`.
- License: CC0 1.0 according to the metadata of each Internet Archive item.
- Source: USC Optical Sound Effects Library. These are archival recordings and
  optical-library transfers, useful as period source material and design layers;
  they are not recordings of a Project 971 and should not be presented as such.
- The files are research masters. They have not been restored, denoised,
  normalized, or edited into gameplay events. A source-level listening pass was
  completed on 2026-08-18; `keep` means approved as construction material, not
  that the untouched master is an approved runtime mix.

Provenance lives in `MANIFEST.tsv`. The complete 28-keep / 9-reject listening
decision lives in `SELECTION.tsv`. Measured format, duration, hashes, and file
sizes live in `TECHNICAL_QA.tsv`. Rejected masters remain archived so the
research record stays reproducible.

Primary public sources:

- [USC Sound Effect Archive collection](https://archive.org/details/usc-sound-effect-archive)
- [Gold Tape 45 — Submarine Effects](https://archive.org/details/GOLD_TAPE_45_Submarine_Effects)
- [SSE Library — Boats](https://archive.org/details/SSE_Library_BOATS)
- [SSE Library — Metal](https://archive.org/details/SSE_Library_METAL)
- [Red Library — Air Industry](https://archive.org/details/Red_Library_Air_Industry)
- [SSE Library — Water](https://archive.org/details/SSE_Library_WATER)
- [SSE Library — Aircraft](https://archive.org/details/SSE_Library_AIRCRAFT)
- [CC0 1.0 legal code](https://creativecommons.org/publicdomain/zero/1.0/legalcode)

All short local paths below are relative to
`masters/usc-sound-effect-archive/`.

## Audition first

This order gives a fast representative pass without implying that any source is
already approved:

1. `torpedo/g45-13-submarine-torpedo-fire.wav`
2. `torpedo/g45-34-reverberant-torpedos.wav`
3. `ballast/boats-sub-ballast-blow-explosive.wav`
4. `torpedo/boats-torpedo-traveling-popping-prop.wav`
5. `hull-stress/metal-steel-girders-wrench-tear.wav`
6. `hull-stress/metal-car-crusher-leaks-moans.wav`
7. `flooding/water-big-flood.wav`
8. `explosions/g45-35-distant-explosions-underwater.wav`
9. `explosions/g45-11-submarine-depth-charge.wav`
10. `submarine/g45-30-submarine-hatch-opening.wav`
11. `missile/aircraft-titan-missile-launch-long.wav`
12. `interior/boats-sub-control-room.wav`

## Coverage by gameplay event

### Torpedo-tube opening and preparation

Local starting layers:

- `submarine/g45-30-submarine-hatch-opening.wav`
- `interior/g45-33-interior-forward-torpedo-room.wav`
- `interior/g45-28-submarine-annunciator.wav`
- `air/r17-01-pressurized-air.wav`

The hatch recording is useful material, but it is not verified as a torpedo-tube
breech or muzzle door. Do not label it as an authentic tube opening. The best
exact catalogued candidate is Network SFX `NTWK087-92`: military torpedo breech
door opens/closes and locks with a ratchet. The Network library is unusually
large and appears to have limited physical-stock availability, so confirm an
individual-license path before buying it.

- [Network Sound Effects Library](https://portal.sound-ideas.com/Product/199/Network-Sound-Effects-Library)
- [Network SFX track list](https://www.bhphotovideo.com/FrameWork/Product_Resources/Network_SFX_Track_Listing.pdf)
- [20th Century Fox track list](https://soundideas.systemsinteractive.ca/Files/SpecificationFile/20th_Century_Fox_Sound_Effects_Library.pdf) — `TCF08-88` loads a torpedo into a tube and `TCF08-89` fires it.

Recommended event construction: safety/ratchet, handwheel or hydraulic load,
heavy door movement, dog/latch closure, pressure equalization, then room tone.
Avoid one cinematic metal slam for every state change.

### Flooding a torpedo tube

Local starting layers:

- `ballast/boats-sub-ballast-release.wav`
- `air/r17-35-steam-or-compressed-air.wav`
- `flooding/water-big-flood.wav`

`water-big-flood.wav` is a broad turbulent-water source, not an authentic tube
flood. Use only a short, filtered section beneath a valve transient. A compact
high-resolution fill source is a stronger purchase for this event:

- [Container submerge and fill — Pro Sound Effects](https://www.prosoundeffects.com/sound-effects/PSE_BW-BD3/xANLj/Container-Submerge)
- [High-pressure resonant water fill — Pro Sound Effects](https://www.prosoundeffects.com/sound-effects/PSE_OX/tA0up/Water-Fill-Faucet-Flowing-into-Tub-Tank-Basin)

Tube flooding and compartment flooding must be different events. A tube flood
should read as controlled valve flow and pressure equalization. Damage flooding
needs sustained mass, spray, structural leakage, rising water, pumps, and an
evolving compartment response.

### Torpedo launch

Local starting layers:

- `torpedo/g45-13-submarine-torpedo-fire.wav`
- `torpedo/g45-34-reverberant-torpedos.wav`
- `ballast/boats-sub-ballast-blow-explosive.wav`
- `torpedo/boats-torpedo-traveling-popping-prop.wav`

Best low-cost authentic supplement:

- [BBC German U-boat: two torpedoes fired in the torpedo room](https://www.prosoundeffects.com/sound-effects/PSE_BBC-1-60/vM15w/Boats-Boats-ECD22b) — observed at USD 5; 22 s, WAV 16-bit/44.1 kHz stereo.

Build separate perspectives:

1. Interior: command/mechanism, compact compressed-air impulse, tube/body
   resonance, short water load, decay through the hull.
2. Exterior: muzzle disturbance, bubble plume, water displacement, then
   propulsion starting and leaving the listener.
3. Remote sonar: transient and a weak, filtered propulsion track; never a copy
   of the interior event with extra reverb.

### Compressed-air ejection and ballast blow

Local starting layers:

- `ballast/boats-sub-ballast-blow.wav`
- `ballast/boats-sub-ballast-blow-quick.wav`
- `ballast/boats-sub-ballast-blow-explosive.wav`
- `air/r17-01-pressurized-air.wav`
- `air/r17-35-steam-or-compressed-air.wav`
- `air/r28-07-big-blasts-of-air.wav`
- `air/r28-35-big-blasts-of-air.wav`
- `air/r28-37-big-blasts-of-air.wav`
- `air/g45-16-submarine-compressor-motor.wav`

Authentic and designed supplements, each observed at USD 5:

- [BBC German U-boat: blowing ballast tanks](https://www.prosoundeffects.com/sound-effects/PSE_BBC-HIS/6Utp0/Boats-Boats-EC93Ee)
- [BBC German U-boat: short ballast blow](https://www.prosoundeffects.com/sound-effects/PSE_BBC-1-60/ofVzl/Boats-Boats-ECD22g)
- [Ballast blower into hollow metal tube 01](https://www.prosoundeffects.com/sound-effects/PSE_OCX/ADlMK/Ballast-Blower-Air-Blast-into-Metal-Tube-Hollow-01)
- [Ballast blower into hollow metal tube 02](https://www.prosoundeffects.com/sound-effects/PSE_OCX/aPotU/Ballast-Blower-Air-Blast-into-Metal-Tube-Hollow-02)

The compressed-air event should retain a valve attack, a high-pressure body,
pipe/hull transmission, and a changing tail. A flat white-noise whoosh will
sound like a pneumatic tool rather than a submarine system.

### Steel under deep hydrostatic pressure

Local starting layers:

- `hull-stress/metal-steel-girders-wrench-tear.wav`
- low, isolated fragments from
  `hull-stress/metal-car-crusher-leaks-moans.wav`

Premium source:

- [Space Divers](https://www.asoundeffect.com/sound-library/space-divers/) — observed at USD 104 sale / USD 130 list; 367 files, more than 1,000 sounds, 8.56 GB, WAV 96 kHz/24-bit. It includes vehicle vibration, underwater impacts, rumbles, creaks, metal strain, and material screams. It is designed material, not documentary submarine audio.
- [Ship Hull Impacts 01 stereo underwater](https://www.prosoundeffects.com/sound-effects/PSE_ETS/vp0qJ/Ship-Hull-Impacts-01-ST1) — observed at USD 5, 74 s, WAV 24-bit/48 kHz stereo.
- [Ship Hull Impacts 01 mono interior](https://www.prosoundeffects.com/sound-effects/PSE_ETS/C1RNl/ship-hull-impacts-01-m2) — observed at USD 5, 74 s, WAV 24-bit/48 kHz mono.

Playback rule: rare, irregular, predominantly low-frequency, and driven by depth
plus rate of depth change. It must not become a constant haunted-house creak.

### Steel under aggressive maneuver load

Use a different pool from deep-pressure stress:

- short excerpts from `hull-stress/metal-car-crusher-leaks-moans.wav`
- small torsional creaks from `hull-stress/metal-steel-girders-wrench-tear.wav`
- compartment rattles and loose fittings derived from the local interior beds
- Space Divers as the strongest premium source library

Drive this pool from angular acceleration, lateral acceleration, abrupt plane or
rudder load, and speed. Use shorter, sharper events than the depth pool. In a
submarine, “high G” should read as maneuver-induced structural and fixture load,
not as a spacecraft-style acceleration effect.

### Torpedo propeller and run

Local starting layers:

- `torpedo/boats-torpedo-traveling-popping-prop.wav`
- `propulsion/boats-sub-propeller-underwater.wav`
- `propulsion/boats-sub-prop-churning.wav`
- `propulsion/g45-20-submarine-motor-underwater.wav`

Premium exact/game-ready source:

- [Warfare Vehicles of Land & Sea](https://www.asoundeffect.com/sound-library/military-jeeps-trucks-ships-submarines-sound-effects-library-land-and-sea-war-vehicles/) — observed at USD 39.99. Its designed submarine set includes torpedo loading/launch sequences, underwater propulsion loops, pass-bys, and impacts.

Model start-up, acceleration, steady run, aspect, range, and cavitation as
separate parameters. Do not loop a loud “propeller” recording unchanged from
launch to impact.

### Explosions, depth charges, and implosion

Local starting layers:

- `explosions/g45-11-submarine-depth-charge.wav`
- `explosions/g45-14-torpedo-explosion.wav`
- `explosions/g45-35-distant-explosions-underwater.wav`
- `explosions/g45-12-submarine-missile-explosions.wav`
- `explosions/g45-10-submarine-battle.wav`

Useful premium sources:

- [Submerged](https://sonniss.com/sound-effects/submerged/) — observed at USD 79; 230 hydrophone-captured files, 1.3 GB, WAV 96 kHz/24-bit. Strong for underwater blasts, air release, bubbles, water, ice, and impacts.
- [Universal Explosions Vol. 1](https://www.asoundeffect.com/sound-library/universal-explosions-vol-1/) — observed at USD 18; 343 sounds in 83 files, about 2 GB, including a designed underwater implosion and separated pre-hit/tail components.
- [Underwater Sound Effects Library](https://portal.sound-ideas.com/Product/504/Underwater-Sound-Effects-Library) — observed at USD 295; 500 SFX, 2.8 GB, Broadcast WAV 24-bit/48 kHz, with many recordings made using B&K hydrophones.

Maintain at least four perspectives: nearby exterior water shock, distant
hydrophone transient, interior hull-borne impact, and catastrophic internal
collapse. An underwater explosion needs a sharp pressure event and a physically
credible tail, not a low-passed Hollywood fireball.

### Ship sinking

The local library supplies component layers, not one finished sinking ship:

- blast and damage: `explosions/g45-10-submarine-battle.wav`
- flooding: `flooding/water-big-flood.wav`
- steel failure: both `hull-stress/` files
- machinery decay: `interior/g45-24-submarine-interior-engine-room.wav`
- distant underwater collapse: `explosions/g45-35-distant-explosions-underwater.wav`

Best exact candidates:

- [Sound Ideas Underwater track sheet](https://portal.sound-ideas.com/Files/SpecificationFile/Underwater_Sound_Effects_Library.pdf) — `BOATShip_Ship Sink Underwater_UWT03-01-1`, 24 s, underwater ship sinking with ground impact.
- [Crash & Burn](https://sound-ideas.com/products/crash-burn-sound-effects-library) — observed at USD 125 sale / USD 250 list; 437 SFX, 1.99 GB, Broadcast WAV 24-bit/48 kHz. Its submarine-disaster sequence includes `CRB02-90` aftermath, `CRB02-91` hull seal breaks/flooding, `CRB02-92` torpedo aftermath, and `CRB02-93` depth charges.
- [Crash & Burn track sheet](https://portal.sound-ideas.com/Files/SpecificationFile/Crash_%26_Burn_Sound_Effects_Library.pdf)

A convincing sinking should evolve over tens of seconds: initial damage,
progressive flooding, machinery loss, bulkhead/steel failures, bubbles and debris,
air-pocket collapses, then distant seabed impact where appropriate.

### Missile launch and flight

Local starting layers:

- `missile/aircraft-atlas-missile-launch.wav`
- `missile/aircraft-titan-missile-launch-long.wav`
- `missile/aircraft-v2-rocket-fires.wav`
- `explosions/g45-12-submarine-missile-explosions.wav`

These are airborne rocket sources. They do not by themselves represent a
submerged launch. Build three perspectives/stages:

1. Inside the submarine: gas-generator or ejection impulse, tube-water surge,
   hard structural transfer, short compartment tail.
2. Underwater exterior: plume, bubbles, water displacement, rising body.
3. Surface/airborne: breach, ignition where applicable, rocket roar and receding
   flight.

Additional compact source:

- [Rocket launch pass-by — Pro Sound Effects](https://www.prosoundeffects.com/sound-effects/PSE_BW-BD3HL/12Ce4/rocket-launch) — observed at USD 5, WAV 24-bit/96 kHz stereo.

## Purchase shortlist

Prices below were observed on 2026-08-17 and must be rechecked before purchase.
No paid asset has been downloaded or licensed by this research pass.

| Priority | Library                                                                                                         |  Observed price | Why buy it                                                                                                                                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------- | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | [Silverplatter Submarine](https://silverplatteraudio.com/products/submarine)                                    |          USD 29 | Fastest ready-to-edit coverage: 57 stereo WAVs at 96 kHz/24-bit, including four torpedo launches, four underwater explosions, hull stress/creaks, metal bending, steam release, hatches, alarms, and a water leak. It combines authentic recordings with designed Foley. |
| 2        | [Hydrology: Underwater](https://sonniss.com/sound-effects/hydrology-underwater/)                                |          USD 79 | Best broad raw construction kit for this project: 254 unique 96 kHz/24-bit source recordings with hydrophone material, underwater mechanical/propulsion drones, torpedo movement, blasts, bubbles, current, and ambiences.                                               |
| 3        | Targeted [Pro Sound Effects](https://www.prosoundeffects.com/) cart                                             | about USD 30–45 | Buy only the exact BBC torpedo/ballast and high-resolution blower, fill, and hull tracks listed above. Strongest low-budget authenticity upgrade.                                                                                                                        |
| 4        | [Crash & Burn](https://sound-ideas.com/products/crash-burn-sound-effects-library)                               |    USD 125 sale | The best explicit sinking/submarine-disaster narrative coverage.                                                                                                                                                                                                         |
| 5        | [Space Divers](https://www.asoundeffect.com/sound-library/space-divers/)                                        |    USD 104 sale | Deep-pressure, maneuver strain, resonant impacts, vibration, and structural design material.                                                                                                                                                                             |
| 6        | [Underwater Sound Effects Library](https://portal.sound-ideas.com/Product/504/Underwater-Sound-Effects-Library) |         USD 295 | Largest focused hydrophone library here and the clearest exact ship-sink recording. Buy if AKULA needs one definitive underwater source collection.                                                                                                                      |

Strong secondary values:

- [Hydro Contact](https://gainwalkers.com/downloads/hydro-contact/) — observed at EUR 20; 273 WAVs, 8.2 GB, about 100 minutes, 96/48 kHz 24-bit hydrophone and contact-mic source material.
- [Decompression — Air Release](https://www.asoundeffect.com/sound-library/decompression-air-release/) — dedicated flows, leaks, bursts, hisses, whooshes, suction, and some hydrophone recordings; verify current price and file specification.

Recommended acquisition paths:

- Zero budget: audition and restore the 37 local CC0 masters.
- Minimal paid upgrade: Silverplatter plus the two BBC torpedo/ballast tracks.
- Best source-design balance: Hydrology plus a targeted Pro Sound Effects cart.
- Full damage/weapon pass: Hydrology, Crash & Burn, Space Divers, and targeted
  exact mechanics.

## Additional effects worth collecting

High-priority gaps beyond the original request:

- torpedo loading skid, rack/rail movement, tube rammer, breech dogs, safeties;
- muzzle-door hydraulic mechanism and verified tube flood/drain valves;
- torpedo gyro spin-up, battery/motor start, seeker turn, cavitation onset;
- countermeasure/decoy ejection, bubble decoy, noisemaker and remote sonar view;
- emergency blow, normal ballast vent, trim pump, seawater pump and check valves;
- small leak, high-pressure spray, pipe rupture, bulkhead failure, compartment
  flooding, pump struggle and pump failure;
- seabed scrape, ice strike, collision, cable/pipe/fitting rattle and loose tools;
- electrical arcs, breaker trips, battery fire, ventilation loss, smoke and
  extinguisher discharge;
- machinery states: quiet cruise, pump transient, turbine/gear whine, bearing
  fault, shaft rub, propeller blade-rate and cavitation by speed;
- weapons impact on merchant/military hulls, near misses, depth-charge patterns,
  air-pocket collapse, debris rain and seabed impact;
- emergency masks/breathing, distant orders, intercom coloration, authentic
  compartment doors and watertight hatches;
- missile canister/tube sequence, underwater plume, surface breach, ignition,
  airborne motor, distant fly-by and terminal detonation.

## Authenticity references, not clean SFX masters

- [US Navy torpedo tube manual — overview](https://www.maritime.org/doc/fleetsub/tubes/chap1.php)
- [US Navy torpedo tube manual — operation](https://www.maritime.org/doc/fleetsub/tubes/chap9.php)
- [DVIDS torpedo launch and recovery exercise](https://www.dvidshub.net/video/135073/all-hands-update-torpedo-launch-and-recovery-exercise)
- [DVIDS SINKEX 2026](https://www.dvidshub.net/video/1013423/us-joint-forces-and-allies-conduct-sinkex-support-valiant-shield-2026)
- [DVIDS NATO torpedo-fire exercise](https://www.dvidshub.net/video/1012722/nato-allies-train-secure-baltic-sea)

These references can guide timing, staging, and perspective, but camera mics,
speech, music, edits, and uncertain capture conditions make them unsuitable as
drop-in gameplay SFX.

## Production boundary

1. Keep downloaded masters outside `public/` until a sound has been selected,
   restored, edited, and its provenance recorded in the shipping credits.
2. Preserve raw masters. Export game-ready derivatives to a separate directory.
3. Do not redistribute paid-library source files; ship only permitted derivatives
   under the applicable license.
4. Audition source recordings before design. File format and checksum verification
   prove integrity, not perceptual quality or suitability.
5. Any integration affecting the accepted contact-acoustic A/B/C identity requires
   a new listening test and explicit approval.
