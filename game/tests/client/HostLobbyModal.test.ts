import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type {
  GameConfig,
  GameConfigPatch,
} from "@openfront/engine-api/Schemas";
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const presenceMocks = vi.hoisted(() => ({
  isAvailable: vi.fn(() => false),
  openInviteDialog: vi.fn(async () => true),
}));

// The desktop bridge is absent in a browser and in jsdom. Mocking the module
// lets each test state which shell it is running in, which is the only thing
// the invite button is gated on.
vi.mock("../../src/client/DesktopPresence", () => ({
  desktopPresence: {
    isAvailable: presenceMocks.isAvailable,
    openInviteDialog: presenceMocks.openInviteDialog,
    set: vi.fn(),
    consumePendingInvite: vi.fn(async () => null),
    subscribeInvites: vi.fn(() => () => undefined),
  },
}));

import { HostLobbyModal } from "../../src/client/HostLobbyModal";

// The host holds the lobby code and decides who joins, so they are the player
// most likely to want this — and they were the one surface the button missed
// when it first shipped, because it lived inline in JoinLobbyModal. The
// gating and wiring are pinned here; whether Steam's dialog actually renders
// needs a packaged build, per OPE-200's acceptance criterion.
describe("HostLobbyModal Steam invite button", () => {
  const INVITE = "[data-test-invite-friends]";
  const COPY = "copy-button";

  function renderHeader(modal: HostLobbyModal): HTMLElement {
    const container = document.createElement("div");
    render(
      (
        modal as unknown as { renderHeaderSlot(): unknown }
      ).renderHeaderSlot() as never,
      container,
    );
    return container;
  }

  function hostModal(): HostLobbyModal {
    const modal = new HostLobbyModal();
    (modal as unknown as { lobbyId: string }).lobbyId = "ABCD1234";
    return modal;
  }

  beforeEach(() => {
    presenceMocks.isAvailable.mockReset().mockReturnValue(false);
    presenceMocks.openInviteDialog.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is absent in a browser, leaving the copy button alone", () => {
    presenceMocks.isAvailable.mockReturnValue(false);
    const header = renderHeader(hostModal());

    expect(header.querySelector(INVITE)).toBeNull();
    expect(header.querySelector(COPY)).not.toBeNull();
    expect(customElements.get("copy-button")).toBeDefined();
  });

  // createLobby() assigns lobbyId asynchronously and this modal renders before
  // it lands. A button live in that window has no shadow lobby behind it, so
  // the invite would silently no-op.
  it("is absent until the lobby id lands, even on the desktop shell", () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    const modal = new HostLobbyModal();

    expect(renderHeader(modal).querySelector(INVITE)).toBeNull();
  });

  it("appears beside the copy button on the desktop shell", () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    const header = renderHeader(hostModal());

    expect(header.querySelector(INVITE)).not.toBeNull();
    expect(header.querySelector(COPY)).not.toBeNull();
  });

  it("opens the Steam invite dialog when clicked", () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    const button =
      renderHeader(hostModal()).querySelector<HTMLButtonElement>(INVITE);

    button?.click();

    expect(presenceMocks.openInviteDialog).toHaveBeenCalledOnce();
  });

  it("preserves a returning room's customization when the host edits one setting", async () => {
    const modal = hostModal();
    const editable = modal as unknown as {
      restoreExistingConfig: (config: GameConfig) => void;
      loadNationCount: () => Promise<void>;
      constructUrl: () => Promise<string>;
      putGameConfig: () => Promise<void>;
      defaultNationCount: number;
      nations: number;
      bots: number;
    };
    vi.spyOn(editable, "loadNationCount").mockImplementation(async () => {
      editable.defaultNationCount = 49;
    });
    vi.spyOn(editable, "constructUrl").mockResolvedValue(window.location.href);
    const updates: GameConfigPatch[] = [];
    modal.addEventListener("update-game-config", (event) =>
      updates.push((event as CustomEvent).detail.config),
    );
    editable.restoreExistingConfig({
      gameMap: GameMapType.UnitedStates,
      gameMapSize: GameMapSize.Normal,
      difficulty: Difficulty.Hard,
      gameMode: GameMode.FFA,
      bots: 40,
      nations: 5,
      infiniteGold: false,
      infiniteTroops: false,
      donateGold: true,
      donateTroops: true,
      instantBuild: false,
      randomSpawn: false,
      maxTimerValue: 1,
      startingGold: 4_000_000,
      goldMultiplier: 3,
      spawnImmunityDuration: 600,
      disabledUnits: [UnitType.AtomBomb],
      customAllianceDuration: 0,
      startDelay: 7,
    } as GameConfig);
    await vi.waitFor(() => expect(editable.nations).toBe(5));
    editable.bots = 99;
    await editable.putGameConfig();
    expect(updates.at(-1)).toMatchObject({
      gameMap: GameMapType.UnitedStates,
      bots: 99,
      nations: 5,
      difficulty: Difficulty.Hard,
      maxTimerValue: 1,
      startingGold: 4_000_000,
      goldMultiplier: 3,
      spawnImmunityDuration: 600,
      disabledUnits: [UnitType.AtomBomb],
      customAllianceDuration: 0,
      startDelay: 7,
      infiniteGold: false,
      infiniteTroops: false,
      donateGold: true,
    });
  });
});
