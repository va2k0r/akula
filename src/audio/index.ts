export { AcousticSignatureEngine } from "./AcousticSignatureEngine";
export {
  CONTACT_SOUND_PROFILES,
  contactPulseOnsets,
  contactSoundAssetPath,
  contactSoundProfileById,
} from "./contactSoundBank";
export { PROPELLER_PRESET } from "./propellerPreset";
export {
  areAcousticCodesEquivalent,
  normalizeAcousticCode,
  validateAcousticSignature,
} from "./signatureMath";
export type { PropellerSoundPreset } from "./propellerPreset";
export type {
  ContactSoundComponentDefinition,
  ContactSoundComponentKind,
  ContactSoundProfile,
} from "./contactSoundBank";
export type { AcousticCode, AcousticSignatureEngineOptions } from "./types";
