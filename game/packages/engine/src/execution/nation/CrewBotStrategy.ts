import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Difficulty,
  GameType,
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { log } from "@openfront/engine-lib/DetMath";
import { Game, Player } from "../../game/Game";

/** Guide-informed choices use the actual combat rules, not guide cost tables. */
export function usesCrewStrategy(game: Game, player: Player): boolean {
  if (player.type?.() !== PlayerType.Nation || player.clientID?.() == null)
    return false;
  const difficulty = game.config().gameConfig().difficulty;
  return difficulty === Difficulty.Hard || difficulty === Difficulty.Impossible;
}

export function crewAttackBudget(game: Game, player: Player): number {
  const incoming = player
    .incomingAttacks()
    .reduce((sum, a) => sum + a.troops(), 0);
  // Keep a growth/defense reserve, increased by actual incoming pressure.
  const retained = Math.max(
    game.config().maxTroops(player) *
      (usesCrewSoloAggression(game, player) ? 0.2 : 0.35),
    incoming * (usesCrewSoloAggression(game, player) ? 0.6 : 0.8),
  );
  return Math.max(0, player.troops() - retained);
}

/** Solo observer behavior only; no match settings or resource grants. */
export function usesCrewSoloAggression(game: Game, player: Player): boolean {
  return (
    usesCrewStrategy(game, player) &&
    game.config().gameConfig().gameType === GameType.Singleplayer
  );
}

/** A real investment budget, after an opening economy; never a gold grant. */
export function crewSoloNuclearReserve(game: Game, player: Player): bigint {
  const config = game.config();
  if (
    !usesCrewSoloAggression(game, player) ||
    config.isUnitDisabled(UnitType.MissileSilo) ||
    player.unitsOwned(UnitType.City) < 2 ||
    player.unitsOwned(UnitType.Port) + player.unitsOwned(UnitType.Factory) <
      1 ||
    player.incomingAttacks().reduce((s, a) => s + a.troops(), 0) >
      player.troops() * 0.5 ||
    !game
      .players()
      .some(
        (p) =>
          p !== player &&
          p.isAlive() &&
          p.type() !== PlayerType.Bot &&
          !player.isFriendly(p) &&
          p.units(Structures.types).length > 0,
      )
  )
    return 0n;
  const weapon = !config.isUnitDisabled(UnitType.AtomBomb)
    ? UnitType.AtomBomb
    : !config.isUnitDisabled(UnitType.HydrogenBomb)
      ? UnitType.HydrogenBomb
      : null;
  if (weapon === null) return 0n;
  return game
    .unitInfo(
      player.unitsOwned(UnitType.MissileSilo) === 0
        ? UnitType.MissileSilo
        : weapon,
    )
    .cost(game, player);
}

export function shouldCrewCounterattack(
  player: Player,
  attacker: Player,
  game?: Game,
): boolean {
  const incoming = player.incomingAttacks();
  const pressure = incoming
    .filter((a) => a.attacker() === attacker)
    .reduce((s, a) => s + a.troops(), 0);
  const otherPressure = incoming
    .filter((a) => a.attacker() !== attacker)
    .reduce((s, a) => s + a.troops(), 0);
  // A serious invasion needs a response. A small probe does not justify
  // draining defenders into a stronger army or abandoning another front.
  const solo = game !== undefined && usesCrewSoloAggression(game, player);
  if (pressure > player.troops() * (solo ? 0.25 : 0.35)) return true;
  return (
    otherPressure <= player.troops() * (solo ? 0.25 : 0.15) &&
    attacker.troops() < player.troops() * (solo ? 0.95 : 0.65)
  );
}

/** Bounded sample of a real shared frontier; null means this push is uneconomic. */
export function crewLandAttackScore(
  game: Game,
  player: Player,
  target: Player,
  front: TileRef[],
  commitment: number,
): number | null {
  if (
    commitment < 1 ||
    front.length === 0 ||
    !target.isAlive() ||
    player.isFriendly(target)
  )
    return null;
  let loss = 0;
  const samples = Math.min(32, front.length);
  for (let i = 0; i < samples; i++) {
    const tile = front[Math.floor((i * front.length) / samples)];
    loss += game.config().attackLogic({
      terrain: game.terrainType(tile),
      attackTroops: commitment,
      attacker: { type: player.type(), numTiles: player.numTilesOwned() },
      defender: {
        type: target.type(),
        numTiles: target.numTilesOwned(),
        troops: target.troops(),
        isTraitor: target.isTraitor(),
        isDisconnectedTeammate:
          target.isDisconnected() && player.isOnSameTeam(target),
      },
      defenderHasDefensePost: game.hasUnitNearby(
        tile,
        game.config().defensePostRange(),
        UnitType.DefensePost,
        target.id(),
      ),
      falloutRatio: game.hasFallout(tile)
        ? game.numTilesWithFallout() / game.numLandTiles()
        : null,
      borderSize: front.length,
    }).attackerTroopLoss;
  }
  const lossPerTile = Math.max(1, loss / samples);
  const affordableTiles = commitment / lossPerTile;
  if (affordableTiles < Math.min(50, front.length * 2)) return null;
  const structures = target
    .units()
    .filter((u) => Structures.has(u.type()))
    .reduce((s, u) => s + u.level(), 0);
  const otherAttackers = target
    .incomingAttacks()
    .filter((a) => a.attacker() !== player)
    .reduce((s, a) => s + a.troops(), 0);
  const density = target.troops() / Math.max(1, target.numTilesOwned());
  // Compare value, exhausted defenders, and actual terrain/post losses.
  // This ranks targets; it never changes combat damage or grants resources.
  return (
    ((1 +
      log(1 + target.numTilesOwned()) / 10 +
      Math.min(10, structures) * 0.15) *
      (1 + Math.min(1, otherAttackers / Math.max(1, target.troops()))) *
      commitment) /
    Math.max(1, target.troops() + commitment) /
    (1 + lossPerTile / Math.max(20, density))
  );
}
