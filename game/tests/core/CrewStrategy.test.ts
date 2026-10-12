import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import {
  crewAttackBudget,
  crewLandAttackScore,
  shouldCrewCounterattack,
  usesCrewStrategy,
} from "@openfront/engine/execution/nation/CrewBotStrategy";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { AiAttackBehavior } from "@openfront/engine/execution/utils/AiAttackBehavior";
import { createGame } from "@openfront/engine/game/GameImpl";
import { testGameConfig } from "../util/Wire";

function fixture(disablePosts = true) {
  const width = 240,
    height = 180;
  const terrain = new Uint8Array(width * height);
  for (let i = 0; i < terrain.length; i++)
    terrain[i] = 0x80 | (i % width >= 160 ? 25 : 0);
  const map = new GameMapImpl(width, height, terrain, terrain.length);
  const game = createGame(
    [],
    [],
    map,
    map,
    new EngineConfig(
      testGameConfig({
        difficulty: Difficulty.Hard,
        disabledUnits: disablePosts ? [UnitType.DefensePost] : [],
        disableAlliances: true,
      }),
      false,
    ),
  );
  const own = game.addPlayer(
    new PlayerInfo("Crew", PlayerType.Nation, "crew0001", "crew"),
  );
  const plains = game.addPlayer(
    new PlayerInfo("Plains", PlayerType.Nation, null, "plains"),
  );
  const mountains = game.addPlayer(
    new PlayerInfo("Mountains", PlayerType.Nation, null, "mountains"),
  );
  const fronts = { plains: [] as number[], mountains: [] as number[] };
  game.forEachTile((t) => {
    const x = game.x(t);
    (x < 80 ? plains : x < 160 ? own : mountains).conquer(t);
    if (x === 79) fronts.plains.push(t);
    if (x === 160) fronts.mountains.push(t);
  });
  own.addTroops(game.config().maxTroops(own) * 0.9);
  for (const p of [plains, mountains])
    p.addTroops(game.config().maxTroops(p) * 0.25);
  game.endSpawnPhase();
  return { game, own, plains, mountains, fronts };
}

test("actual terrain losses favor a plains front over an otherwise equal mountain front", () => {
  const { game, own, plains, mountains, fronts } = fixture();
  const budget = crewAttackBudget(game, own);
  const a = crewLandAttackScore(game, own, plains, fronts.plains, budget)!;
  const b = crewLandAttackScore(
    game,
    own,
    mountains,
    fronts.mountains,
    budget,
  )!;
  expect(a).toBeGreaterThan(b);
});

test("actual Defense Post coverage lowers attack value", () => {
  const { game, own, plains, fronts } = fixture(false);
  const budget = crewAttackBudget(game, own);
  const before = crewLandAttackScore(game, own, plains, fronts.plains, budget)!;
  // Direct unit placement is fixture preparation, not an AI free-building path.
  plains
    .buildUnit(UnitType.DefensePost, game.ref(75, 90), {})
    .setUnderConstruction(false);
  const after = crewLandAttackScore(game, own, plains, fronts.plains, budget);
  expect(after === null || after < before).toBe(true);
});

test("the actual AI selects the better frontier and keeps defenders", () => {
  const { game, own, plains } = fixture();
  const before = own.troops();
  const random = new PseudoRandom(42);
  const emoji = new NationEmojiBehavior(random, game, own);
  const alliance = new NationAllianceBehavior(random, game, own, emoji);
  const behavior = new AiAttackBehavior(
    random,
    game,
    own,
    0.55,
    0.35,
    0.15,
    alliance,
    emoji,
  );
  behavior.maybeAttack();
  game.executeNextTick();
  expect(own.outgoingAttacks().some((a) => a.target() === plains)).toBe(true);
  expect(own.troops()).toBeLessThan(before);
  expect(own.troops()).toBeGreaterThanOrEqual(
    game.config().maxTroops(own) * 0.35,
  );
});

test("an exhausted enemy fighting another faction becomes a better opportunity", () => {
  const { game, own, plains, mountains, fronts } = fixture();
  const budget = crewAttackBudget(game, own);
  const before = crewLandAttackScore(game, own, plains, fronts.plains, budget)!;
  mountains.createAttack(plains, plains.troops(), null, new Set(fronts.plains));
  expect(
    crewLandAttackScore(game, own, plains, fronts.plains, budget)!,
  ).toBeGreaterThan(before);
});

test("small probes from a strong army are held, while serious invasions get a response", () => {
  const { own, plains, fronts } = fixture();
  plains.addTroops(own.troops());
  const probe = plains.createAttack(
    own,
    own.troops() * 0.1,
    null,
    new Set(fronts.plains),
  );
  expect(shouldCrewCounterattack(own, plains)).toBe(false);
  probe.setTroops(own.troops() * 0.5);
  expect(shouldCrewCounterattack(own, plains)).toBe(true);
});

test("landlocked Crew bots invest in a first factory after one city", () => {
  const { game, own } = fixture();
  own.removeTroops(own.troops());
  const behavior = new NationStructureBehavior(new PseudoRandom(42), game, own);
  own.addGold(game.unitInfo(UnitType.City).cost(game, own));
  expect(behavior.handleStructures()).toBe(true);
  for (let i = 0; i < 80; i++) game.executeNextTick();
  own.addGold(game.unitInfo(UnitType.Factory).cost(game, own));
  expect(behavior.handleStructures()).toBe(true);
  for (let i = 0; i < 80; i++) game.executeNextTick();
  expect(own.unitsOwned(UnitType.Factory)).toBe(1);
  expect(own.unitsOwned(UnitType.City)).toBe(1);
  expect(own.gold()).toBe(0n);
});

test("an actual rival silo prompts missile protection before the old four-city threshold", () => {
  const { game, own, plains } = fixture();
  own.removeTroops(own.troops());
  own
    .buildUnit(UnitType.City, game.ref(110, 90), {})
    .setUnderConstruction(false);
  plains
    .buildUnit(UnitType.MissileSilo, game.ref(40, 90), {})
    .setUnderConstruction(false);
  own.addGold(game.unitInfo(UnitType.SAMLauncher).cost(game, own));
  const behavior = new NationStructureBehavior(new PseudoRandom(42), game, own);
  expect(behavior.handleStructures()).toBe(true);
  for (let i = 0; i < 100; i++) game.executeNextTick();
  expect(own.unitsOwned(UnitType.SAMLauncher)).toBe(1);
  expect(own.unitsOwned(UnitType.City)).toBe(1);
});

test("strategy policy is limited to Crew nations on Hard or Impossible", () => {
  const { game, own, plains } = fixture();
  expect(usesCrewStrategy(game, own)).toBe(true);
  expect(usesCrewStrategy(game, plains)).toBe(false);
});
