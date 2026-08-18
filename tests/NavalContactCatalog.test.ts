import { describe, expect, it } from "vitest";
import {
  FROSTBITE_TEST_CONTACT,
  VESSEL_CLASS_CATALOG,
  estimatedSpeedKnots,
  observedPropulsionRateHz,
  resolveVesselClassHypothesis,
  signatureCodesMatch,
  vesselClassById,
} from "../src/game/NavalContactCatalog";
import { SubmarineDynamics } from "../src/game/SubmarineDynamics";

describe("data-driven naval contact catalog", () => {
  it("starts THE HUNT contact 6 km from the centred Akula", () => {
    const ownship = new SubmarineDynamics().state;
    expect(ownship.x).toBe(0);
    expect(ownship.z).toBe(0);
    expect(
      Math.hypot(
        FROSTBITE_TEST_CONTACT.truePosition.x - ownship.x,
        FROSTBITE_TEST_CONTACT.truePosition.z - ownship.z,
      ),
    ).toBeCloseTo(6_000, 8);
  });

  it("keeps every hand-authored acoustic signature positive and distinct", () => {
    for (const definition of VESSEL_CLASS_CATALOG) {
      expect(definition.signatureCode.every(Number.isSafeInteger)).toBe(true);
      expect(definition.signatureCode.every((value) => value > 0)).toBe(true);
      expect(new Set(definition.signatureCode).size).toBe(3);
    }
  });

  it("preserves permutation-invariant class identity from the accepted canon", () => {
    expect(signatureCodesMatch([1, 2, 4], [4, 1, 2])).toBe(true);
    expect(resolveVesselClassHypothesis([4, 1, 2]).definition.id).toBe(
      "los-angeles-flight-i",
    );
  });

  it("derives correct and wrong speed only through the observed acoustic rate", () => {
    const trueClass = vesselClassById(FROSTBITE_TEST_CONTACT.classId);
    const observedRate = observedPropulsionRateHz(
      FROSTBITE_TEST_CONTACT,
      trueClass,
    );
    const correct = estimatedSpeedKnots(observedRate, trueClass);
    const similarWrongClass = resolveVesselClassHypothesis([
      3, 4, 5,
    ]).definition;
    const plausibleWrong = estimatedSpeedKnots(observedRate, similarWrongClass);

    expect(correct).toBeCloseTo(FROSTBITE_TEST_CONTACT.trueSpeedKt, 8);
    expect(plausibleWrong).not.toBeCloseTo(correct, 2);
    expect(plausibleWrong).toBeGreaterThan(correct * 0.85);
    expect(plausibleWrong).toBeLessThan(correct * 1.15);
  });
});
