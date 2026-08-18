import { describe, expect, it } from "vitest";
import {
  appendTorpedoRunToEnable,
  closestTorpedoTargetLead,
  cycleTorpedoTargetLead,
  initialTorpedoEnablePoint,
  moveTorpedoEnablePoint,
  torpedoTargetLead,
  torpedoTravelTimeSeconds,
  torpedoTrajectoryHeading,
} from "../src/game/TorpedoFireControl";

describe("torpedo run-to-enable fire control", () => {
  it("retains multiple set points for one simultaneous salvo", () => {
    const first = appendTorpedoRunToEnable(
      [],
      { x: 800, z: -3_200 },
      "contact-1",
    );
    const second = appendTorpedoRunToEnable(
      first,
      { x: 800, z: -3_200 },
      "contact-2",
    );

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
    expect(second.every(({ status }) => status === "confirmed")).toBe(true);
    expect(second.map(({ targetTrackId }) => targetTrackId)).toEqual([
      "contact-1",
      "contact-2",
    ]);
  });

  it("projects the selected TMA motion to the torpedo arrival time", () => {
    const lead = torpedoTargetLead(
      {
        trackId: "contact-1",
        trackLabel: "ЦЕЛЬ 1",
        currentPosition: { x: 1_000, z: -2_000 },
        courseRad: Math.PI / 2,
        speedMps: 4,
      },
      { x: 0, z: 0 },
      { x: 4_500, z: 0 },
      10,
    );

    expect(
      torpedoTravelTimeSeconds({ x: 0, z: 0 }, { x: 4_500, z: 0 }, 10),
    ).toBe(450);
    expect(lead.travelTimeSeconds).toBe(450);
    expect(lead.predictedPosition.x).toBeCloseTo(2_800);
    expect(lead.predictedPosition.z).toBeCloseTo(-2_000);
    expect(lead.markerSeparationMeters).toBeCloseTo(Math.hypot(1_700, 2_000));
  });

  it("selects the future TMA position nearest the marker", () => {
    const near = torpedoTargetLead(
      {
        trackId: "contact-1",
        trackLabel: "ЦЕЛЬ 1",
        currentPosition: { x: 1_000, z: 0 },
        courseRad: 0,
        speedMps: 0,
      },
      { x: 0, z: 0 },
      { x: 1_200, z: 0 },
      10,
    );
    const far = torpedoTargetLead(
      {
        trackId: "contact-2",
        trackLabel: "ЦЕЛЬ 2",
        currentPosition: { x: 8_000, z: 0 },
        courseRad: 0,
        speedMps: 0,
      },
      { x: 0, z: 0 },
      { x: 1_200, z: 0 },
      10,
    );

    expect(closestTorpedoTargetLead([far, near])?.trackId).toBe("contact-1");
  });

  it("cycles possible TMA targets in both directions with wraparound", () => {
    const leads = ["contact-1", "contact-2", "contact-3"].map(
      (trackId, index) => ({
        trackId,
        trackLabel: `ЦЕЛЬ ${String(index + 1)}`,
        currentPosition: { x: index, z: 0 },
        predictedPosition: { x: index, z: 0 },
        travelTimeSeconds: 100,
        markerSeparationMeters: index,
      }),
    );

    expect(cycleTorpedoTargetLead(leads, "contact-1", -1)?.trackId).toBe(
      "contact-3",
    );
    expect(cycleTorpedoTargetLead(leads, "contact-3", 1)?.trackId).toBe(
      "contact-1",
    );
  });

  it("starts on the visible TMA estimate when one exists", () => {
    expect(
      initialTorpedoEnablePoint({ x: 0, z: 0 }, 0, 15_000, {
        x: 4_200,
        z: -7_100,
      }),
    ).toEqual({ x: 4_200, z: -7_100 });
  });

  it("falls back to a point ahead of ownship", () => {
    const point = initialTorpedoEnablePoint(
      { x: 100, z: 200 },
      Math.PI / 2,
      15_000,
    );

    expect(point.x).toBeCloseTo(4_100);
    expect(point.z).toBeCloseTo(200);
  });

  it("keeps stick motion aligned to the rotated map", () => {
    const moved = moveTorpedoEnablePoint(
      { x: 0, z: -2_000 },
      { x: 0, z: 0 },
      {
        stickX: 1,
        stickY: 0,
        viewYawRad: Math.PI / 2,
        viewHalfSpanMeters: 10_000,
        deltaSeconds: 0.05,
      },
    );

    expect(moved.x).toBeCloseTo(0);
    expect(moved.z).toBeGreaterThan(-2_000);
  });

  it("keeps the marker inside the readable plot", () => {
    const point = initialTorpedoEnablePoint({ x: 0, z: 0 }, 0, 10_000, {
      x: 50_000,
      z: 0,
    });

    expect(Math.hypot(point.x, point.z)).toBeCloseTo(8_800);
  });

  it("uses the run from ownship to the enable point as search heading", () => {
    expect(
      torpedoTrajectoryHeading({ x: 0, z: 0 }, { x: 2_000, z: 0 }),
    ).toBeCloseTo(Math.PI / 2);
    expect(
      torpedoTrajectoryHeading({ x: 0, z: 0 }, { x: 0, z: -2_000 }),
    ).toBeCloseTo(0);
  });
});
