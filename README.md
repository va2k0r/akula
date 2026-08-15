# AKULA Acoustic Code prototype

The accepted game-level invariants are recorded in
[`ACOUSTIC_CODE_CANON.md`](./ACOUSTIC_CODE_CANON.md).

## Run the prototype

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

## Test and build

```sh
npm test
npm run build
```

`npm run check` runs tests, TypeScript, lint, formatting validation, and the production build together.

## Import the audio engine

The reusable module is `src/audio/`. It does not import the prototype UI or challenge code.

```ts
import { AcousticSignatureEngine } from "./audio";

const engine = new AcousticSignatureEngine();

engine.setSignature([1, 2, 4]);
engine.setCycleDuration(4.5);

await engine.play();

// Later:
engine.pause();
engine.dispose();
```

The three ordered values are literal, independent repetition counts inside one
shared cycle. With `[1, 2, 4]`, component A repeats once while B repeats twice
and C repeats four times. Coincident crests are mixed together; none of the
components masks another.

A value of `0` disables only that component:

```ts
engine.setSignature([1, 0, 4]); // A + C
engine.setSignature([0, 0, 4]); // C only
engine.setSignature([0, 0, 0]); // silence
```

`setCycleDuration()` changes the common span over which those literal counts
are played, without changing the selected values.

All sound-design values are centralized in `src/audio/propellerPreset.ts`. Change that preset to retune levels, filters, resonances, modulation depth, fades, or dynamics.

Call `dispose()` when the engine is no longer needed. It fades and disconnects its graph, closes a context it created itself, and leaves a shared game-owned `AudioContext` running.
