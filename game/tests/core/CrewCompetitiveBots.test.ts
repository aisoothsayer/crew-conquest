import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { createGameRunner } from "@openfront/engine/GameRunner";
import fs from "node:fs";
import path from "node:path";
import { testGameConfig } from "../util/Wire";

test("funded placed observer bots autonomously build infrastructure and wage nuclear war", async () => {
  const dir = path.resolve("resources/maps/crewship");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
  );
  const players = manifest.nations.slice(0, 4).map((n: any, i: number) => ({
    clientID: `fighter${i}`,
    username: `Bot ${i}`,
    clanTag: null,
    botSpawn: {
      x: Math.floor(n.coordinates[0] / 2),
      y: Math.floor(n.coordinates[1] / 2),
    },
  }));
  const info = {
    gameID: "fight001",
    lobbyCreatedAt: 1,
    players,
    config: testGameConfig({
      gameType: GameType.Singleplayer,
      gameMap: GameMapType.CrewShip,
      gameMapSize: GameMapSize.Compact,
      crewMode: "viewer-bots",
      difficulty: Difficulty.Impossible,
      nations: "disabled",
      bots: 0,
      startingGold: 30_000_000,
    }),
  };
  const runner = await createGameRunner(
    info,
    undefined,
    {
      map: GameMapType.CrewShip,
      mapSize: GameMapSize.Compact,
      manifest,
      map4xBin: new Uint8Array(fs.readFileSync(path.join(dir, "map4x.bin"))),
      map16xBin: new Uint8Array(fs.readFileSync(path.join(dir, "map16x.bin"))),
    },
    () => {},
  );
  const types = [
    UnitType.City,
    UnitType.Port,
    UnitType.Factory,
    UnitType.MissileSilo,
    UnitType.SAMLauncher,
    UnitType.Warship,
    UnitType.AtomBomb,
    UnitType.HydrogenBomb,
    UnitType.MIRV,
  ];
  for (let t = 0; t < 6000; t++) {
    runner.addTurn({ turnNumber: t, intents: [] });
    expect(runner.executeNextTick()).toBe(true);
  }
  const counts = Object.fromEntries(
    types.map((type) => [
      type,
      runner.game
        .allPlayers()
        .reduce((sum, p) => sum + p.unitsConstructed(type), 0),
    ]),
  );
  console.log("Funded observer AI evidence:", JSON.stringify(counts));
  expect(counts[UnitType.City]).toBeGreaterThan(4);
  expect(counts[UnitType.Port]).toBeGreaterThan(0);
  expect(counts[UnitType.MissileSilo]).toBeGreaterThan(0);
  expect(counts[UnitType.Warship]).toBeGreaterThan(0);
  expect(
    counts[UnitType.AtomBomb] +
      counts[UnitType.HydrogenBomb] +
      counts[UnitType.MIRV],
  ).toBeGreaterThan(0);
}, 180_000);
