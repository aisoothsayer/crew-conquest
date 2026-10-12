import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenPayloadSchema, UserMeResponseSchema } from "@openfront/shared/ApiSchemas";
import { hasLinkedIdentity } from "../src/client/AccountIdentity";
const profile = { user: { twitch: { id: "123", login: "aisoothsayer", displayName: "Danny" } }, player: { publicId: "crew-fixture", adfree: true, unlimitedRanked: false, canCreatePublicLobbies: false, username: "Danny", flares: [], friends: [], achievements: { singleplayerMap: [] }, subscription: null } };
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("Crew Twitch identity boundary", () => {
  it("accepts a real-shaped Twitch profile as a linked identity", () => {
    const parsed = UserMeResponseSchema.parse(profile);
    expect(hasLinkedIdentity(parsed.user)).toBe(true);
    expect(hasLinkedIdentity({})).toBe(false);
  });
  it("maps the game subject to the upstream UUID representation", () => {
    const claims = TokenPayloadSchema.parse({ jti: "fixture", sub: "AAAAAABAUACAAAAAAAAAAA", iss: "http://localhost:9000", aud: "danny-openfront", iat: 100, exp: 200, provider: "twitch", role: "crew-viewer" });
    expect(claims.sub).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims.role).toBe("crew-viewer");
  });
  it("does not use development guest admission in Twitch-only mode", async () => {
    vi.stubEnv("GAME_ENV", "dev"); vi.stubEnv("CREW_TWITCH_ONLY", "true");
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const { verifyClientToken } = await import("../src/server/jwt");
    expect((await verifyClientToken("00000000-0000-4000-8000-000000000001")).type).toBe("error");
    expect(request.mock.calls[0][0]).toBe("http://127.0.0.1:9120/game-access");
  });
  it("fails closed when the identity service is unavailable", async () => {
    vi.stubEnv("GAME_ENV", "dev"); vi.stubEnv("CREW_TWITCH_ONLY", "true");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const { verifyClientToken } = await import("../src/server/jwt");
    expect((await verifyClientToken("fixture-ticket")).type).toBe("error");
  });
  it("disables the stock development admin-bot key in crew mode", async () => {
    vi.stubEnv("GAME_ENV", "dev"); vi.stubEnv("CREW_TWITCH_ONLY", "true");
    vi.stubEnv("ADMIN_BOT_API_KEY", "fixture-dev-key");
    const { ServerEnv } = await import("../src/server/ServerEnv");
    expect(ServerEnv.adminBotKey()).toBeUndefined();
  });
});
