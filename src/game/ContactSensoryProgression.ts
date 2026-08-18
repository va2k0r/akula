/**
 * One received-signal ladder for every pre-contact channel. The thresholds are
 * intentionally separated so a continuously closing, equally noisy source is
 * heard before it is felt, then felt before it can deform the passive ring.
 */
export const CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY = 0.26;
export const CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY = 0.5;
export const CONTACT_RING_MINIMUM_SIGNAL_QUALITY = 0.78;

export type ContactSignalStage =
  "silent" | "audio-only" | "audio-haptic" | "audio-haptic-ring";

export function contactSignalStage(signalQuality: number): ContactSignalStage {
  const quality = Number.isFinite(signalQuality) ? signalQuality : 0;
  if (quality < CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY) {
    return "silent";
  }
  if (quality < CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY) {
    return "audio-only";
  }
  if (quality < CONTACT_RING_MINIMUM_SIGNAL_QUALITY) {
    return "audio-haptic";
  }
  return "audio-haptic-ring";
}

/** Smoothly maps a signal interval to 0..1 without changing its thresholds. */
export function contactSignalProgress(
  signalQuality: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(signalQuality) || maximum <= minimum) {
    return 0;
  }
  const amount = clamp((signalQuality - minimum) / (maximum - minimum), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
