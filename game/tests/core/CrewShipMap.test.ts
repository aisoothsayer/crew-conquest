import { GameMapType, maps } from "@openfront/engine-api/game/GameTypes";
import { genTerrainFromBin } from "@openfront/engine-lib/game/TerrainMapLoader";
import fs from "node:fs";
import path from "node:path";

test("ship map is registered, has one connected island at each size, and every nation spawns on land", async () => {
  const folder = path.resolve("resources/maps/crewship");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(folder, "manifest.json"), "utf8"),
  );
  expect(
    maps.find((m) => m.type === GameMapType.CrewShip)?.defaultNationCount,
  ).toBe(manifest.nations.length);
  for (const [size, file] of [
    ["map", "map.bin"],
    ["map4x", "map4x.bin"],
    ["map16x", "map16x.bin"],
  ]) {
    const metadata = manifest[size];
    const bytes = new Uint8Array(fs.readFileSync(path.join(folder, file)));
    const grid = await genTerrainFromBin(metadata, bytes);
    const { width, height } = metadata;
    const first = bytes.findIndex((b) => (b & 128) !== 0);
    const seen = new Uint8Array(bytes.length),
      queue = new Uint32Array(metadata.num_land_tiles);
    let begin = 0,
      end = 1;
    queue[0] = first;
    seen[first] = 1;
    while (begin < end) {
      const i = queue[begin++],
        x = i % width,
        y = Math.floor(i / width);
      for (const n of [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ])
        if (n >= 0 && !seen[n] && bytes[n] & 128) {
          seen[n] = 1;
          queue[end++] = n;
        }
    }
    expect(end).toBe(metadata.num_land_tiles);
    expect(grid.numLandTiles()).toBe(metadata.num_land_tiles);
    expect(bytes.slice(0, width).every((b) => (b & 128) === 0)).toBe(true);
    const scale = size === "map" ? 1 : size === "map4x" ? 2 : 4;
    for (const nation of manifest.nations) {
      const [x, y] = nation.coordinates.map((v: number) =>
        Math.floor(v / scale),
      );
      expect(grid.isLand(grid.ref(x, y))).toBe(true);
    }
  }
});
