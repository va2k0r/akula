export type AcousticCode = readonly [number, number, number];

export interface AcousticSignatureEngineOptions {
  /** A game-owned context. AKULA never suspends or closes a shared context. */
  readonly audioContext?: AudioContext;
  /** An optional game-owned destination node belonging to audioContext. */
  readonly output?: AudioNode;
  readonly signature?: AcousticCode;
  readonly cycleDuration?: number;
}
