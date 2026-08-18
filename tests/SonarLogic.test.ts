import { describe, expect, it } from "vitest";
import {
  DEBUG_SENSOR_RANGE_MULTIPLIER,
  formatCircularBearing,
  passiveSonarCloseRangeGain,
  simulatePassiveSonar,
  simulateVesselPassiveSonar,
  solvePassiveSonar,
} from "../src/game/SonarLogic";
import {
  CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY,
  CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY,
  CONTACT_RING_MINIMUM_SIGNAL_QUALITY,
} from "../src/game/ContactSensoryProgression";
import { VESSEL_CLASS_CATALOG } from "../src/game/NavalContactCatalog";
import { PASSIVE_SONAR_VISIBLE_SIGNAL_THRESHOLD } from "../src/game/PassiveSonarRing";

describe("passive sonar coupling", () => {
  const observer = { x: 0, y: -90, z: 500 } as const;
  const contact = { x: 100, y: -105, z: -200 } as const;

  it("keeps bearing tied to the physical contact", () => {
    const northbound = solvePassiveSonar(observer, 0, 4, contact);
    const eastbound = solvePassiveSonar(observer, Math.PI / 2, 4, contact);
    expect(northbound.relativeBearing).toBeGreaterThan(0);
    expect(eastbound.relativeBearing).toBeLessThan(0);
  });

  it("penalizes own-ship flow noise", () => {
    const quiet = solvePassiveSonar(observer, 0, 2, contact);
    const flank = solvePassiveSonar(observer, 0, 15.5, contact);
    expect(quiet.signalQuality).toBeGreaterThan(flank.signalQuality + 0.2);
  });

  it("removes own-ship noise while drifting at stop", () => {
    const driftingAtStop = solvePassiveSonar(observer, 0, 15.5, contact, true);
    const stationary = solvePassiveSonar(observer, 0, 0, contact);
    expect(driftingAtStop.signalQuality).toBeCloseTo(
      stationary.signalQuality,
      8,
    );
  });

  it("improves as the player closes the same contact", () => {
    const far = solvePassiveSonar(observer, 0, 3, contact);
    const close = solvePassiveSonar({ x: 80, y: -100, z: -40 }, 0, 3, contact);
    expect(close.signalQuality).toBeGreaterThan(far.signalQuality);
  });

  it("improves when the source radiates more machinery noise", () => {
    const quietSource = solvePassiveSonar(observer, 0, 3, contact, false, 0.55);
    const loudSource = solvePassiveSonar(observer, 0, 3, contact, false, 1.25);

    expect(loudSource.signalQuality).toBeGreaterThan(quietSource.signalQuality);
  });

  it("reveals equal emitted noise as sound, then haptics, then ring while closing", () => {
    const equallyNoisySource = 0.322;
    const atRange = (rangeMeters: number) =>
      simulatePassiveSonar(
        { x: 0, y: -76, z: 0 },
        0,
        2.55,
        { x: 0, y: -180, z: -rangeMeters },
        false,
        equallyNoisySource,
      ).measurement.signalQuality;

    const silent = atRange(20_000);
    const audioOnly = atRange(12_000);
    const audioAndHaptics = atRange(4_000);
    const allThree = atRange(500);

    expect(silent).toBeLessThan(CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY);
    expect(audioOnly).toBeGreaterThanOrEqual(
      CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY,
    );
    expect(audioOnly).toBeLessThan(CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY);
    expect(audioAndHaptics).toBeGreaterThanOrEqual(
      CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY,
    );
    expect(audioAndHaptics).toBeLessThan(CONTACT_RING_MINIMUM_SIGNAL_QUALITY);
    expect(allThree).toBeGreaterThanOrEqual(
      CONTACT_RING_MINIMUM_SIGNAL_QUALITY,
    );
  });

  it("keeps increasing received quality inside the former five-kilometre plateau", () => {
    expect(passiveSonarCloseRangeGain(8_000)).toBe(1);
    expect(passiveSonarCloseRangeGain(4_000)).toBeGreaterThan(1.5);
    expect(passiveSonarCloseRangeGain(500)).toBe(3.2);
    expect(passiveSonarCloseRangeGain(100)).toBe(3.2);
  });

  it("extends passive-sensor falloff x100 without changing bearing or truth range", () => {
    const sourceClass = VESSEL_CLASS_CATALOG.find(
      ({ id }) => id === "merchant-slow-diesel",
    );
    expect(sourceClass).toBeDefined();
    if (sourceClass === undefined) {
      return;
    }
    const remoteSource = {
      position: { x: 0, y: -90, z: -1_999_500 },
      headingRad: 0,
      speedKt: 11,
      accelerationKtPerSec: 0,
      turnRateDegPerSec: 0,
    } as const;
    const normal = simulateVesselPassiveSonar(
      observer,
      0,
      0,
      remoteSource,
      sourceClass,
      true,
    );
    const boosted = simulateVesselPassiveSonar(
      observer,
      0,
      0,
      remoteSource,
      sourceClass,
      true,
      DEBUG_SENSOR_RANGE_MULTIPLIER,
    );

    expect(normal.measurement.perceivable).toBe(false);
    expect(boosted.measurement.perceivable).toBe(true);
    expect(boosted.measurement.signalQuality).toBeGreaterThan(
      normal.measurement.signalQuality + 0.4,
    );
    expect(boosted.truth.rangeMeters).toBe(normal.truth.rangeMeters);
    expect(boosted.measurement.worldBearingRad).toBe(
      normal.measurement.worldBearingRad,
    );
  });

  it("drives an x100 return above the ring threshold but preserves the stern baffle", () => {
    const sourceClass = VESSEL_CLASS_CATALOG.find(
      ({ id }) => id === "los-angeles-flight-i",
    );
    expect(sourceClass).toBeDefined();
    if (sourceClass === undefined) {
      return;
    }
    const quietOpeningSource = {
      position: { x: 9_192.5, y: -180, z: -7_713.5 },
      headingRad: (315 * Math.PI) / 180,
      speedKt: 8,
      accelerationKtPerSec: 0,
      turnRateDegPerSec: 0,
    } as const;
    const boosted = simulateVesselPassiveSonar(
      { x: 0, y: -76, z: 0 },
      0,
      2.5,
      quietOpeningSource,
      sourceClass,
      false,
      DEBUG_SENSOR_RANGE_MULTIPLIER,
    );
    const baffled = simulateVesselPassiveSonar(
      { x: 0, y: -76, z: 0 },
      boosted.measurement.worldBearingRad - Math.PI,
      2.5,
      quietOpeningSource,
      sourceClass,
      false,
      DEBUG_SENSOR_RANGE_MULTIPLIER,
    );

    expect(boosted.measurement.signalQuality).toBeGreaterThan(
      PASSIVE_SONAR_VISIBLE_SIGNAL_THRESHOLD,
    );
    expect(boosted.measurement.perceivable).toBe(true);
    expect(baffled.measurement.signalQuality).toBeGreaterThan(
      PASSIVE_SONAR_VISIBLE_SIGNAL_THRESHOLD,
    );
    expect(baffled.measurement.inBlindCone).toBe(true);
    expect(baffled.measurement.perceivable).toBe(false);
  });

  it("formats spoken bearings as three clockwise digits", () => {
    expect(formatCircularBearing(0)).toBe("000");
    expect(formatCircularBearing((47 * Math.PI) / 180)).toBe("047");
    expect(formatCircularBearing((-47 * Math.PI) / 180)).toBe("313");
    expect(formatCircularBearing(Math.PI)).toBe("180");
  });
});
