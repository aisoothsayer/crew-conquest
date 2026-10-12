import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { genTerrainFromBin } from "@openfront/engine-lib/game/TerrainMapLoader";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getResourcesDir } from "./PublicAssetManifest";
const cache = new Map<string, ReturnType<typeof load>>();
async function load(map: GameMapType, size: GameMapSize) {
  // Enum keys alone select local assets; no client path is accepted.
  const folder = path.join(
    getResourcesDir(),
    "maps",
    Object.keys(GameMapType)
      .find((k) => GameMapType[k as keyof typeof GameMapType] === map)!
      .toLowerCase(),
  );
  const manifest = JSON.parse(
    await readFile(path.join(folder, "manifest.json"), "utf8"),
  );
  const compact = size === GameMapSize.Compact;
  const bytes = new Uint8Array(
    await readFile(path.join(folder, compact ? "map4x.bin" : "map.bin")),
  );
  return genTerrainFromBin(compact ? manifest.map4x : manifest.map, bytes);
}
export function crewPlacementTerrain(map: GameMapType, size: GameMapSize) {
  const key = `${map}:${size}`;
  let loading = cache.get(key);
  if (!loading) {
    loading = load(map, size);
    cache.set(key, loading);
    loading.catch(() => cache.delete(key));
  }
  return loading;
}
