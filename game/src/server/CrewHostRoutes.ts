import { Difficulty, GameMapType } from "@openfront/engine-api/game/GameTypes";
import type { Express } from "express";
import { z } from "zod";
import type { GameManager } from "./GameManager";
import { verifyClientToken } from "./jwt";
import { ServerEnv } from "./ServerEnv";

const command = z
  .object({
    action: z.enum(["open", "start", "end"]),
    roomId: z
      .string()
      .regex(/^[A-Za-z0-9]{8,10}$/)
      .nullable(),
    mode: z.enum(["active", "viewer-bots"]).optional(),
  })
  .strict();

export function registerCrewHostRoutes(
  app: Express,
  gm: GameManager,
  workerId: number,
) {
  app.use("/api/crew-host", async (req, res, next) => {
    if (process.env.CREW_TWITCH_ONLY !== "true") {
      res.status(404).end();
      return;
    }
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in to Crew." });
      return;
    }
    const auth = await verifyClientToken(token);
    if (auth.type !== "success") {
      res.status(401).json({ error: "Crew sign-in expired." });
      return;
    }
    if (
      auth.claims?.provider !== "twitch" ||
      auth.claims.role !== "crew-host"
    ) {
      res.status(403).json({ error: "Only Danny can control Crew." });
      return;
    }
    res.locals.crewOwner = auth.persistentId;
    next();
  });
  function current(owner: string) {
    const entry = gm.currentCrewRoom();
    const game = entry ? gm.game(entry.gameID) : null;
    return game?.isCreator(owner) ? game : null;
  }
  function status(owner: string) {
    const room = current(owner)?.crewControlInfo();
    return {
      room: room
        ? { ...room, lobbyPath: `/w${workerId}/game/${room.id}?lobby` }
        : null,
    };
  }
  app.get("/api/crew-host/status", (_req, res) =>
    res.json(status(res.locals.crewOwner)),
  );
  app.post("/api/crew-host/control", async (req, res) => {
    const parsed = command.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid Crew command." });
      return;
    }
    const { action, roomId, mode } = parsed.data;
    const owner: string = res.locals.crewOwner;
    let game = current(owner);
    if (action === "open") {
      // Existing-room reuse makes retries safe; never replace a live room.
      if (roomId !== null && game?.id !== roomId) {
        res.status(409).json({ error: "Room changed. Refresh its status." });
        return;
      }
      if (!game) {
        const id = ServerEnv.generateGameIdForWorker(workerId);
        if (!id) {
          res.status(503).json({ error: "Room allocation failed." });
          return;
        }
        game = gm.createGame(
          id,
          {
            gameMap: GameMapType.UnitedStates,
            crewMode: mode ?? "active",
            crewPlacementOpen: true,
            anonymizeNames: false,
            startDelay: 3,
            ...(mode === "viewer-bots"
              ? { bots: 0, nations: "disabled", difficulty: Difficulty.Hard }
              : {}),
          },
          owner,
        );
        if (!game) {
          res.status(409).json({ error: "Room allocation conflict." });
          return;
        }
      }
    } else {
      if (!roomId || !game || game.id !== roomId) {
        res
          .status(409)
          .json({ error: "Room changed or closed. Refresh its status." });
        return;
      }
      if (action === "start") {
        const result = game.beginCrewRound(owner);
        if (result.status !== 200) {
          res.status(result.status).json({ error: result.error });
          return;
        }
      } else {
        await game.end(true);
      }
    }
    res.json(status(owner));
  });
}
