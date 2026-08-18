import { describe, expect, it } from "vitest";
import {
  scrollingHistogramX,
  symmetricHistogramBarBounds,
} from "../src/visualization/AcousticSignatureScope";

describe("constructive acoustic histogram geometry", () => {
  it("grows by the same amount above and below the center line", () => {
    const bounds = symmetricHistogramBarBounds(0.72, 100);

    expect((bounds.top + bounds.bottom) / 2).toBe(50);
    expect(50 - bounds.top).toBeCloseTo(bounds.bottom - 50, 12);
  });

  it("moves old samples left while new samples enter on the right", () => {
    const firstSampleAtArrival = scrollingHistogramX(0, 1, 10, 100);
    const sameSampleOneTickLater = scrollingHistogramX(0, 2, 10, 100);
    const newSample = scrollingHistogramX(1, 2, 10, 100);

    expect(firstSampleAtArrival).toBe(95);
    expect(sameSampleOneTickLater).toBe(85);
    expect(newSample).toBe(95);
  });
});
