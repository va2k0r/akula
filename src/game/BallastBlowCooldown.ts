export const BALLAST_BLOW_COOLDOWN_SECONDS = 9;

export interface BallastBlowCooldownSnapshot {
  readonly triggered: boolean;
  readonly accepted: boolean;
  readonly remainingSeconds: number;
}

/**
 * Edge-triggered lockout for the main-ballast blow. Holding the control never
 * retriggers it, and a press made during the lockout must be released before
 * a later press can fire once the nine seconds have elapsed.
 */
export class BallastBlowCooldown {
  private remainingSecondsValue = 0;
  private wasRequested = false;
  private currentRequestAccepted = false;

  public update(
    requested: boolean,
    elapsedSeconds: number,
  ): BallastBlowCooldownSnapshot {
    const elapsed = Number.isFinite(elapsedSeconds)
      ? Math.max(0, elapsedSeconds)
      : 0;
    this.remainingSecondsValue = Math.max(
      0,
      this.remainingSecondsValue - elapsed,
    );

    const triggered =
      requested && !this.wasRequested && this.remainingSecondsValue === 0;
    if (!requested) {
      this.currentRequestAccepted = false;
    }
    if (triggered) {
      this.currentRequestAccepted = true;
    }
    this.wasRequested = requested;
    if (triggered) {
      this.remainingSecondsValue = BALLAST_BLOW_COOLDOWN_SECONDS;
    }

    return {
      triggered,
      accepted: requested && this.currentRequestAccepted,
      remainingSeconds: this.remainingSecondsValue,
    };
  }

  public reset(): void {
    this.remainingSecondsValue = 0;
    this.wasRequested = false;
    this.currentRequestAccepted = false;
  }

  public get remainingSeconds(): number {
    return this.remainingSecondsValue;
  }
}
