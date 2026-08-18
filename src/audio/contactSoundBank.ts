const CONTACT_SOUND_BANK_ROOT = "assets/audio/contacts/countable/v1";

export type ContactSoundComponentKind =
  "propeller" | "pump" | "machinery" | "blade" | "diesel";

export interface ContactSoundComponentDefinition {
  readonly channel: "A" | "B" | "C";
  readonly label: string;
  readonly kind: ContactSoundComponentKind;
  readonly assetFileName: string;
  readonly mixGain: number;
  /** Offset inside this component's own repetition interval. */
  readonly phaseOffset: number;
}

export interface ContactSoundProfile {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly components: readonly [
    ContactSoundComponentDefinition,
    ContactSoundComponentDefinition,
    ContactSoundComponentDefinition,
  ];
}

export type ContactSoundBuffers = readonly [
  AudioBuffer,
  AudioBuffer,
  AudioBuffer,
];

const COMPONENT_GAINS = [0.9, 0.76, 0.68] as const;

/**
 * Licensed recording-derived one-shot repository for every class currently in
 * the naval catalog. Each file contains one finite mechanical event and true
 * silence at its tail; repetition belongs to the acoustic code, never to the
 * asset.
 */
export const CONTACT_SOUND_PROFILES: readonly ContactSoundProfile[] =
  Object.freeze([
    profile(
      "frostbite-victor-iii",
      "Victor III pressure train",
      "Low skewed-propeller pressure, coolant-pump load and broad blade wash.",
      [
        component(
          "A",
          "PROPELLER PRESSURE",
          "propeller",
          "a-propeller-pressure.wav",
          0,
          0,
        ),
        component(
          "B",
          "COOLANT PUMP LOAD",
          "pump",
          "b-coolant-pump.wav",
          1,
          0.5,
        ),
        component("C", "BLADE WASH", "blade", "c-blade-pass.wav", 2, 0.5),
      ],
    ),
    profile(
      "sierra-i-machinery",
      "Sierra I machinery train",
      "Heavy skewed propeller, reduction-gear mesh and blade-tip wash.",
      [
        component(
          "A",
          "SKEWED PROPELLER",
          "propeller",
          "a-skewed-propeller.wav",
          0,
          0,
        ),
        component(
          "B",
          "REDUCTION GEAR MESH",
          "machinery",
          "b-reduction-gear.wav",
          1,
          0.16,
        ),
        component(
          "C",
          "BLADE-TIP WASH",
          "blade",
          "c-blade-tip-pass.wav",
          2,
          0.825,
        ),
      ],
    ),
    profile(
      "sturgeon-machinery",
      "Sturgeon machinery train",
      "Seven-blade pressure pulse, circulation-pump load and shaft-bearing pass.",
      [
        component(
          "A",
          "SEVEN-BLADE PRESSURE",
          "propeller",
          "a-seven-blade-pressure.wav",
          0,
          0,
        ),
        component(
          "B",
          "CIRCULATION PUMP LOAD",
          "pump",
          "b-circulation-pump.wav",
          1,
          0.195,
        ),
        component(
          "C",
          "SHAFT-BEARING PASS",
          "blade",
          "c-shaft-blade-tick.wav",
          2,
          0.825,
        ),
      ],
    ),
    profile(
      "los-angeles-machinery",
      "Los Angeles machinery train",
      "Faster propeller pressure, turbine reduction train and fast blade wash.",
      [
        component(
          "A",
          "HIGH-SPEED PROPELLER",
          "propeller",
          "a-high-speed-propeller.wav",
          0,
          0,
        ),
        component(
          "B",
          "TURBINE REDUCTION TRAIN",
          "machinery",
          "b-turbine-coupling.wav",
          1,
          0.1,
        ),
        component(
          "C",
          "FAST BLADE WASH",
          "blade",
          "c-fast-blade-pass.wav",
          2,
          0.84,
        ),
      ],
    ),
    profile(
      "merchant-slow-diesel",
      "Slow merchant engine room",
      "Heavy screw pressure, diesel-room churn and lubricated valve-train roll.",
      [
        component(
          "A",
          "HEAVY PROPELLER",
          "propeller",
          "a-heavy-propeller.wav",
          0,
          0,
        ),
        component(
          "B",
          "DIESEL ENGINE ROOM",
          "diesel",
          "b-diesel-crankcase.wav",
          1,
          0.16,
        ),
        component(
          "C",
          "LUBRICATED VALVE TRAIN",
          "machinery",
          "c-valve-train.wav",
          2,
          0.655,
        ),
      ],
    ),
  ]);

