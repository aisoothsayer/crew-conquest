import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
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
function fixture() {
  const game = makeGame({
    creatorPersistentID: "host",
    config: {
      crewMode: "active",
      gameMap: GameMapType.CrewShip,
      gameMapSize: GameMapSize.Compact,
    },
  });
  const host = makeClient({ persistentID: "host" }),
    viewer = makeClient({ persistentID: "viewer" });
  host.twitch = { id: "1", login: "host", displayName: "Host", avatar: "" };
  viewer.twitch = {
    id: "2",
    login: "viewer",
    displayName: "Viewer",
    avatar: "",
  };
  game.joinClient(host);
  game.joinClient(viewer);
  host.botSpawn = { x: 300, y: 240 };
  viewer.botSpawn = { x: 170, y: 140 };
  return { game, host, viewer };
}

test("Danny starts alone after placing his point; entry closes immediately", () => {
  const game = makeGame({
    creatorPersistentID: "host",
    config: { crewMode: "active" },
  });
  const host = makeClient({ persistentID: "host" });
  game.joinClient(host);
  expect(game.crewEntryInfo()?.canJoin).toBe(true);
  host.botSpawn = { x: 300, y: 240 };
  expect(
    game.handleIntent(
      { type: "toggle_game_start_timer" },
      {
        clientID: host.clientID,
        isLobbyCreator: true,
        isAdmin: false,
        isAdminBot: false,
      },
    ).status,
  ).toBe(200);
  expect(game.crewEntryInfo()?.canJoin).toBe(false);
  game.prestart();
  game.start();
  expect(game.hasStarted()).toBe(true);
  const start = mockWsOf(host)
    .sent()
    .find((m) => m.type === "start") as any;
  expect(start.gameStartInfo.players).toHaveLength(1);
  expect(start.gameStartInfo.players[0].initialSpawn).toEqual(host.botSpawn);
});

test("Bot Free-for-All opens clean and can start with one selected bot, never unplaced factions", () => {
  const game = makeGame({
    creatorPersistentID: "host",
    config: {
      crewMode: "viewer-bots",
      crewPlacementOpen: true,
      bots: 400,
      nations: "default",
    },
  });
  const host = makeClient({ persistentID: "host" });
  game.joinClient(host);
  const actor = {
    clientID: host.clientID,
    isLobbyCreator: true,
    isAdmin: false,
    isAdminBot: false,
  };
  expect(game.gameInfo().gameConfig?.crewPlacementOpen).toBe(true);
  expect(
    game.handleIntent({ type: "toggle_game_start_timer" }, actor).status,
  ).toBe(409);
  host.botSpawn = { x: 300, y: 240 };
  expect(
    game.handleIntent({ type: "toggle_game_start_timer" }, actor).status,
  ).toBe(200);
  game.prestart();
  game.start();
  const start = mockWsOf(host)
    .sent()
    .find((m) => m.type === "start") as any;
  expect(start.gameStartInfo.players).toHaveLength(1);
  expect(start.gameStartInfo.config.bots).toBe(0);
  expect(start.gameStartInfo.config.nations).toBe("disabled");
  expect(start.myClientID).toBeUndefined();
});
test("Start locks new seats during countdown and live play, preserves reconnects and keeps humans human", () => {
  const { game, host, viewer } = fixture();
  const outcome = game.handleIntent(
    { type: "toggle_game_start_timer" },
    {
      clientID: host.clientID,
      isLobbyCreator: true,
      isAdmin: false,
      isAdminBot: false,
    },
  );
  expect(outcome.status).toBe(200);
  expect(game.joinClient(makeClient({ persistentID: "late" }))).toBe("started");
  expect(game.rejoinClient(makeClient().ws, viewer.persistentID)).toBe(true);
  game.prestart();
  game.start();
  const message = mockWsOf(host)
    .sent()
    .find((m) => m.type === "start") as any;
  expect(
    message.gameStartInfo.players.every(
      (p: any) => p.initialSpawn && !p.botSpawn,
    ),
  ).toBe(true);
  expect(
    game.joinClient(makeClient({ persistentID: "another", spectator: true })),
  ).toBe("started");
  expect(game.rejoinClient(makeClient().ws, viewer.persistentID)).toBe(true);
});
test("a host can sit out while two viewers play, and the OBS client receives no faction", () => {
  const { game, host, viewer } = fixture();
  host.spectator = true;
  const second = makeClient({ persistentID: "viewer2" });
  second.botSpawn = { x: 220, y: 220 };
  game.joinClient(second);
  game.prestart();
  game.start();
  const observer = makeClient({ persistentID: "obs", role: "crew-observer" });
  expect(game.joinClient(observer)).toBe("joined");
  expect(observer.spectator).toBe(true);
  const start = mockWsOf(host)
    .sent()
    .find((m) => m.type === "start") as any;
  expect(start.isLobbyHost).toBe(true);
  expect(start.myClientID).toBeUndefined();
  expect(start.gameStartInfo.players.map((p: any) => p.clientID)).toEqual([
    viewer.clientID,
    second.clientID,
  ]);
});
test("Start refuses an unplaced human and OBS cannot send game or host actions", async () => {
  const { game, host, viewer } = fixture();
  viewer.botSpawn = undefined;
  expect(
    game.handleIntent(
      { type: "toggle_game_start_timer" },
      {
        clientID: host.clientID,
        isLobbyCreator: true,
        isAdmin: false,
        isAdminBot: false,
      },
    ).status,
  ).toBe(409);
  viewer.botSpawn = { x: 170, y: 140 };
  game.prestart();
  game.start();
  const observer = makeClient({ persistentID: "obs", role: "crew-observer" });
  game.joinClient(observer);
  await mockWsOf(observer).emit({
    type: "crew_bot_place",
    position: { x: 5, y: 5 },
  });
  await mockWsOf(observer).emit({ type: "spectate", spectator: false });
  expect(observer.spectator).toBe(true);
  expect(observer.botSpawn).toBeUndefined();
  expect(
    game.handleIntent(
      { type: "toggle_pause", paused: true },
      {
        clientID: observer.clientID,
        isLobbyCreator: false,
        isAdmin: false,
        isAdminBot: false,
      },
    ).status,
  ).toBe(403);
});

test("the selected roster survives a countdown disconnect and configuration stays locked", async () => {
  const { game, host, viewer } = fixture();
  const actor = {
    clientID: host.clientID,
    isLobbyCreator: true,
    isAdmin: false,
    isAdminBot: false,
  };
  expect(
    game.handleIntent({ type: "toggle_game_start_timer" }, actor).status,
  ).toBe(200);
  expect(
    game.handleIntent(
      { type: "update_game_config", config: { bots: 0 } },
      actor,
    ).status,
  ).toBe(409);
  await mockWsOf(viewer).trigger("close");
  game.prestart();
  game.start();
  const start = mockWsOf(host)
    .sent()
    .find((m) => m.type === "start") as any;
  expect(start.gameStartInfo.players.map((p: any) => p.clientID)).toEqual([
    host.clientID,
    viewer.clientID,
  ]);
  expect(game.rejoinClient(makeClient().ws, viewer.persistentID)).toBe(true);
});
