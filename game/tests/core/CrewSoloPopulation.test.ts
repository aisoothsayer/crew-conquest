import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  CREW_BOT_LIMIT,
  CREW_SOLO_BOT_LIMIT,
  fillSoloBotSpawns,
  validBotSpawn,
} from "@openfront/shared/CrewBotPlacement";

test("Solo fills 100 valid spaced positions without moving existing points or changing the hosted cap", () => {
  const map = new GameMapImpl(
    1000,
    600,
    new Uint8Array(600000).fill(0x80),
    600000,
  );
  const existing = [{ x: 100, y: 100 }];
  const fill = () => {
    const random = new PseudoRandom(42);
    return fillSoloBotSpawns(
      map,
      existing,
      500,
      () => random.nextInt(0, 1000000) / 1000000,
    );
  };
  const points = fill();
  expect(CREW_BOT_LIMIT).toBe(64);
  expect(CREW_SOLO_BOT_LIMIT).toBe(100);
  expect(points).toHaveLength(100);
  expect(points[0]).toEqual(existing[0]);
  expect(existing).toHaveLength(1);
  points.forEach((p, i) =>
    expect(validBotSpawn(map, p, points.slice(0, i))).toBe(true),
  );
  expect(fill()).toEqual(points);
});

test("a tiny map returns only legal available positions rather than ignoring spacing", () => {
  const map = new GameMapImpl(20, 20, new Uint8Array(400).fill(0x80), 400);
  const points = fillSoloBotSpawns(map, [], 100, () => 0.5);
  expect(points).toEqual([{ x: 10, y: 10 }]);
  expect(validBotSpawn(map, { x: -1, y: 10 }, [])).toBe(false);
});
