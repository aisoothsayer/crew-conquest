import { afterEach, expect, it, vi } from "vitest";
import type { GameRecord } from "@openfront/shared/WireSchemas";
import { archive, readGameRecord } from "../../src/server/Archive";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("keeps standalone Crew match records away from upstream archive APIs", async () => {
  vi.stubEnv("CREW_TWITCH_ONLY", "true");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await archive({ info: { gameID: "AbCd1234" } } as GameRecord);
  expect(await readGameRecord("AbCd1234")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
