import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import { afterEach, expect, test, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import "../../src/client/components/CrewInvite";
import "../../src/client/components/CrewMapPlacement";
import "../../src/client/HelpModal";
vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: () => ({ webpPath: "/fixture.webp" }) },
  loadCachedTerrainMap: async () => ({
    gameMap: new GameMapImpl(240, 200, new Uint8Array(48000).fill(0x80), 48000),
  }),
}));
afterEach(() => vi.unstubAllEnvs());
test("a lobby QR and text invitation use the same exact room, and streamer hiding conceals both", async () => {
  vi.spyOn(ClientEnv, "gamePath").mockReturnValue("/w0/game/Abcd1234");
  const invite: any = document.createElement("crew-invite");
  invite.lobbyId = "Abcd1234";
  document.body.append(invite);
  await invite.updateComplete;
  const links = [...invite.querySelectorAll("a")].map((a: any) => a.href);
  expect(new Set(links).size).toBe(1);
  expect(links[0]).toContain("/w0/game/Abcd1234?lobby");
  expect(invite.querySelector("img").src).toMatch(/^data:image\/gif;base64,/);
  invite.hiddenCode = true;
  await invite.updateComplete;
  expect(invite.querySelector("img")).toBeNull();
  expect(invite.textContent).not.toContain("Abcd1234");
});
test("Crew Help retains its manual and terrain help without embedding the video tutorial", async () => {
  vi.stubEnv("CREW_TWITCH_ONLY", "true");
  const help: any = document.createElement("help-modal");
  document.body.append(help);
  help.open();
  await help.updateComplete;
  expect(help.querySelector("#tutorial-video-iframe")).toBeNull();
  expect(help.querySelector("[data-crew-terrain-help]")).not.toBeNull();
});

test("auto-fill honors the edited total immediately rather than filling the default 100", async () => {
  const placement: any = document.createElement("crew-map-placement");
  placement.soloFill = true;
  document.body.append(placement);
  await placement.updateComplete;
  await Promise.resolve();
  await placement.updateComplete;
  const input = placement.querySelector(
    'input[type="number"]',
  ) as HTMLInputElement;
  input.value = "2";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await placement.updateComplete;
  let points: unknown[] = [];
  placement.addEventListener(
    "crew-fill",
    (e: CustomEvent) => (points = e.detail),
  );
  const fill = placement.querySelector("[data-solo-fill]") as HTMLButtonElement;
  await vi.waitFor(() => expect(fill.disabled).toBe(false));
  fill.click();
  expect(points).toHaveLength(2);
});
