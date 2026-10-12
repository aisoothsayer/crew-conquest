import {
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { GameRunner } from "@openfront/engine/GameRunner";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { setup } from "../util/Setup";

test("zero-human solo simulation exits placement and its bots grow without a human spawn", async () => {
  const game = await setup(
    "plains",
    { gameType: GameType.Singleplayer, bots: 8, nations: 0 },
    [],
    undefined,
    EngineConfig,
    false,
  );
  const runner = new GameRunner(
    game,
    new Executor(game, "crewObs1", undefined),
    () => {},
  );
  runner.init();
  const limit = game.config().numSpawnPhaseTurns();
  for (let t = 0; t < limit + 200; t++) {
    runner.addTurn({ turnNumber: t, intents: [] });
    expect(runner.executeNextTick()).toBe(true);
  }
  expect(game.inSpawnPhase()).toBe(false);
  expect(
    game.players().filter((p) => p.type() === PlayerType.Human),
  ).toHaveLength(0);
  expect(
    game
      .players()
      .some((p) => p.type() === PlayerType.Bot && p.numTilesOwned() > 10),
  ).toBe(true);
});
test("ordinary solo still waits for its human's placement", async () => {
  const human = new PlayerInfo(
    "Danny",
    PlayerType.Human,
    "client01",
    "human001",
  );
  const game = await setup(
    "plains",
    { gameType: GameType.Singleplayer, bots: 0, nations: 0 },
    [human],
    undefined,
    EngineConfig,
    false,
  );
  const runner = new GameRunner(
    game,
    new Executor(game, "crewSolo", human.clientID ?? undefined),
    () => {},
  );
  runner.init();
  for (let t = 0; t < game.config().numSpawnPhaseTurns() + 10; t++) {
    runner.addTurn({ turnNumber: t, intents: [] });
    expect(runner.executeNextTick()).toBe(true);
  }
  expect(game.inSpawnPhase()).toBe(true);
});
