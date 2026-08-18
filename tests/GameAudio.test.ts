import { describe, expect, it } from "vitest";
import {
  cameraMediumMixTargets,
  CONTACT_COMFORT_MAXIMUM_MIX_GAIN,
  contactMixTargets,
  ownShipNoiseGains,
  sonarContactReportVariant,
} from "../src/game/GameAudio";
import {
  CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY,
  CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY,
  CONTACT_RING_MINIMUM_SIGNAL_QUALITY,
} from "../src/game/ContactSensoryProgression";

describe("own-ship motion audio", () => {
  it("is digitally silent at stop even while the submarine is drifting", () => {
    expect(ownShipNoiseGains(14, 1, 0)).toEqual({
      machinery: 0,
      flow: 0,
    });
  });

  it("restores continuous motion noise outside stop", () => {
    const noise = ownShipNoiseGains(14, 1, 0.16);
    expect(noise.machinery).toBeGreaterThan(0);
    expect(noise.flow).toBeGreaterThan(0);
  });
});

describe("camera waterline audio", () => {
  it("opens the full storm in air and leaves only pressure below water", () => {
    const above = cameraMediumMixTargets(0);
    const below = cameraMediumMixTargets(1);

    expect(above.airExposure).toBe(1);
    expect(above.stormGain).toBeGreaterThan(0.4);
    expect(above.stormLowpassHz).toBeGreaterThan(15_000);
    expect(below.airExposure).toBe(0);
    expect(below.stormGain).toBeLessThan(0.003);
    expect(below.stormLowpassHz).toBeCloseTo(145);
  });

  it("changes continuously but decisively through the waterline", () => {
    const amounts = [0, 0.25, 0.5, 0.75, 1];
    const mixes = amounts.map(cameraMediumMixTargets);

    for (let index = 1; index < mixes.length; index += 1) {
      expect(mixes[index]?.stormGain).toBeLessThan(
        mixes[index - 1]?.stormGain ?? Number.POSITIVE_INFINITY,
      );
      expect(mixes[index]?.stormLowpassHz).toBeLessThan(
        mixes[index - 1]?.stormLowpassHz ?? Number.POSITIVE_INFINITY,
      );
    }
    expect(mixes[2]?.stormGain).toBeGreaterThan(0.2);
    expect(mixes[2]?.stormGain).toBeLessThan(0.23);
    expect(mixes[2]?.stormLowpassHz).toBeGreaterThan(3_000);
    expect(mixes[2]?.stormLowpassHz).toBeLessThan(4_000);
  });
});

describe("directional contact mix", () => {
  it("introduces the first sound with a slight score duck but keeps own-ship masking", () => {
    const mix = contactMixTargets(
      CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY + 0.01,
      true,
    );

    expect(mix.contact).toBeGreaterThan(0);
    expect(mix.contact).toBeLessThan(0.08);
    expect(mix.soundtrack).toBeGreaterThan(0.1);
    expect(mix.soundtrack).toBeLessThan(0.13);
    expect(mix.ownShip).toBe(1);
  });

  it("progressively clears masking after haptics join the sound", () => {
    const mix = contactMixTargets(
      (CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY +
        CONTACT_RING_MINIMUM_SIGNAL_QUALITY) /
        2,
      true,
    );

    expect(mix.contact).toBeGreaterThan(0.45);
    expect(mix.soundtrack).toBeGreaterThan(0.006);
    expect(mix.soundtrack).toBeLessThan(0.13);
    expect(mix.ownShip).toBeGreaterThan(0.04);
    expect(mix.ownShip).toBeLessThan(1);
  });

  it("reaches the full clear mix only with a ring-quality return", () => {
    const mix = contactMixTargets(CONTACT_RING_MINIMUM_SIGNAL_QUALITY, true);

    expect(mix.contact).toBe(CONTACT_COMFORT_MAXIMUM_MIX_GAIN);
    expect(mix.soundtrack).toBeCloseTo(0.006);
    expect(mix.ownShip).toBeCloseTo(0.04);
  });

  it("never exceeds the restrained contact ceiling at point-blank quality", () => {
    expect(contactMixTargets(1, true).contact).toBe(
      CONTACT_COMFORT_MAXIMUM_MIX_GAIN,
    );
    expect(CONTACT_COMFORT_MAXIMUM_MIX_GAIN).toBeLessThan(0.6);
  });

  it("restores the normal mix outside the sector", () => {
    expect(contactMixTargets(0.68, false)).toEqual({
      contact: 0,
      soundtrack: 0.13,
      ownShip: 1,
    });
  });

  it("stays silent below the first received-signal threshold", () => {
    expect(
      contactMixTargets(CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY - 0.001, true),
    ).toEqual({
      contact: 0,
      soundtrack: 0.13,
      ownShip: 1,
    });
  });
});

describe("Russian sonarist contact call", () => {
  it("uses the full call first, then mostly the shorter form", () => {
    expect(sonarContactReportVariant(0)).toBe("full");
    expect([1, 2, 3, 4].map(sonarContactReportVariant)).toEqual([
      "short",
      "short",
      "short",
      "short",
    ]);
    expect(sonarContactReportVariant(5)).toBe("full");
    expect(sonarContactReportVariant(6)).toBe("short");
  });
});
