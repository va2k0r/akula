export type AcousticCode = readonly [number, number, number];

export interface AcousticSignatureEngineOptions {
  /** A game-owned context. AKULA never suspends or closes a shared context. */
  readonly audioContext?: AudioContext;
  /** An optional game-owned destination node belonging to audioContext. */
  readonly output?: AudioNode;
  readonly signature?: AcousticCode;
  readonly cycleDuration?: number;
  /** Optional recording-derived one-shot profile for contact playback. */
  readonly soundProfileId?: string;
  /**
   * Adds a seamless rotor bed and aligns A/B/C at the cycle boundary. Isolated
   * components remain finite and countable; the complete signature reads as
   * one continuously rotating machine.
   */
  readonly continuousProfileMix?: boolean;
}
