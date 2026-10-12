import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import {
  decodeClientMessage,
  encodeClientMessage,
} from "@openfront/shared/ZbinWire";
import fs from "node:fs";
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
      gameMap: GameMapType.CrewShip,
      gameMapSize: GameMapSize.Compact,
      crewMode: "viewer-bots",
      crewPlacementOpen: true,
    },
  });
  const host = makeClient({ persistentID: "host", username: "DannyHost" }),
    viewer = makeClient({ username: "ViewerOne" });
  host.twitch = {
    id: "1",
    login: "dannyhost",
    displayName: "DannyHost",
    avatar: "",
  };
  viewer.twitch = {
    id: "2",
    login: "viewerone",
    displayName: "ViewerOne",
    avatar: "",
  };
  game.joinClient(host);
  game.joinClient(viewer);
  game.updateGameConfig({ crewMode: "viewer-bots", crewPlacementOpen: true });
  const m = JSON.parse(
    fs.readFileSync("resources/maps/crewship/manifest.json", "utf8"),
  );
  const points = m.nations.slice(0, 3).map((n: any) => ({
    x: Math.floor(n.coordinates[0] / 2),
    y: Math.floor(n.coordinates[1] / 2),
  }));
  return { game, host, viewer, points };
}
test("host opens placement; each verified account gets one movable bot; start locks positions and produces observers", async () => {
  const { game, host, viewer, points } = fixture();
  expect((await game.placeCrewBot(host.clientID, points[0])).status).toBe(200);
  expect((await game.placeCrewBot(viewer.clientID, points[1])).status).toBe(
    200,
  );
  expect((await game.placeCrewBot(viewer.clientID, points[2])).status).toBe(
    200,
  );
  expect(game.gameInfo().clients?.filter((c) => c.botSpawn)).toHaveLength(2);
  game.prestart();
  game.start();
  expect((await game.placeCrewBot(viewer.clientID, points[1])).status).toBe(
    403,
  );
  const start = mockWsOf(host)
    .sent()
    .find((m: any) => m.type === "start") as any;
  expect(start.myClientID).toBeUndefined();
  expect(start.isLobbyHost).toBe(true);
  const viewerStart = mockWsOf(viewer)
    .sent()
    .find((m: any) => m.type === "start") as any;
  expect(viewerStart.isLobbyHost).toBe(false);
  expect(viewerStart.myClientID).toBeUndefined();
  expect(start.gameStartInfo.players.map((p: any) => p.username)).toEqual([
    "DannyHost",
    "ViewerOne",
  ]);
  expect(
    start.gameStartInfo.players.every((p: any) => p.botSpawn && p.twitch),
  ).toBe(true);
  expect(start.gameStartInfo.config.bots).toBe(0);
  expect(start.gameStartInfo.config.nations).toBe("disabled");
  const actor = (clientID: string, isLobbyCreator: boolean) => ({
    clientID,
    isLobbyCreator,
    isAdmin: false,
    isAdminBot: false,
  });
  expect(
    game.handleIntent(
      { type: "toggle_pause", paused: true },
      actor(viewer.clientID, false),
    ).status,
  ).toBe(403);
  expect(game.isPaused()).toBe(false);
  expect(
    game.handleIntent(
      { type: "toggle_pause", paused: true },
      actor(host.clientID, true),
    ).status,
  ).toBe(200);
  expect(game.isPaused()).toBe(true);
  expect(
    game.handleIntent(
      { type: "toggle_pause", paused: false },
      actor(host.clientID, true),
    ).status,
  ).toBe(200);
  expect(game.isPaused()).toBe(false);
  expect(
    game.handleIntent(
      { type: "spawn", tile: 0 },
      {
        clientID: viewer.clientID,
        isLobbyCreator: false,
        isAdmin: false,
        isAdminBot: false,
      },
    ).status,
  ).toBe(403);
});
test("closed placement, water, overlaps, spectators, kicked accounts and non-host activation are rejected", async () => {
  const { game, host, viewer, points } = fixture();
  game.updateGameConfig({ crewPlacementOpen: false });
  expect((await game.placeCrewBot(viewer.clientID, points[0])).status).toBe(
    403,
  );
  expect(
    game.handleIntent(
      { type: "update_game_config", config: { crewPlacementOpen: true } },
      {
        clientID: viewer.clientID,
        isLobbyCreator: false,
        isAdmin: false,
        isAdminBot: false,
      },
    ).status,
  ).toBe(403);
  game.updateGameConfig({ crewPlacementOpen: true });
  expect(
    (await game.placeCrewBot(viewer.clientID, { x: 0, y: 0 })).status,
  ).toBe(400);
  expect((await game.placeCrewBot(host.clientID, points[0])).status).toBe(200);
  expect((await game.placeCrewBot(viewer.clientID, points[0])).status).toBe(
    400,
  );
  viewer.spectator = true;
  expect((await game.placeCrewBot(viewer.clientID, points[1])).status).toBe(
    403,
  );
  viewer.spectator = false;
  game.kickClient(viewer.clientID);
  expect((await game.placeCrewBot(viewer.clientID, points[1])).status).toBe(
    403,
  );
});
test("map changes clear old coordinates and placement message round-trips through actual binary wire", async () => {
  const { game, host, points } = fixture();
  await game.placeCrewBot(host.clientID, points[0]);
  const frame = { type: "crew_bot_place" as const, position: points[1] };
  expect(
    decodeClientMessage(encodeClientMessage(frame, undefined), undefined),
  ).toEqual(frame);
  game.updateGameConfig({ gameMapSize: GameMapSize.Normal });
  expect(host.botSpawn).toBeUndefined();
  expect(game.gameInfo().gameConfig?.crewPlacementOpen).toBe(false);
});
test("multiple sockets cannot create multiple bots for the same Twitch account", async () => {
  const { game, host, viewer, points } = fixture();
  viewer.twitch = host.twitch;
  await game.placeCrewBot(host.clientID, points[0]);
  await game.placeCrewBot(viewer.clientID, points[1]);
  expect(game.gameInfo().clients?.filter((c) => c.botSpawn)).toHaveLength(1);
});
test("a placement request begun before closing cannot land after the phase is reopened", async () => {
  const { game, host, points } = fixture();
  const pending = game.placeCrewBot(host.clientID, points[0]);
  game.updateGameConfig({ crewPlacementOpen: false });
  game.updateGameConfig({ crewPlacementOpen: true });
  expect((await pending).status).toBe(409);
  expect(host.botSpawn).toBeUndefined();
});
