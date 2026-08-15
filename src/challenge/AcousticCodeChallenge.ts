import {
  areAcousticCodesEquivalent,
  normalizeAcousticCode,
} from "../audio/signatureMath";
import type { AcousticCode } from "../audio/types";

export const SIGNATURE_CATALOG: readonly AcousticCode[] = Object.freeze([
  normalizeAcousticCode([1, 2, 3]),
  normalizeAcousticCode([1, 2, 4]),
  normalizeAcousticCode([1, 3, 4]),
  normalizeAcousticCode([1, 3, 5]),
  normalizeAcousticCode([2, 3, 5]),
  normalizeAcousticCode([2, 4, 5]),
  normalizeAcousticCode([2, 5, 6]),
  normalizeAcousticCode([3, 4, 5]),
]);

export type AcousticChallengeResult = "correct" | "error";

export interface AcousticChallengeRound {
  readonly id: number;
  readonly code: AcousticCode;
  readonly cycleDuration: number;
}

export interface AcousticCodeChallengeOptions {
  readonly catalog?: readonly AcousticCode[];
  readonly forcedCode?: AcousticCode;
  readonly cycleDurationRange?: readonly [number, number];
  readonly random?: () => number;
}

const DEFAULT_CYCLE_DURATION_RANGE: readonly [number, number] = [4.2, 4.8];

export class AcousticCodeChallenge {
  private readonly catalog: readonly AcousticCode[];
  private readonly forcedCode: AcousticCode | undefined;
  private readonly cycleDurationRange: readonly [number, number];
  private readonly random: () => number;
  private round: AcousticChallengeRound;
  private nextRoundId = 1;
  private solved = false;

  public constructor(options: AcousticCodeChallengeOptions = {}) {
    const catalog = options.catalog ?? SIGNATURE_CATALOG;
    if (catalog.length === 0) {
      throw new RangeError("The acoustic signature catalog cannot be empty.");
    }

    this.catalog = Object.freeze(
      catalog.map((code) => normalizeAcousticCode(code)),
    );
    this.forcedCode =
      options.forcedCode === undefined
        ? undefined
        : normalizeAcousticCode(options.forcedCode);
    this.cycleDurationRange = validateDurationRange(
      options.cycleDurationRange ?? DEFAULT_CYCLE_DURATION_RANGE,
    );
    this.random = options.random ?? Math.random;
    this.round = this.createRound();
  }

  public get currentRound(): AcousticChallengeRound {
    return this.round;
  }

  public get isSolved(): boolean {
    return this.solved;
  }

  public submit(answer: AcousticCode): AcousticChallengeResult {
    if (this.solved) {
      return "correct";
    }

    const isCorrect = areAcousticCodesEquivalent(answer, this.round.code);
    if (isCorrect) {
      this.solved = true;
    }

    return isCorrect ? "correct" : "error";
  }

  /**
   * Returns the current round, advancing only when the previous one is solved.
   * The UI calls this in response to PLAY.
   */
  public prepareForPlayback(): AcousticChallengeRound {
    if (this.solved) {
      this.round = this.createRound(this.round.code);
      this.solved = false;
    }

    return this.round;
  }

  /** Immediately replaces the current round, even when it is not solved. */
  public resetRound(): AcousticChallengeRound {
    this.round = this.createRound(this.round.code);
    this.solved = false;
    return this.round;
  }

  private createRound(codeToAvoid?: AcousticCode): AcousticChallengeRound {
    const code = this.forcedCode ?? this.pickCatalogCode(codeToAvoid);
    const [minimumDuration, maximumDuration] = this.cycleDurationRange;
    const cycleDuration =
      minimumDuration +
      this.nextRandomValue() * (maximumDuration - minimumDuration);
    const round = Object.freeze({
      id: this.nextRoundId,
      code,
      cycleDuration,
    });

    this.nextRoundId += 1;
    return round;
  }

  private pickCatalogCode(codeToAvoid?: AcousticCode): AcousticCode {
    const alternatives =
      codeToAvoid === undefined
        ? this.catalog
        : this.catalog.filter(
            (code) => !areAcousticCodesEquivalent(code, codeToAvoid),
          );
    const candidates = alternatives.length === 0 ? this.catalog : alternatives;
    const index = Math.floor(this.nextRandomValue() * candidates.length);
    const code = candidates[index];
    if (code === undefined) {
      throw new Error("Unable to select an acoustic signature.");
    }
    return code;
  }

  private nextRandomValue(): number {
    const value = this.random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError("The random source must return a value in [0, 1).");
    }
    return value;
  }
}

export function parseForcedAcousticCode(
  value: string | null,
): AcousticCode | undefined {
  if (value === null || !/^[1-9]{3}$/.test(value)) {
    return undefined;
  }

  const digits = Array.from(value, Number);
  const code: AcousticCode = [digits[0] ?? 1, digits[1] ?? 1, digits[2] ?? 1];
  return normalizeAcousticCode(code);
}

function validateDurationRange(
  range: readonly [number, number],
): readonly [number, number] {
  const [minimum, maximum] = range;
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    minimum <= 0 ||
    maximum < minimum
  ) {
    throw new RangeError("The cycle duration range is invalid.");
  }

  return Object.freeze([minimum, maximum]);
}
