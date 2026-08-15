export type PropellerNoiseColor = "brown" | "pink" | "white";

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
  readonly water: {
    readonly gain: number;
    readonly highpassHz: number;
    readonly lowpassHz: number;
    readonly lowpassQ: number;
  };
  readonly cavitation: {
    readonly gain: number;
    readonly bandpassHz: number;
    readonly bandpassQ: number;
    readonly lowpassHz: number;
  };
  readonly resonance: {
    readonly firstHz: number;
    readonly firstQ: number;
    readonly firstGain: number;
    readonly secondHz: number;
    readonly secondQ: number;
    readonly secondGain: number;
  };
  readonly modulation: {
    readonly componentA: {
      readonly gainDepth: number;
      readonly filterDepthHz: number;
      readonly bedFloorScale: number;
      readonly bedLowpassFloorHz: number;
    };
    readonly componentB: {
      readonly gainDepth: number;
      readonly filterDepthHz: number;
    };
    readonly componentC: {
      readonly gainDepth: number;
      readonly filterDepthHz: number;
    };
    readonly pulseShapePower: number;
    readonly cycleGainDepth: number;
    readonly organicRateHz: number;
    readonly organicBedFilterDepthHz: number;
    readonly organicWaterGainDepth: number;
  };
}

/**
 * The original AKULA hydrophone preset. Its sound sources and filter values are
 * intentionally kept at the first proposed version; only the pulse envelope is
 * sampled explicitly so A, B and C can be independently enabled or disabled.
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
    gain: 0.48,
    compressorThreshold: -16,
    compressorKnee: 18,
    compressorRatio: 4,
    compressorAttack: 0.008,
    compressorRelease: 0.24,
  },
  bed: {
    gain: 0.42,
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
    flowGain: 0.52,
    flowFloorScale: 0.025,
    flowHighpassHz: 58,
    flowLowpassFloorHz: 140,
    flowLowpassHz: 460,
    flowLowpassQ: 0.82,
  },
  water: {
    gain: 0.34,
    highpassHz: 24,
    lowpassHz: 760,
    lowpassQ: 0.82,
  },
  cavitation: {
    gain: 0.12,
    bandpassHz: 1_260,
    bandpassQ: 0.78,
    lowpassHz: 2_650,
  },
  resonance: {
    firstHz: 92,
    firstQ: 7.5,
    firstGain: 0.046,
    secondHz: 158,
    secondQ: 6.2,
    secondGain: 0.032,
  },
  modulation: {
    componentA: {
      gainDepth: 0.075,
      filterDepthHz: 28,
      bedFloorScale: 0.12,
      bedLowpassFloorHz: 95,
    },
    componentB: {
      gainDepth: 0.14,
      filterDepthHz: 190,
    },
    componentC: {
      gainDepth: 0.074,
      filterDepthHz: 520,
    },
    pulseShapePower: 1.85,
    cycleGainDepth: 0.032,
    organicRateHz: 0.073,
    organicBedFilterDepthHz: 19,
    organicWaterGainDepth: 0.012,
  },
};
