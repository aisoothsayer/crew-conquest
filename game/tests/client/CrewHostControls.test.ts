import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, expect, test, vi } from "vitest";
import { GameRightSidebar } from "../../src/client/hud/layers/GameRightSidebar";
import { NewLobbyPrompt } from "../../src/client/hud/layers/NewLobbyPrompt";
import { TogglePauseIntentEvent } from "../../src/client/InputHandler";
import {
  NewLobbyEvent,
  PauseGameIntentEvent,
} from "../../src/client/Transport";
import type { GameView } from "../../src/client/view";

vi.mock("../../src/client/Utils", async (original) => ({
  ...(await original<typeof import("../../src/client/Utils")>()),
  translateText: (key: string) => key,
}));
afterEach(() => {
  document.body.innerHTML = "";
});

function mount(isLobbyHost: boolean, listed = false) {
  const eventBus = new EventBus();
  const game = {
    isLobbyHost,
    config: () => ({
      gameConfig: () => ({
        gameType: GameType.Private,
        crewMode: "viewer-bots",
        maxTimerValue: null,
      }),
      isReplay: () => false,
      listed,
      doomsdayClockConfig: () => undefined,
      overtimeConfig: () => ({ enabled: false, startMinutes: 30 }),
    }),
    myPlayer: () => undefined,
    inSpawnPhase: () => false,
    elapsedGameSeconds: () => 10,
  } as unknown as GameView;
  const sidebar = new GameRightSidebar();
  sidebar.game = game;
  sidebar.eventBus = eventBus;
  document.body.append(sidebar);
  sidebar.init();
  return { game, sidebar, eventBus };
}

test("observer host can pause with the keyboard and sees pause/new lobby controls without a faction", async () => {
  const { sidebar, eventBus } = mount(true);
  const pause = vi.fn();
  eventBus.on(PauseGameIntentEvent, pause);
  await sidebar.updateComplete;
  expect(sidebar.querySelector('img[alt="play/pause"]')).not.toBeNull();
  expect(
    sidebar.querySelector('img[alt="win_modal.new_lobby"]'),
  ).not.toBeNull();
  eventBus.emit(new TogglePauseIntentEvent());
  expect(pause).toHaveBeenCalledOnce();
  expect(pause.mock.calls[0][0]).toEqual(new PauseGameIntentEvent(true));
});

test("observer viewer cannot pause or start a new lobby", async () => {
  const { sidebar, eventBus } = mount(false);
  const pause = vi.fn();
  eventBus.on(PauseGameIntentEvent, pause);
  await sidebar.updateComplete;
  expect(sidebar.querySelector('img[alt="play/pause"]')).toBeNull();
  expect(sidebar.querySelector('img[alt="win_modal.new_lobby"]')).toBeNull();
  eventBus.emit(new TogglePauseIntentEvent());
  expect(pause).not.toHaveBeenCalled();
});

test("listed host still cannot pause the match", async () => {
  const { sidebar, eventBus } = mount(true, true);
  const pause = vi.fn();
  eventBus.on(PauseGameIntentEvent, pause);
  await sidebar.updateComplete;
  expect(sidebar.querySelector('img[alt="play/pause"]')).toBeNull();
  eventBus.emit(new TogglePauseIntentEvent());
  expect(pause).not.toHaveBeenCalled();
});

test("observer viewer receives the successor-lobby invitation", async () => {
  const { game, eventBus } = mount(false);
  const prompt = new NewLobbyPrompt();
  prompt.game = game;
  prompt.eventBus = eventBus;
  document.body.append(prompt);
  prompt.init();
  eventBus.emit(new NewLobbyEvent("abcdefgh"));
  await prompt.updateComplete;
  expect(prompt.textContent).toContain("new_lobby_prompt.message");
  expect(
    prompt.querySelector('[translationKey="new_lobby_prompt.join"]'),
  ).not.toBeNull();
});
