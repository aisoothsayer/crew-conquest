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
import {
  crewAttackBudget,
  shouldCrewCounterattack,
  usesCrewSoloAggression,
} from "@openfront/engine/execution/nation/CrewBotStrategy";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationNukeBehavior } from "@openfront/engine/execution/nation/NationNukeBehavior";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import { AiAttackBehavior } from "@openfront/engine/execution/utils/AiAttackBehavior";
import { createGame } from "@openfront/engine/game/GameImpl";
import { testGameConfig } from "../util/Wire";

function fixture(gameType = GameType.Singleplayer, funded = false) {
  const w = 240,
    h = 180;
  const map = new GameMapImpl(w, h, new Uint8Array(w * h).fill(0x80), w * h);
  const config = testGameConfig({
    gameType,
    difficulty: Difficulty.Hard,
    startingGold: 0,
    goldMultiplier: 1,
  });
  const game = createGame([], [], map, map, new EngineConfig(config, false));
  const own = game.addPlayer(
    new PlayerInfo("Solo", PlayerType.Nation, "solo0001", "solo"),
  );
  const a = game.addPlayer(new PlayerInfo("A", PlayerType.Nation, null, "a"));
  const b = game.addPlayer(new PlayerInfo("B", PlayerType.Nation, null, "b"));
  game.forEachTile((t) =>
    (game.x(t) < 80 ? a : game.x(t) < 160 ? own : b).conquer(t),
  );
  own.addTroops(game.config().maxTroops(own) * 0.8);
  a.addTroops(own.troops() * 0.85);
  b.addTroops(own.troops() * 0.85);
  own
    .buildUnit(UnitType.MissileSilo, game.ref(120, 90), {})
    .setUnderConstruction(false);
  a.buildUnit(UnitType.City, game.ref(40, 90), {}).setUnderConstruction(false);
  b.buildUnit(UnitType.City, game.ref(200, 90), {}).setUnderConstruction(false);
  game.endSpawnPhase();
  for (let i = 0; i <= game.config().spawnImmunityDuration(); i++)
    game.executeNextTick();
  // Funded fixtures buy the real atom price; production receives no grant.
  if (funded) own.addGold(game.unitInfo(UnitType.AtomBomb).cost(game, own));
  const random = new PseudoRandom(42);
  const emoji = new NationEmojiBehavior(random, game, own);
  const alliance = new NationAllianceBehavior(random, game, own, emoji);
  const attack = new AiAttackBehavior(
    random,
    game,
    own,
    0.5,
    0.3,
    0.15,
    alliance,
    emoji,
  );
  const nuke = new NationNukeBehavior(random, game, own, attack, emoji);
  return { game, own, a, config, nuke };
}

test("Solo permits a larger attack while a hosted bot keeps its existing reserve", () => {
  const solo = fixture(),
    hosted = fixture(GameType.Private);
  expect(usesCrewSoloAggression(solo.game, solo.own)).toBe(true);
  expect(usesCrewSoloAggression(hosted.game, hosted.own)).toBe(false);
  expect(crewAttackBudget(solo.game, solo.own)).toBeGreaterThan(
    crewAttackBudget(hosted.game, hosted.own),
  );
  expect(crewAttackBudget(solo.game, solo.own)).toBeLessThan(solo.own.troops());
  expect(solo.config.startingGold).toBe(0);
  expect(solo.config.goldMultiplier).toBe(1);
  expect(solo.own.gold()).toBe(0n);
});

test("Solo is more willing to counter a near-peer probe; hosted behavior stays conservative", () => {
  for (const type of [GameType.Singleplayer, GameType.Private]) {
    const { game, own, a } = fixture(type);
    a.createAttack(own, own.troops() * 0.1, null, new Set([game.ref(79, 90)]));
    expect(shouldCrewCounterattack(own, a, game)).toBe(
      type === GameType.Singleplayer,
    );
  }
});

test("Solo may proactively buy an affordable useful atom strike; hosted bots preserve their target policy", () => {
  for (const type of [GameType.Singleplayer, GameType.Private]) {
    const { game, own, nuke } = fixture(type, true);
    nuke.maybeSendNuke();
    for (let i = 0; i < 3; i++) game.executeNextTick();
    expect(own.unitsConstructed(UnitType.AtomBomb) > 0).toBe(
      type === GameType.Singleplayer,
    );
    if (type === GameType.Singleplayer) expect(own.gold()).toBe(0n);
  }
});

test("Solo cannot launch an unfunded nuke", () => {
  const { game, own, nuke } = fixture();
  nuke.maybeSendNuke();
  for (let i = 0; i < 3; i++) game.executeNextTick();
  expect(own.unitsConstructed(UnitType.AtomBomb)).toBe(0);
  expect(own.gold()).toBe(0n);
});
