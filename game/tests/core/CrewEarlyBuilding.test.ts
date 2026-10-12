import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { createGame as realGame } from "@openfront/engine/game/GameImpl";
import { testGameConfig } from "../util/Wire";
import { createGame, L, W } from "./pathfinding/_fixtures";

function fixture(
  clientID: string | null = "crew0001",
  disabledUnits: UnitType[] = [],
) {
  const width = 200,
    height = 100;
  const terrain = createGame({
    width,
    height,
    grid: Array.from({ length: width * height }, (_, i) =>
      i % width < 50 ? W : L,
    ),
  }).map();
  const game = realGame(
    [],
    [],
    terrain,
    terrain,
    new EngineConfig(
      testGameConfig({ difficulty: Difficulty.Hard, disabledUnits }),
      false,
    ),
  );
  const player = game.addPlayer(
    new PlayerInfo("Builder", PlayerType.Nation, clientID, "builder"),
  );
  game.map().forEachTile((tile) => {
    if (game.isLand(tile)) player.conquer(tile);
  });
  game.endSpawnPhase();
  const behavior = new NationStructureBehavior(
    new PseudoRandom(42),
    game,
    player,
  );
  const build = () => {
    const result = behavior.handleStructures();
    for (let i = 0; i < 60; i++) game.executeNextTick();
    return result;
  };
  return { game, player, behavior, build };
}

test("opening city starts when its actual cost is available, never before", () => {
  const { game, player, build } = fixture();
  const price = game.unitInfo(UnitType.City).cost(game, player);
  player.addGold(price - 1n);
  expect(build()).toBe(false);
  expect(player.unitsOwned(UnitType.City)).toBe(0);
  player.addGold(1n);
  expect(build()).toBe(true);
  expect(player.unitsOwned(UnitType.City)).toBe(1);
  expect(player.gold()).toBe(0n);
});

test("a city receives an affordable defensive post before any incoming attack", () => {
  const { game, player, build } = fixture();
  player.addGold(game.unitInfo(UnitType.City).cost(game, player));
  build();
  const price = game.unitInfo(UnitType.DefensePost).cost(game, player);
  player.addGold(price - 1n);
  expect(build()).toBe(false);
  player.addGold(1n);
  expect(player.incomingAttacks()).toHaveLength(0);
  expect(build()).toBe(true);
  const [post] = player.units(UnitType.DefensePost);
  expect(post).toBeDefined();
  expect(
    game.euclideanDistSquared(
      post.tile(),
      player.units(UnitType.City)[0].tile(),
    ),
  ).toBeLessThanOrEqual(game.config().defensePostRange() ** 2);
  expect(player.gold()).toBe(0n);
});

test("first port does not wait for a second city or a second coastal player", () => {
  const { game, player, build } = fixture();
  player.addGold(game.unitInfo(UnitType.City).cost(game, player));
  build();
  player.addGold(game.unitInfo(UnitType.DefensePost).cost(game, player));
  build();
  player.addGold(game.unitInfo(UnitType.Port).cost(game, player));
  expect(build()).toBe(true);
  expect(player.unitsOwned(UnitType.City)).toBe(1);
  expect(player.unitsOwned(UnitType.Port)).toBe(1);
  expect(game.isShore(player.units(UnitType.Port)[0].tile())).toBe(true);
  expect(player.gold()).toBe(0n);
});

test("disabled ports and defenses stay disabled", () => {
  const { game, player, build } = fixture("crew0001", [
    UnitType.Port,
    UnitType.Factory,
    UnitType.DefensePost,
  ]);
  player.addGold(game.unitInfo(UnitType.City).cost(game, player));
  build();
  player.addGold(game.unitInfo(UnitType.City).cost(game, player));
  expect(build()).toBe(true);
  expect(player.unitsOwned(UnitType.City)).toBe(2);
  expect(player.unitsOwned(UnitType.Port)).toBe(0);
  expect(player.unitsOwned(UnitType.DefensePost)).toBe(0);
});

test("ordinary map nations retain their original opening behavior", () => {
  const { game, player, build } = fixture(null);
  player.addGold(game.unitInfo(UnitType.City).cost(game, player));
  build();
  player.addGold(game.unitInfo(UnitType.Port).cost(game, player));
  expect(build()).toBe(false);
  expect(player.unitsOwned(UnitType.City)).toBe(1);
  expect(player.unitsOwned(UnitType.Port)).toBe(0);
  expect(player.unitsOwned(UnitType.DefensePost)).toBe(0);
});
