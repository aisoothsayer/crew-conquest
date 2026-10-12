import { Difficulty } from "@openfront/engine-api/game/GameTypes";
import { LobbyInfoEvent } from "@openfront/shared/WireSchemas";
import { render } from "lit";
import { afterEach, expect, test, vi } from "vitest";
import { HostLobbyModal } from "../../src/client/HostLobbyModal";
import { SinglePlayerModal } from "../../src/client/SinglePlayerModal";

vi.mock("../../src/client/Utils", async (original) => ({
  ...(await original<typeof import("../../src/client/Utils")>()),
  translateText: (key: string) => key,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function body(modal: any) {
  const container = document.createElement("div");
  render(modal.renderBody(), container);
  return container;
}
function clickNamed(container: HTMLElement, text: string) {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((b) => b.textContent?.trim() === text);
  expect(button).toBeDefined();
  button!.click();
}

test("viewer simulation exposes Hard by default, accepts another level and restores active difficulty", () => {
  vi.stubEnv("CREW_TWITCH_ONLY", "true");
  const modal: any = new HostLobbyModal();
  modal.selectedDifficulty = Difficulty.Easy;
  const send = vi.spyOn(modal, "putGameConfig").mockResolvedValue(undefined);
  clickNamed(body(modal), "crew.viewer_bot_mode");
  const select = body(modal).querySelector<HTMLSelectElement>(
    'select[aria-label="crew.bot_difficulty"]',
  )!;
  expect(select.value).toBe(Difficulty.Hard);
  expect(select.options.length).toBe(4);
  select.value = Difficulty.Medium;
  select.dispatchEvent(new Event("change"));
  expect(
    body(modal).querySelector<HTMLSelectElement>(
      'select[aria-label="crew.bot_difficulty"]',
    )?.value,
  ).toBe(Difficulty.Medium);
  clickNamed(body(modal), "crew.active_mode");
  expect(modal.selectedDifficulty).toBe(Difficulty.Easy);
  expect(send).toHaveBeenCalledTimes(3);
});

test("solo observer defaults to the Hard baseline and restores the practice setting", () => {
  vi.stubEnv("CREW_TWITCH_ONLY", "true");
  const modal: any = new SinglePlayerModal();
  modal.selectedDifficulty = Difficulty.Medium;
  const check = body(modal).querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  check.checked = true;
  check.dispatchEvent(new Event("change"));
  expect(modal.selectedDifficulty).toBe(Difficulty.Hard);
  const off = body(modal).querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  off.checked = false;
  off.dispatchEvent(new Event("change"));
  expect(modal.selectedDifficulty).toBe(Difficulty.Medium);
});

test("returning to an existing bot lobby preserves its selected difficulty", () => {
  vi.stubEnv("CREW_TWITCH_ONLY", "true");
  const modal: any = new HostLobbyModal();
  modal.lobbyId = "return01";
  modal.handleLobbyInfo(
    new LobbyInfoEvent(
      {
        gameID: "return01",
        gameConfig: {
          crewMode: "viewer-bots",
          difficulty: Difficulty.Hard,
          gameMap: "World",
          gameMapSize: "Compact",
        },
        clients: [],
      } as any,
      "host0001",
    ),
  );
  expect(
    body(modal).querySelector<HTMLSelectElement>(
      'select[aria-label="crew.bot_difficulty"]',
    )?.value,
  ).toBe(Difficulty.Hard);
});
