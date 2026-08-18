export type PropellerNoiseColor = "brown" | "pink" | "white";

export interface MechanicalPulsePreset {
  readonly gain: number;
  readonly floorScale: number;
  readonly highpassHz: number;
  readonly lowpassFloorHz: number;
  readonly lowpassHz: number;
  readonly lowpassQ: number;
  readonly fundamentalHz: number;
  readonly fundamentalGain: number;
  readonly overtoneHz: number;
  readonly overtoneGain: number;
}

export interface PropellerSoundPreset {
  readonly noise: {
    readonly loopSeconds: number;
    readonly peak: number;
  };
  readonly timing: {
    readonly lookAheadSeconds: number;
    readonly fadeInSeconds: number;
    readonly fadeOutSeconds: number;
    readonly transitionSeconds: number;
    readonly cleanupMarginSeconds: number;
  };
  readonly output: {
    readonly gain: number;
    readonly compressorThreshold: number;
    readonly compressorKnee: number;
    readonly compressorRatio: number;
    readonly compressorAttack: number;
    readonly compressorRelease: number;
  };
  readonly bed: {
    readonly gain: number;
    readonly highpassHz: number;
    readonly lowpassHz: number;
    readonly lowpassQ: number;
  };
  readonly hull: {
    readonly gain: number;
    readonly fundamentalHz: number;
    readonly overtoneHz: number;
    readonly overtoneGain: number;
    readonly lowpassHz: number;
    readonly flowGain: number;
    readonly flowFloorScale: number;
    readonly flowHighpassHz: number;
    readonly flowLowpassFloorHz: number;
    readonly flowLowpassHz: number;
    readonly flowLowpassQ: number;
  };
  readonly pump: MechanicalPulsePreset;
  readonly blade: MechanicalPulsePreset;
  readonly modulation: {
    readonly componentA: {
      readonly gainDepth: number;
      readonly filterDepthHz: number;
      readonly bedFloorScale: number;
      readonly bedLowpassFloorHz: number;
      readonly pulseShapePower: number;
    };
    readonly componentB: {
      readonly pulseShapePower: number;
    };
    readonly componentC: {
      readonly pulseShapePower: number;
    };
    readonly organicRateHz: number;
    readonly organicBedFilterDepthHz: number;
  };
}

/**
 * Procedural fallback used only when no recording profile is supplied. The
 * shipped contact catalog uses the licensed recording-derived bank instead.
 * Keep this fallback within the same restrained mechanical vocabulary.
 */
export const PROPELLER_PRESET: Readonly<PropellerSoundPreset> = {
  noise: {
    loopSeconds: 6,
    peak: 0.72,
  },
  timing: {
    lookAheadSeconds: 0.025,
    fadeInSeconds: 0.18,
    fadeOutSeconds: 0.16,
    transitionSeconds: 0.22,
    cleanupMarginSeconds: 0.05,
  },
  output: {
    gain: 0.56,
    compressorThreshold: -16,
    compressorKnee: 18,
    compressorRatio: 3,
    compressorAttack: 0.014,
    compressorRelease: 0.16,
  },
  bed: {
    gain: 0.26,
    highpassHz: 16,
    lowpassHz: 470,
    lowpassQ: 0.72,
  },
  hull: {
    gain: 0.17,
    fundamentalHz: 31,
    overtoneHz: 49,
    overtoneGain: 0.3,
    lowpassHz: 175,
    flowGain: 0.32,
    flowFloorScale: 0.012,
    flowHighpassHz: 58,
    flowLowpassFloorHz: 140,
    flowLowpassHz: 460,
    flowLowpassQ: 0.82,
  },
  pump: {
    gain: 0.5,
    floorScale: 0.01,
    highpassHz: 82,
    lowpassFloorHz: 220,
    lowpassHz: 560,
    lowpassQ: 0.92,
    fundamentalHz: 92,
    fundamentalGain: 0.32,
    overtoneHz: 138,
    overtoneGain: 0.07,
  },
  blade: {
    gain: 0.46,
    floorScale: 0,
    highpassHz: 145,
    lowpassFloorHz: 290,
    lowpassHz: 680,
    lowpassQ: 1.05,
    fundamentalHz: 165,
    fundamentalGain: 0.28,
    overtoneHz: 248,
    overtoneGain: 0.05,
  },
  modulation: {
    componentA: {
      gainDepth: 0.075,
      filterDepthHz: 28,
      bedFloorScale: 0.06,
      bedLowpassFloorHz: 95,
      pulseShapePower: 3,
    },
    componentB: {
      pulseShapePower: 6,
    },
    componentC: {
      pulseShapePower: 10,
    },
    organicRateHz: 0.073,
    organicBedFilterDepthHz: 19,
  },
};
