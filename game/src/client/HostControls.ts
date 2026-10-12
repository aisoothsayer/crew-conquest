import type { GameView } from "./view";

/** UI role only. The server separately checks every host command. */
export function isGameHost(game: GameView | undefined): boolean {
  return (
    game?.isLobbyHost === true || game?.myPlayer()?.isLobbyCreator() === true
  );
}
