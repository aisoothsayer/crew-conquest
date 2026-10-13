import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { makeClient, makeGame, mockWsOf } from "../util/GameServerHarness";
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CREW_TWITCH_ONLY", "true");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
function fixture(mode: "active" | "viewer-bots" = "active") {
  const game = makeGame({
    creatorPersistentID: "host",
    config: { crewMode: mode, crewPlacementOpen: true, startDelay: 3 },
  });
  const viewer = makeClient({ persistentID: "viewer" });
  game.joinClient(viewer);
  return { game, viewer };
}
test("remote host starts placed viewers without adding a host faction and retries cannot cancel", () => {
  const { game, viewer } = fixture();
  expect(game.beginCrewRound("viewer").status).toBe(403);
  expect(game.beginCrewRound("host").status).toBe(409);
  viewer.botSpawn = { x: 300, y: 240 };
  expect(game.crewControlInfo()?.canStart).toBe(true);
  expect(game.beginCrewRound("host").status).toBe(200);
  const deadline = game.gameInfo().startsAt;
  expect(game.beginCrewRound("host").status).toBe(200);
  expect(game.gameInfo().startsAt).toBe(deadline);
  expect(game.joinClient(makeClient({ persistentID: "late" }))).toBe("started");
  expect(game.crewEntryInfo()?.canJoin).toBe(false);
  game.prestart();
  game.start();
  const message = mockWsOf(viewer)
    .sent()
    .find((m) => m.type === "start") as any;
  expect(message.gameStartInfo.players).toHaveLength(1);
  expect(message.gameStartInfo.players[0].clientID).toBe(viewer.clientID);
  expect(game.beginCrewRound("host").status).toBe(200);
});
test("clean bot mode still requires a placed faction and excludes unplaced viewers", () => {
  const { game, viewer } = fixture("viewer-bots");
  game.joinClient(makeClient({ persistentID: "unplaced" }));
  expect(game.beginCrewRound("host").status).toBe(409);
  viewer.botSpawn = { x: 300, y: 240 };
  expect(game.beginCrewRound("host").status).toBe(200);
  expect(game.gameConfig.bots).toBe(0);
  expect(game.gameConfig.nations).toBe("disabled");
  game.prestart();
  game.start();
  const message = mockWsOf(viewer)
    .sent()
    .find((m) => m.type === "start") as any;
  expect(message.gameStartInfo.players).toHaveLength(1);
  expect(message.gameStartInfo.players[0].botSpawn).toEqual(viewer.botSpawn);
});
test("manual end closes clients and remains excluded from winner settlement on later prune", async () => {
  const replay = vi.fn(async () => null),
    archive = vi.fn(async () => {});
  const game = makeGame({
    creatorPersistentID: "host",
    config: { crewMode: "active" },
    deps: { replayWinner: replay, archive },
  });
  const player = makeClient();
  player.botSpawn = { x: 300, y: 240 };
  game.joinClient(player);
  game.prestart();
  game.start();
  await game.end(true);
  await game.end();
  expect(game.hasEnded()).toBe(true);
  expect(mockWsOf(player).close).toHaveBeenCalled();
  expect(replay).not.toHaveBeenCalled();
  expect(archive).not.toHaveBeenCalled();
  expect(game.beginCrewRound("host").status).toBe(409);
});
