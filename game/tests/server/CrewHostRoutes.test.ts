// @vitest-environment node
import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { registerCrewHostRoutes } from "../../src/server/CrewHostRoutes";
import { ServerEnv } from "../../src/server/ServerEnv";
import { makeGame } from "../util/GameServerHarness";

vi.mock("../../src/server/jwt", () => ({
  verifyClientToken: vi.fn(async (token: string) =>
    token === "host"
      ? {
          type: "success",
          persistentId: "host",
          claims: { provider: "twitch", role: "crew-host" },
        }
      : token === "viewer"
        ? {
            type: "success",
            persistentId: "viewer",
            claims: { provider: "twitch", role: "crew-viewer" },
          }
        : { type: "error", message: "Invalid ticket" },
  ),
}));
let server: Server;
beforeEach(() => {
  vi.stubEnv("CREW_TWITCH_ONLY", "true");
  vi.spyOn(ServerEnv, "generateGameIdForWorker").mockReturnValue("Abcd1234");
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function fixture() {
  let game: ReturnType<typeof makeGame> | null = null;
  const gm = {
    currentCrewRoom: () => game?.crewEntryInfo(),
    game: () => game,
    createGame: vi.fn(
      (id, config, owner) =>
        (game = makeGame({ id, config, creatorPersistentID: owner })),
    ),
  };
  const app = express();
  app.use(express.json());
  registerCrewHostRoutes(app, gm as any, 0);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  return {
    gm,
    base,
    async post(
      action: string,
      roomId: string | null = null,
      token = "host",
      extra = {},
    ) {
      return fetch(base + "/api/crew-host/control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer " + token,
        },
        body: JSON.stringify({ action, roomId, mode: "viewer-bots", ...extra }),
      });
    },
  };
}
test("worker denies forged/viewer authority and ignores no caller-supplied owner", async () => {
  const f = await fixture();
  expect((await f.post("open", null, "forged")).status).toBe(401);
  expect((await f.post("open", null, "viewer")).status).toBe(403);
  expect((await f.post("open", null, "host", { owner: "host" })).status).toBe(
    400,
  );
  expect(f.gm.createGame).not.toHaveBeenCalled();
});
test("worker reuses an owned room, rejects stale targets and retains ordinary clean bot mode", async () => {
  const f = await fixture();
  expect((await f.post("open")).status).toBe(200);
  expect((await f.post("open")).status).toBe(200);
  expect(f.gm.createGame).toHaveBeenCalledTimes(1);
  expect(f.gm.game()?.gameConfig.bots).toBe(0);
  expect(f.gm.game()?.gameConfig.nations).toBe("disabled");
  expect((await f.post("start", "Oldroom1")).status).toBe(409);
  expect((await f.post("start", "Abcd1234")).status).toBe(409);
  expect((await f.post("end", "Oldroom1")).status).toBe(409);
  expect((await f.post("end", "Abcd1234")).status).toBe(200);
  expect(f.gm.game()?.hasEnded()).toBe(true);
});
