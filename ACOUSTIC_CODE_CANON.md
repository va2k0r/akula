# Akula 971 acoustic code canon

Status: accepted foundation. Preserve this behavior unless the user explicitly
changes it after a listening test.

## Contact identity

- Every in-game sonar contact has exactly three positive integer components.
- The three values are distinct within one signature.
- Order is irrelevant: `214`, `421`, and `142` identify the same contact.
- The values express a ratio between the three repetition frequencies. Common
  multiples therefore preserve identity.
- Prefer small primitive integer ratios because they are easier to count.
- The current Frostbite Canyon contact deliberately uses the easy `1:2:4`
  ratio. Its order remains irrelevant.
- The signature identifies a vessel class, not an individual hull. Every ship
  or submarine of the same class shares the same unordered three-number ratio.
- Individual vessels may differ in timbre, machinery noise, condition, and
  absolute playback speed, but those variations must not alter the class ratio.

## Motion

Contact speed may multiply all three absolute repetition frequencies by the
same factor. The unordered ratio between them never changes, so the acoustic
identity remains recognizable at different speeds.

## Directional contact cue and crew marking

Contact identity remains unordered, but each source keeps a stable machinery
channel A for sensory presentation. At equal radiated source noise, closing
range must reveal the contact in this strict order: faint directional sound,
then sound plus controller vibration, then those two channels plus a readable
passive-ring deformation:

- channel A sets the phase origin; pulse force is fixed throughout the search,
  so proximity never leaks through intensity;
- camera alignment gates the sound inside the 30-degree chase-camera cone.
  Range, source noise and own-ship masking act through physical signal quality;
- at quality `0.26`, the machinery sound is the first contact cue. It begins
  faint, micro-ducks the soundtrack while leaving own-ship masking intact, is
  silent outside the camera cone, and does not trigger a controller pulse or a
  crew mark;
- only at quality `0.50` does the haptic channel join the already audible sound.
  Crossing that threshold while aligned emits a rapid three-tick scan burst:
  even when the camera lands directly on an already strong source, the first
  tick waits 180 ms so the ear receives the score duck and propeller first.
  Each tick lasts 70 ms and their onsets are 85 ms apart. The burst starts the
  tactile lock sequence; leaving the cone or falling below the haptic threshold
  discards lock progress;
- quality changes omission and cadence only, never pulse intensity. A distant
  return skips an irregular three-to-seven channel-A cycles, so the cue can be
  missed like a broken message;
- after the first felt fragment, remaining inside the sector runs an irregular,
  globally accelerating sequence on channel-A-derived subdivisions. Leaving
  the sector discards the tactile sequence instead of banking progress. The
  complete pattern resolves in about three seconds and gates the crew mark;
- the final fragments form a close pair, then the vibration is cut abruptly.
  There is no stronger confirmation hit and no continuous metronomic hold;
- the tactile channel begins while the passive ring is still geometrically
  flat. Only at quality `0.78` may a contact deform the ring, and only while its
  relative bearing lies inside the three contiguous 30-degree sectors centred
  on the bow. Lateral and aft contacts never increspate the ring;
- only when the terminal tactile lock completes does the crew assign `ЦЕЛЬ N`
  and show a billboard solid with the measured source bearing. Its arbitrary
  projection distance never exposes true target range;
- at that completed lock, the crew automatically recognizes the source's
  three-rate acoustic class and opens its bearing-only TMA. A first bearing
  produces a broad uncertainty field, not a true-range fix;
- reacquisition must complete the tactile lock again; it then keeps the
  permanent `ЦЕЛЬ N`, reapplies the correctly recognized class, and returns the
  contact to the TMA while preserving prior bearing history and projected
  uncertainty;
- at that cut, the sonarist announces the contact without changing camera mode
  or zoom;
- sonar analysis, tactical view, and stronger navigation haptics take priority.

Current requested calibration: once both the camera cone and haptic-quality
threshold are satisfied, the three-tick scan burst begins after the 180 ms
audio lead and finishes 420 ms after cone entry; the first timed lock fragment
follows after `0.75` continuous seconds in that state. Every scan and lock
fragment uses a fixed `0.36` strong-motor and `0.84` weak-motor command, exactly
double the preceding `0.18` / `0.42` envelope. Scan ticks last 70 ms; lock
fragments remain 90 ms. Signal quality never raises that force; it only closes
the irregular gaps. The debug-only `VIBRAZIONE ×100` switch is off by default
and saturates supported pad motors at their API maximum without changing this
normal calibration. Tactile lock completion gates crew marking, automatic
classification, and TMA entry.

## Sound language

Each isolated component must remain short and countable. In complete playback,
A/B/C begin on the same cycle boundary and ride inside one continuous rotating-
propeller bed; the bed must never add a fourth countable rate. Every timbre must
plausibly belong to a submarine or large vessel: engine room, propeller or
blade, rotating machinery, or a nuclear-submarine pump. Avoid decorative water,
musical, synthetic-whistle, and unrelated impact sounds.

The explicit 2026-08-17 request for authentic recordings supersedes the former
byte-identical channel-A checkpoint. All A/B/C assets are now a new listening
candidate derived only from documented recordings: freight-ship cavitation,
ship-engine-room machinery, pump and boat engines, and rotating valve machinery.
Every isolated WAV must contain a natural recorded onset, a readable mechanical
body, a finite tail, and real silence; a featureless drone is not a valid source
event. Do not add an oscillator, a synthesized transient, generated noise, or a
modeled machinery layer to make an event artificially countable.

The complete mix deliberately fills the isolated gaps with a circular overlap-
add bed derived from recorded A, so it reads as one propeller turning rather than
three disconnected samples. That presentation layer cannot introduce a fourth
rate or replace the finite A/B/C source events. In the first audio-only stage the
contact begins at low gain and micro-ducks the soundtrack from `0.13` to `0.116`
without clearing own-ship masking. Ducking then increases with received quality,
reaching soundtrack `0.006` and own-ship bus `0.04` only at the ring threshold.
The contact bus is capped at `0.58`; with the existing contact-output and master
gains this retains about 12.6 dB of nominal digital headroom before the two
compressors, but it cannot guarantee a physical SPL on unknown headphones or
speakers. Do not promote the authentic-recording bank without a new listening
test and explicit user approval.

## Prototype-only isolation

The test bench may use `0` to disable a component for isolated listening. Zero
is not part of an in-game contact signature.
