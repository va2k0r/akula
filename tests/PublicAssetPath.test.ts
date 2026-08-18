import { describe, expect, it } from "vitest";
import { publicAssetPath } from "../src/game/PublicAssetPath";

describe("publicAssetPath", () => {
  it("keeps public files under the configured Vite base", () => {
    expect(publicAssetPath("assets/models/akula/akula.glb")).toBe(
      `${import.meta.env.BASE_URL}assets/models/akula/akula.glb`,
    );
    expect(publicAssetPath("/assets/draco/")).toBe(
      `${import.meta.env.BASE_URL}assets/draco/`,
    );
  });
});
