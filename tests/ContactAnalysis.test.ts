import { describe, expect, it } from "vitest";
import { FROSTBITE_CONTACT_SIGNATURE } from "../src/game/ContactSignature";
import {
  FROSTBITE_TEST_CONTACT,
  vesselClassById,
} from "../src/game/NavalContactCatalog";
import {
  crewContactMarkCanProject,
  hasContactAnalysisInput,
} from "../src/game/PrototypeGame";

describe("contextual contact analysis", () => {
  it("uses the easy 1:2:4 Frostbite identity", () => {
    expect(FROSTBITE_CONTACT_SIGNATURE).toEqual([1, 2, 4]);
    expect(
      vesselClassById(FROSTBITE_TEST_CONTACT.classId).signatureCode,
    ).toEqual(FROSTBITE_CONTACT_SIGNATURE);
  });

  it("opens from A or the acoustic-code D-pad input", () => {
    expect(
      hasContactAnalysisInput({
        submit: true,
        digitSelectDelta: 0,
        digitValueDelta: 0,
        directDigit: undefined,
      }),
    ).toBe(true);
    expect(
      hasContactAnalysisInput({
        submit: false,
        digitSelectDelta: 1,
        digitValueDelta: 0,
        directDigit: undefined,
      }),
    ).toBe(true);
    expect(
      hasContactAnalysisInput({
        submit: false,
        digitSelectDelta: 0,
        digitValueDelta: -1,
        directDigit: undefined,
      }),
    ).toBe(true);
    expect(
      hasContactAnalysisInput({
        submit: false,
        digitSelectDelta: 0,
        digitValueDelta: 0,
        directDigit: undefined,
      }),
    ).toBe(false);
  });

  it("keeps the crew mark projectable after the track is lost", () => {
    expect(crewContactMarkCanProject({ status: "LOST" }, true, 0)).toBe(true);
    expect(crewContactMarkCanProject({ status: "LOST" }, false, 0)).toBe(false);
    expect(crewContactMarkCanProject({ status: "HELD" }, true, 0.2)).toBe(
      false,
    );
  });
});