const bufferCache = new WeakMap<
  BaseAudioContext,
  Map<string, Promise<ContactSoundBuffers>>
>();

export function contactSoundProfileById(
  profileId: string,
): ContactSoundProfile {
  const soundProfile = CONTACT_SOUND_PROFILES.find(
    (candidate) => candidate.id === profileId,
  );
  if (soundProfile === undefined) {
    throw new Error(`Unknown contact sound profile: ${profileId}`);
  }
  return soundProfile;
}

export function contactSoundAssetPath(
  soundProfile: ContactSoundProfile,
  componentIndex: 0 | 1 | 2,
): string {
  const definition = soundProfile.components[componentIndex];
  return `${CONTACT_SOUND_BANK_ROOT}/${soundProfile.id}/${definition.assetFileName}`;
}

export function contactPulseOnsets(
  repetitions: number,
  cycleDurationSeconds: number,
  phaseOffset: number,
): readonly number[] {
  if (!Number.isSafeInteger(repetitions) || repetitions < 0) {
    throw new RangeError("Contact repetition count must be non-negative.");
  }
  if (!Number.isFinite(cycleDurationSeconds) || cycleDurationSeconds <= 0) {
    throw new RangeError("Contact cycle duration must be positive.");
  }
  if (!Number.isFinite(phaseOffset) || phaseOffset < 0 || phaseOffset >= 1) {
    throw new RangeError("Contact phase offset must be in [0, 1). ");
  }
  if (repetitions === 0) {
    return [];
  }

  const intervalSeconds = cycleDurationSeconds / repetitions;
  return Array.from(
    { length: repetitions },
    (_, index) => (index + phaseOffset) * intervalSeconds,
  );
}

export function loadContactSoundBuffers(
  context: BaseAudioContext,
  soundProfile: ContactSoundProfile,
): Promise<ContactSoundBuffers> {
  let contextCache = bufferCache.get(context);
  if (contextCache === undefined) {
    contextCache = new Map();
    bufferCache.set(context, contextCache);
  }
  const cached = contextCache.get(soundProfile.id);
  if (cached !== undefined) {
    return cached;
  }

  const loadComponent = async (
    componentIndex: 0 | 1 | 2,
  ): Promise<AudioBuffer> => {
    const relativePath = contactSoundAssetPath(soundProfile, componentIndex);
    const assetPath = `${import.meta.env.BASE_URL}${relativePath}`;
    const response = await fetch(assetPath);
    if (!response.ok) {
      throw new Error(
        `Unable to load contact sound ${relativePath}: HTTP ${String(response.status)}`,
      );
    }
    return context.decodeAudioData(await response.arrayBuffer());
  };
  const loading: Promise<ContactSoundBuffers> = Promise.all([
    loadComponent(0),
    loadComponent(1),
    loadComponent(2),
  ]);
  contextCache.set(soundProfile.id, loading);
  void loading.catch(() => contextCache?.delete(soundProfile.id));
  return loading;
}

function profile(
  id: string,
  displayName: string,
  description: string,
  components: ContactSoundProfile["components"],
): ContactSoundProfile {
  return Object.freeze({
    id,
    displayName,
    description,
    components: Object.freeze(components),
  });
}

function component(
  channel: ContactSoundComponentDefinition["channel"],
  label: string,
  kind: ContactSoundComponentKind,
  assetFileName: string,
  index: 0 | 1 | 2,
  phaseOffset: number,
): ContactSoundComponentDefinition {
  return Object.freeze({
    channel,
    label,
    kind,
    assetFileName,
    mixGain: COMPONENT_GAINS[index],
    phaseOffset,
  });
}
