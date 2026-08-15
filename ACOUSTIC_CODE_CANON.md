# AKULA acoustic code canon

Status: accepted foundation. Preserve this behavior unless the user explicitly
changes it after a listening test.

## Contact identity

- Every in-game sonar contact has exactly three positive integer components.
- The three values are distinct within one signature.
- Order is irrelevant: `214`, `421`, and `142` identify the same contact.
- The values express a ratio between the three repetition frequencies. Common
  multiples therefore preserve identity.
- Prefer small primitive integer ratios because they are easier to count.
- The signature identifies a vessel class, not an individual hull. Every ship
  or submarine of the same class shares the same unordered three-number ratio.
- Individual vessels may differ in timbre, machinery noise, condition, and
  absolute playback speed, but those variations must not alter the class ratio.

## Motion

Contact speed may multiply all three absolute repetition frequencies by the
same factor. The unordered ratio between them never changes, so the acoustic
identity remains recognizable at different speeds.

## Sound language

Each component must remain short and countable. Every timbre must plausibly
belong to a submarine or large vessel: engine room, propeller or blade,
rotating machinery, or a nuclear-submarine pump. Avoid decorative water,
musical, synthetic-whistle, and unrelated impact sounds.

All three components in the current prototype are the accepted reference
checkpoint. Do not retune A, B, or C without a new listening test and explicit
user approval.

## Prototype-only isolation

The test bench may use `0` to disable a component for isolated listening. Zero
is not part of an in-game contact signature.
