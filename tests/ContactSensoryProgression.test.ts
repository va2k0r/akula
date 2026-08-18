import { describe, expect, it } from "vitest";
import {
  CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY,
  CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY,
  CONTACT_RING_MINIMUM_SIGNAL_QUALITY,
  contactSignalStage,
} from "../src/game/ContactSensoryProgression";

describe("contact sensory progression", () => {
  it("fixes one strict sound, haptic, ring order", () => {
    expect(CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY).toBe(0.26);
    expect(CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY).toBe(0.5);
    expect(CONTACT_RING_MINIMUM_SIGNAL_QUALITY).toBe(0.78);
    expect(CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY).toBeLessThan(
      CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY,
    );
    expect(CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY).toBeLessThan(
      CONTACT_RING_MINIMUM_SIGNAL_QUALITY,
    );
  });

  it("never exposes a later channel without every earlier channel", () => {
    expect(contactSignalStage(0.259)).toBe("silent");
    expect(contactSignalStage(0.26)).toBe("audio-only");
    expect(contactSignalStage(0.499)).toBe("audio-only");
    expect(contactSignalStage(0.5)).toBe("audio-haptic");
    expect(contactSignalStage(0.779)).toBe("audio-haptic");
    expect(contactSignalStage(0.78)).toBe("audio-haptic-ring");
  });
});
