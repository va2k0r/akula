# AKULA countable contact sound repository

Status: authentic-recording listening candidate. At the user’s explicit
request, every synthetic A, B and C asset has been replaced. The 15 runtime WAVs
now come only from documented recordings of freight-ship cavitation, a ship
engine room, a pump engine, a boat engine and rotating valve machinery. This
bank remains a candidate until its countability is approved in a real mix.

## Listen

Run AKULA on its canonical local origin and open:

```text
http://127.0.0.1:4173/?sound-library=1
```

The page groups the current naval catalog into neutral and hostile sources.
Every class has `PLAY ALL`, `A ONLY`, `B ONLY`, and `C ONLY`. `PLAY ALL` starts
A/B/C on the same cycle boundary and keeps a low propeller bed running between
their countable events. `STOP ALL` returns the output to digital silence. The
same `AudioSessionCoordinator` used by the game ensures that only the focused
AKULA tab can produce sound.

Every class has two synchronized analysis surfaces. `BEAT VOLUME` is the primary
view. It is not an amplitude-distribution chart: its 96 bars are consecutive RMS
time bins calculated from the decoded recording excerpts, their scheduled
onsets, mix gains and the recorded-A rotor bed. A coincident A/B/C beat therefore
appears honestly as one taller volume peak. Isolating A, B or C reveals the
individual peak train. The smaller `MODULATION` reference overlays the three
phase-locked repetition envelopes in one common cycle; both playheads follow the
same Web Audio clock as the sound.

## Acoustic construction

- Each WAV is an excerpt around a natural recorded mechanical onset: real
  cavitation on A; real pump, engine-room or boat-engine motion on B; real
  cavitation or valve machinery on C.
- No oscillator, synthesized transient, generated noise or modeled machinery
  is added. Editing is limited to excerpting, channel selection, light EQ,
  playback-rate adjustment, anti-click/tail fades and normalization.
- The samples contain no baked repetition. The engine places exactly the three
  integer counts from the class signature into one shared cycle.
- Isolated A, B and C retain true gaps and literal repetition counts.
- In `PLAY ALL`, A/B/C share phase zero and therefore begin together. A circular
  overlap-add bed derived only from the recorded A waveform supplies continuous
  rotation beneath them; it adds no fourth attack or new class rate.
- The longest one-shot is 480 ms. Every tail reaches real silence before the
  next isolated event. Only the combined presentation fills those gaps.
- The five untouched source Ogg files, their authors, licenses and SHA-256
  values are retained under `assets/source/contact-recordings/`. Every runtime
  derivative records its exact source time range in `MANIFEST.json`.

## Layout

```text
public/assets/audio/contacts/countable/v1/
  MANIFEST.json
  frostbite-victor-iii/
  sierra-i-machinery/
  sturgeon-machinery/
  los-angeles-machinery/
  merchant-slow-diesel/
```

Each class directory contains `a-*.wav`, `b-*.wav`, and `c-*.wav`.
`MANIFEST.json` records encoding, duration, level, source ID, source range,
editing operations, provenance and SHA-256 for all 15 files. Runtime mapping lives in
`src/audio/contactSoundBank.ts`; the vessel catalog remains the source of truth
for class signatures.

## Regenerate

```sh
npm run audio:contact-bank
```

The deterministic generator is `scripts/generate-contact-sound-bank.mjs`. It
uses the in-repository Ogg/Vorbis decoder, verifies the five original source
hashes and must reproduce the derivative manifest hashes exactly. Do not
hand-normalize or trim individual WAVs: doing so would break both provenance and
countability. Full attribution is in
`assets/source/contact-recordings/SOURCE.md`.
