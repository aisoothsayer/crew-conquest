import {
  TwitchProfileSchema,
  WirePlayerSchema,
} from "@openfront/shared/WireSchemas";
import { expect, it } from "vitest";
import {
  crewDisplayName,
  crewProfile,
  setCrewProfiles,
} from "../../src/client/CrewProfiles";
it("retains verified player identity for the in-game avatar list and clears it between games", () => {
  const twitch = {
    id: "123",
    login: "aisoothsayer",
    displayName: "aisoothsayer",
    avatar: "https://static-cdn.jtvnw.net/test.png",
  };
  const player = WirePlayerSchema.parse({
    clientID: "client01",
    username: twitch.displayName,
    clanTag: null,
    twitch,
  });
  setCrewProfiles([player]);
  expect(crewProfile("client01")).toEqual(twitch);
  expect(crewProfile("bot1")).toBeUndefined();
  setCrewProfiles([]);
  expect(crewProfile("client01")).toBeUndefined();
});
it("preserves a full Twitch name and falls back to login for unsupported glyphs", () => {
  const displayName = "x".repeat(25);
  expect(crewDisplayName({ displayName, login: "viewer" })).toBe(displayName);
  expect(crewDisplayName({ displayName: "🚀", login: "viewer" })).toBe(
    "viewer",
  );
});
it("rejects script URLs and lookalike avatar hosts", () => {
  const profile = {
    id: "123",
    login: "viewer",
    displayName: "viewer",
    avatar: "javascript:alert(1)",
  };
  expect(TwitchProfileSchema.safeParse(profile).success).toBe(false);
  expect(
    TwitchProfileSchema.safeParse({
      ...profile,
      avatar: "https://jtvnw.net.evil.example/avatar.png",
    }).success,
  ).toBe(false);
});
