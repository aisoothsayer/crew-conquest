import { UsernameSchema } from "@openfront/engine-api/Schemas";
import type { TwitchProfile, WirePlayer } from "@openfront/shared/WireSchemas";
export function crewDisplayName(
  profile: Pick<TwitchProfile, "displayName" | "login">,
): string {
  return UsernameSchema.safeParse(profile.displayName).success
    ? profile.displayName
    : profile.login;
}
const profiles = new Map<string, TwitchProfile>();
export function setCrewProfiles(players: readonly WirePlayer[]): void {
  profiles.clear();
  for (const player of players)
    if (player.twitch) profiles.set(player.clientID, player.twitch);
}
export function crewProfile(
  clientID: string | null,
): TwitchProfile | undefined {
  return clientID ? profiles.get(clientID) : undefined;
}
