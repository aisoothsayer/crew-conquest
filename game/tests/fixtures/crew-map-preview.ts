import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { validBotSpawn } from "@openfront/shared/CrewBotPlacement";
import "../../src/client/components/CrewMapPlacement";
import { CrewMapPlacement } from "../../src/client/components/CrewMapPlacement";
import { loadCachedTerrainMap } from "../../src/client/TerrainMapFileLoader";
const lang = document.createElement("lang-selector") as HTMLElement & {
  currentLang: string;
  translations: Record<string, string>;
  defaultTranslations: Record<string, string>;
};
lang.currentLang = "en";
lang.translations = {
  "crew.placement_help":
    "Click land to choose your starting point. Leave space between starting points.",
  "crew.placement_closed":
    "Starting points are closed. You can still zoom and pan.",
  "crew.placement_map": "Starting position map",
  "crew.placement_count": "Starting points set: {count}",
  "crew.placement_invalid":
    "Choose open land with room between starting points.",
};
lang.defaultTranslations = lang.translations;
document.body.append(lang);
const map = document.querySelector<CrewMapPlacement>("crew-map-placement")!;
map.map = GameMapType.UnitedStates;
map.mapSize = GameMapSize.Compact;
map.ownClientID = "fixture-0";
const { gameMap } = await loadCachedTerrainMap(map.map, map.mapSize);
const points = [
  { x: 148, y: 270 },
  { x: 146, y: 310 },
  { x: 160, y: 350 },
  { x: 185, y: 390 },
  { x: 215, y: 425 },
];
if (!points.every((p, i) => validBotSpawn(gameMap, p, points.slice(0, i))))
  throw new Error("Fixture points must be legal terrain with real spacing");
map.placements = points.map((botSpawn, i) => ({
  clientID: `fixture-${i}`,
  username: i === 0 ? "Danny" : `Viewer ${i + 1}`,
  botSpawn,
  twitch: {
    id: `fixture-${i}`,
    displayName: i === 0 ? "Danny" : `Viewer ${i + 1}`,
    login: `fixture${i}`,
    avatar: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="hsl(${i * 65},55%,40%)"/><circle cx="16" cy="12" r="7" fill="#efcfad"/><ellipse cx="16" cy="30" rx="13" ry="12" fill="#c5eafa"/><circle cx="13" cy="11" r="1"/><circle cx="19" cy="11" r="1"/></svg>`)}`,
  },
}));
const placement = document.querySelector<HTMLInputElement>("#placement")!,
  playing = document.querySelector<HTMLInputElement>("#playing")!;
function update() {
  map.enabled = placement.checked && playing.checked;
  map.blockedReason = !placement.checked
    ? "Placement closed — zoom and pan remain available."
    : !playing.checked
      ? "You’re spectating — zoom and pan remain available. Turn on I play to choose a point."
      : "";
  document.querySelector("#state")!.textContent = placement.checked
    ? "Placement open"
    : "Placement closed";
}
placement.onchange = playing.onchange = update;
update();
let count = 0;
map.addEventListener("crew-place", (e) => {
  const point = (e as CustomEvent).detail;
  map.placements = map.placements.map((p) =>
    p.clientID === map.ownClientID ? { ...p, botSpawn: point } : p,
  );
  document.querySelector("#events")!.textContent =
    `Placement events: ${++count}; latest ${point.x}, ${point.y}`;
});
// A fixture-only click target at the center of a known legal tile. Its pointer
// events bubble through the real map component; it supplies no placement code.
await map.updateComplete;
while (!map.querySelector("[data-map-world]"))
  await new Promise(requestAnimationFrame);
const target = document.createElement("button");
target.type = "button";
target.setAttribute("aria-label", "Fixture tile 400,350");
target.style.cssText =
  "position:absolute;left:" +
  (400.5 / 1400) * 100 +
  "%;top:" +
  (350.5 / 774) * 100 +
  "%;width:8px;height:8px;padding:0;border:1px solid white;border-radius:50%;background:#ff00ff;transform:translate(-50%,-50%)";
if (!validBotSpawn(gameMap, { x: 400, y: 350 }, points))
  throw new Error("Known click target must be legal");
map.querySelector("[data-map-world]")!.append(target);
