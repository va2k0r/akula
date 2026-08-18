import { describe, expect, it } from "vitest";
import {
  SEABED_LIDAR_MAX_CLEARANCE_METERS,
  SEABED_LIDAR_MIN_SCAN_INTERVAL_SECONDS,
  SEABED_LIDAR_SCAN_INTERVAL_SECONDS,
  seabedLidarHapticPulse,
  seabedLidarProfile,
  seabedLidarRoundTripSeconds,
} from "../src/game/SeabedLidar";

describe("seabed maneuver lidar", () => {
  it("expands progressively as the submarine approaches the floor", () => {
    const far = seabedLidarProfile(74);
    const maneuvering = seabedLidarProfile(42);
    const close = seabedLidarProfile(12);

    expect(far.amount).toBeGreaterThan(0);
    expect(maneuvering.amount).toBeGreaterThan(far.amount);
    expect(close.amount).toBeGreaterThan(maneuvering.amount);
    expect(maneuvering.radiusMeters).toBeGreaterThan(far.radiusMeters);
    expect(close.radiusMeters).toBeGreaterThan(maneuvering.radiusMeters);
    expect(close.returnIntervalSeconds).toBeLessThan(
      maneuvering.returnIntervalSeconds,
    );
    expect(maneuvering.returnIntervalSeconds).toBeLessThan(
      far.returnIntervalSeconds,
    );
  });

  it("shrinks to nothing at and beyond its activation distance", () => {
    expect(seabedLidarProfile(SEABED_LIDAR_MAX_CLEARANCE_METERS)).toEqual({
      amount: 0,
      radiusMeters: 0,
      returnIntervalSeconds: SEABED_LIDAR_SCAN_INTERVAL_SECONDS,
    });
    expect(seabedLidarProfile(500)).toEqual({
      amount: 0,
      radiusMeters: 0,
      returnIntervalSeconds: SEABED_LIDAR_SCAN_INTERVAL_SECONDS,
    });
    expect(seabedLidarProfile(Number.POSITIVE_INFINITY)).toEqual({
      amount: 0,
      radiusMeters: 0,
      returnIntervalSeconds: SEABED_LIDAR_SCAN_INTERVAL_SECONDS,
    });
    expect(seabedLidarHapticPulse(500)).toBeUndefined();
  });

  it("uses two-way travel time as a readable parking-sensor cadence", () => {
    expect(
      seabedLidarRoundTripSeconds(SEABED_LIDAR_MAX_CLEARANCE_METERS),
    ).toBeCloseTo(SEABED_LIDAR_SCAN_INTERVAL_SECONDS, 6);
    expect(seabedLidarRoundTripSeconds(41)).toBeCloseTo(
      SEABED_LIDAR_SCAN_INTERVAL_SECONDS / 2,
      6,
    );
    expect(seabedLidarRoundTripSeconds(0)).toBe(
      SEABED_LIDAR_MIN_SCAN_INTERVAL_SECONDS,
    );
  });

  it("makes close returns stronger while preserving a distinct gap", () => {
    const far = seabedLidarHapticPulse(74);
    const close = seabedLidarHapticPulse(12);

    expect(far).toBeDefined();
    expect(close).toBeDefined();
    expect(close?.strongMagnitude).toBeGreaterThan(far?.strongMagnitude ?? 1);
    expect(close?.weakMagnitude).toBeGreaterThan(far?.weakMagnitude ?? 1);
    expect((close?.durationMilliseconds ?? 1) / 1_000).toBeLessThan(
      close?.returnIntervalSeconds ?? 0,
    );
  });
});
