import type { GameMap } from "@openfront/engine-api/game/GameMap";
export const CREW_BOT_LIMIT = 64;
export const CREW_SOLO_BOT_LIMIT = 100;
export const CREW_BOT_SPACING = 32;
export type BotSpawn = { x: number; y: number };
export function validBotSpawn(
  map: GameMap,
  point: BotSpawn,
  others: readonly BotSpawn[],
): boolean {
  return (
    Number.isInteger(point.x) &&
    Number.isInteger(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < map.width() &&
    point.y < map.height() &&
    map.isLand(map.ref(point.x, point.y)) &&
    !map.isImpassable(map.ref(point.x, point.y)) &&
    others.every(
      (p) =>
        (p.x - point.x) * (p.x - point.x) + (p.y - point.y) * (p.y - point.y) >=
        CREW_BOT_SPACING * CREW_BOT_SPACING,
    )
  );
}

/** Fill available land without moving manually selected points. */
export function fillSoloBotSpawns(
  map: GameMap,
  existing: readonly BotSpawn[],
  total: number,
  random: () => number,
): BotSpawn[] {
  const result = [...existing];
  const target = Math.max(
    result.length,
    Math.min(CREW_SOLO_BOT_LIMIT, Math.floor(total)),
  );
  // Bounded work; a small map may have fewer legal slots. Never relax spacing.
  for (let tries = 0; tries < 50_000 && result.length < target; tries++) {
    const point = {
      x: Math.floor(random() * map.width()),
      y: Math.floor(random() * map.height()),
    };
    if (validBotSpawn(map, point, result)) result.push(point);
  }
  return result;
}
