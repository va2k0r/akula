import type { AcousticCode } from "../audio";

/**
 * Ordered machinery channels for the Frostbite contact. Classification remains
 * order-independent; channel A is kept first so sensory systems can reference
 * its cadence without changing the deliberately easy 1:2:4 identity.
 */
export const FROSTBITE_CONTACT_SIGNATURE: AcousticCode = [1, 2, 4];

export const FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS = 4.45;
