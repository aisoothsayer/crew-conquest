import { describe, expect, test } from "vitest";
import { getStaticAssetCacheControl } from "../../src/server/StaticAssetCache";

describe("StaticAssetCache", () => {
  test("Crew entry and corresponding source must never be reused after deployment", () => {
    for (const path of [
      "/crew.html",
      "/crew.html?entry=20261013",
      "/crew-source.zip",
      "/crew-notices.txt",
      "/crew-license.txt",
    ]) {
      expect(getStaticAssetCacheControl(path)).toBe("no-store");
    }
  });
  test("marks Vite asset namespace as immutable", () => {
    expect(getStaticAssetCacheControl("/assets/index-abc123.js")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  test("marks custom hashed asset namespace as immutable", () => {
    expect(
      getStaticAssetCacheControl("/_assets/maps/world/manifest.hash.json"),
    ).toBe("public, max-age=31536000, immutable");
  });

  test("does not mark other paths as immutable", () => {
    expect(getStaticAssetCacheControl("/manifest.json")).toBeUndefined();
    expect(getStaticAssetCacheControl("/api/health")).toBeUndefined();
  });
});
