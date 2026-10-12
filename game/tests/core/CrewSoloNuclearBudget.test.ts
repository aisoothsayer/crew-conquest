import {
  Difficulty,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { crewSoloNuclearReserve } from "@openfront/engine/execution/nation/CrewBotStrategy";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { createGame } from "@openfront/engine/game/GameImpl";
import { testGameConfig } from "../util/Wire";

function fixture(type = GameType.Singleplayer, disabledUnits: UnitType[] = []) {
  const map = new GameMapImpl(
    300,
    200,
    new Uint8Array(60000).fill(0x80),
    60000,
  );
  const game = createGame(
    [],
    [],
    map,
    map,
    new EngineConfig(
      testGameConfig({
        gameType: type,
        difficulty: Difficulty.Hard,
        disabledUnits,
      }),
      false,
    ),
  );
  const own = game.addPlayer(
    new PlayerInfo("Solo", PlayerType.Nation, "solo0001", "solo"),
  );
  const enemy = game.addPlayer(
    new PlayerInfo("Enemy", PlayerType.Nation, "enemy001", "enemy"),
  );
  game.forEachTile((t) => (game.x(t) < 200 ? own : enemy).conquer(t));
  const build = (p: typeof own, unit: UnitType, x: number, y: number) =>
    p.buildUnit(unit, game.ref(x, y), {}).setUnderConstruction(false);
  build(own, UnitType.City, 50, 50);
  build(own, UnitType.City, 150, 150);
  build(own, UnitType.Factory, 100, 100);
  build(own, UnitType.DefensePost, 50, 55);
  build(own, UnitType.DefensePost, 150, 155);
  build(enemy, UnitType.City, 250, 100);
  game.endSpawnPhase();
  const behavior = new NationStructureBehavior(new PseudoRandom(42), game, own);
  return { game, own, enemy, build, behavior };
}

test("a Solo economy saves the actual silo price instead of spending it on another building", () => {
  const { game, own, behavior } = fixture();
  const price = game.unitInfo(UnitType.MissileSilo).cost(game, own);
  own.addGold(price - 1n);
  expect(crewSoloNuclearReserve(game, own)).toBe(price);
  expect(behavior.handleStructures()).toBe(false);
  expect(own.gold()).toBe(price - 1n);
  own.addGold(1n);
  expect(behavior.handleStructures()).toBe(true);
  for (let i = 0; i < 3; i++) game.executeNextTick();
  expect(own.unitsOwned(UnitType.MissileSilo)).toBe(1);
  expect(own.gold()).toBe(0n);
  expect(crewSoloNuclearReserve(game, own)).toBe(
    game.unitInfo(UnitType.AtomBomb).cost(game, own),
  );
});

test("Solo preserves bomb funds from optional infrastructure once a silo exists", () => {
  const { game, own, build, behavior } = fixture();
  build(own, UnitType.MissileSilo, 100, 50);
  const price = game.unitInfo(UnitType.AtomBomb).cost(game, own);
  own.addGold(price);
  expect(behavior.handleStructures()).toBe(false);
  expect(own.gold()).toBe(price);
});

test("hosted bots, disabled nuclear weapons and an unfinished economy do not adopt Solo savings", () => {
  const hosted = fixture(GameType.Private);
  expect(crewSoloNuclearReserve(hosted.game, hosted.own)).toBe(0n);
  const disabled = fixture(GameType.Singleplayer, [
    UnitType.AtomBomb,
    UnitType.HydrogenBomb,
  ]);
  expect(crewSoloNuclearReserve(disabled.game, disabled.own)).toBe(0n);
  const early = fixture();
  early.own.units(UnitType.Factory)[0].delete(false);
  expect(crewSoloNuclearReserve(early.game, early.own)).toBe(0n);
});

test("an actual rival silo permits affordable initial SAM protection before nuclear saving", () => {
  const { game, own, enemy, build, behavior } = fixture();
  build(own, UnitType.MissileSilo, 100, 50);
  build(enemy, UnitType.MissileSilo, 250, 50);
  const price = game.unitInfo(UnitType.SAMLauncher).cost(game, own);
  own.addGold(price);
  expect(behavior.handleStructures()).toBe(true);
  for (let i = 0; i < 3; i++) game.executeNextTick();
  expect(own.unitsOwned(UnitType.SAMLauncher)).toBe(1);
  expect(own.gold()).toBe(0n);
});
