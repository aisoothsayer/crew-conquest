import { afterEach, describe, expect, it, vi } from "vitest";
import { userAuth } from "../../src/client/Auth";
import "../../src/client/SinglePlayerModal";
vi.mock("../../src/client/Auth", () => ({ userAuth: vi.fn() }));
vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    requestMidgameAd: vi.fn(async () => {}),
  },
}));
vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: vi.fn() },
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => {}),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("Crew bot-only simulation", () => {
  it.each([2, 100])(
    "starts %i selected Solo factions with normal resources and the host observing",
    async (count) => {
      vi.stubEnv("CREW_TWITCH_ONLY", "true");
      vi.mocked(userAuth).mockResolvedValue({
        jwt: "fixture",
        claims: { role: "crew-host" },
      } as any);
      const modal: any = document.createElement("single-player-modal");
      modal.crewBotSimulation = true;
      modal.crewManualBots = true;
      modal.crewPlacements = [
        {
          clientID: "bot00001",
          username: "Bot One",
          botSpawn: { x: 100, y: 100 },
        },
        {
          clientID: "bot00002",
          username: "Bot Two",
          botSpawn: { x: 200, y: 200 },
        },
      ];
      if (count === 100)
        modal.crewPlacements = Array.from({ length: count }, (_, i) => ({
          clientID: `solo${i.toString().padStart(4, "0")}`,
          username: `Bot ${i + 1}`,
          botSpawn: { x: 100 + i * 40, y: 100 },
        }));
      const events: any[] = [];
      modal.addEventListener("join-lobby", (e: Event) =>
        events.push((e as CustomEvent).detail),
      );
      await modal.startGame();
      expect(events[0].spectator).toBe(true);
      expect(events[0].gameStartInfo.players).toHaveLength(count);
      expect(
        new Set(events[0].gameStartInfo.players.map((p: any) => p.clientID))
          .size,
      ).toBe(count);
      expect(events[0].gameStartInfo.config.startingGold).toBeUndefined();
      expect(events[0].gameStartInfo.config.goldMultiplier).toBeUndefined();
      expect(events[0].gameStartInfo.config.instantBuild).toBe(false);
      expect(
        events[0].gameStartInfo.players.every((p: any) => p.botSpawn),
      ).toBe(true);
      expect(events[0].gameStartInfo.config).toMatchObject({
        bots: 0,
        nations: "disabled",
        randomSpawn: false,
      });
    },
  );
  it("starts an observer with no human player slots and preserves bot count", async () => {
    vi.stubEnv("CREW_TWITCH_ONLY", "true");
    vi.mocked(userAuth).mockResolvedValue({
      jwt: "fixture",
      claims: { role: "crew-host" },
    } as any);
    const modal: any = document.createElement("single-player-modal");
    modal.crewBotSimulation = true;
    modal.bots = 12;
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );
    await modal.startGame();
    expect(events).toHaveLength(1);
    expect(events[0].spectator).toBe(true);
    expect(events[0].gameStartInfo.players).toEqual([]);
    expect(events[0].gameStartInfo.config.bots).toBe(12);
  });
  it("does not launch a host simulation for a viewer", async () => {
    vi.stubEnv("CREW_TWITCH_ONLY", "true");
    vi.mocked(userAuth).mockResolvedValue({
      jwt: "fixture",
      claims: { role: "crew-viewer" },
    } as any);
    const modal: any = document.createElement("single-player-modal");
    modal.crewBotSimulation = true;
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );
    await modal.startGame();
    expect(events).toHaveLength(0);
  });
});
