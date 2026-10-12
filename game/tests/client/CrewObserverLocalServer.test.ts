import { EventBus } from "@openfront/shared/EventBus";
import type { ServerMessage } from "@openfront/shared/WireSchemas";
import { afterEach, expect, it, vi } from "vitest";
import { LocalServer } from "../../src/client/LocalServer";
vi.mock("src/client/ClientEnv", () => ({
  ClientEnv: { turnIntervalMs: () => 100 },
}));
vi.mock("../../src/client/SingleplayerHeartbeat", () => ({
  startSingleplayerHeartbeat: () => {
    throw new Error("Crew mode must not call the upstream heartbeat");
  },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("starts a zero-human observer, runs turns, pauses, resumes, and exits without upstream archives", () => {
  vi.stubEnv("CREW_TWITCH_ONLY", "true");
  vi.useFakeTimers();
  const messages: ServerMessage[] = [];
  const server = new LocalServer(
    {
      gameID: "abcdefgh",
      spectator: true,
      playerName: "Danny",
      playerClanTag: null,
      gameStartInfo: {
        gameID: "abcdefgh",
        lobbyCreatedAt: 0,
        config: {},
        players: [],
      },
    } as any,
    false,
    new EventBus(),
  );
  server.updateCallback(
    () => {},
    (message) => {
      messages.push(message);
      if (message.type === "turn") server.turnComplete();
    },
  );
  expect(() => server.start()).not.toThrow();
  const start = messages.find((m) => m.type === "start");
  expect(start?.type).toBe("start");
  if (start?.type === "start") {
    expect(start.gameStartInfo.players).toEqual([]);
    expect(start.myClientID).toBeUndefined();
  }
  vi.advanceTimersByTime(110);
  expect(messages.some((m) => m.type === "turn")).toBe(true);
  server.onMessage({
    type: "intent",
    intent: { type: "toggle_pause", paused: true },
  });
  const paused = messages.length;
  vi.advanceTimersByTime(500);
  expect(messages.length).toBe(paused);
  server.onMessage({
    type: "intent",
    intent: { type: "toggle_pause", paused: false },
  });
  vi.advanceTimersByTime(110);
  expect(messages.length).toBeGreaterThan(paused);
  expect(() => server.endGame()).not.toThrow();
  const ended = messages.length;
  vi.advanceTimersByTime(500);
  expect(messages.length).toBe(ended);
});
