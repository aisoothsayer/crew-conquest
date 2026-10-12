import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameType,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import {
  createGameRunner,
  createGameRunnerFromSnapshot,
} from "@openfront/engine/GameRunner";
import fs from "node:fs";
import path from "node:path";
import { testGameConfig } from "../util/Wire";
function files() {
  const dir = path.resolve("resources/maps/crewship");
  return {
    map: GameMapType.CrewShip,
    mapSize: GameMapSize.Compact,
    manifest: JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    ),
    map4xBin: new Uint8Array(fs.readFileSync(path.join(dir, "map4x.bin"))),
    map16xBin: new Uint8Array(fs.readFileSync(path.join(dir, "map16x.bin"))),
  };
}
function start() {
  const seeds = files().manifest.nations.slice(0, 2);
  return {
    gameID: "crewBot1",
    lobbyCreatedAt: 1,
    config: testGameConfig({
      difficulty: Difficulty.Hard,
      gameMap: GameMapType.CrewShip,
      gameMapSize: GameMapSize.Compact,
      gameType: GameType.Singleplayer,
      bots: 0,
      nations: "disabled",
      randomSpawn: false,
    }),
    players: seeds.map((n: any, i: number) => ({
      clientID: `viewer0${i}`,
      username: `Viewer${i}`,
      clanTag: null,
      botSpawn: {
        x: Math.floor(n.coordinates[0] / 2),
        y: Math.floor(n.coordinates[1] / 2),
      },
    })),
  };
}
test("placed bots stay at exact selected points, grow autonomously and replay deterministically", async () => {
  const info = start();
  const a = await createGameRunner(info, undefined, files(), () => {}),
    b = await createGameRunner(info, undefined, files(), () => {});
  const limit = a.game.config().numSpawnPhaseTurns();
  for (let t = 0; t < limit + 1900; t++)
    for (const r of [a, b]) {
      r.addTurn({ turnNumber: t, intents: [] });
      expect(r.executeNextTick()).toBe(true);
    }
  expect(a.game.inSpawnPhase()).toBe(false);
  expect(a.game.allPlayers().some((p) => p.type() === PlayerType.Human)).toBe(
    false,
  );
  const state = (r: typeof a) =>
    r.game.allPlayers().map((p) => ({
      name: p.name(),
      spawn: p.spawnTile(),
      tiles: p.numTilesOwned(),
      troops: p.troops(),
      structures: p
        .units()
        .map((u) => ({ type: u.type(), tile: u.tile(), level: u.level() })),
    }));
  expect(state(a)).toEqual(state(b));
  for (const bot of info.players) {
    const p = a.game.playerByClientID(bot.clientID)!;
    expect(p.spawnTile()).toBe(a.game.ref(bot.botSpawn.x, bot.botSpawn.y));
    expect(p.numTilesOwned()).toBeGreaterThan(10);
  }
  const restored = await createGameRunnerFromSnapshot(
    info,
    a.snapshot(),
    undefined,
    files(),
    () => {},
  );
  expect(state(restored)).toEqual(state(a));
  for (let t = limit + 1900; t < limit + 2200; t++) {
    for (const r of [a, restored]) {
      r.addTurn({ turnNumber: t, intents: [] });
      expect(r.executeNextTick()).toBe(true);
    }
  }
  expect(state(restored)).toEqual(state(a));
});
test("malformed bot placements fail rather than silently spawning somewhere else", async () => {
  const info = start();
  info.players[0].botSpawn = { x: 0, y: 0 };
  await expect(
    createGameRunner(info, undefined, files(), () => {}),
  ).rejects.toThrow("Invalid placed bot spawn");
});
