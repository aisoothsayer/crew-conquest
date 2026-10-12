import type { GameMap } from "@openfront/engine-api/game/GameMap";
import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import {
  CREW_SOLO_BOT_LIMIT,
  fillSoloBotSpawns,
  validBotSpawn,
  type BotSpawn,
} from "@openfront/shared/CrewBotPlacement";
import type { TwitchProfile } from "@openfront/shared/WireSchemas";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  loadCachedTerrainMap,
  terrainMapFileLoader,
} from "../TerrainMapFileLoader";
import { translateText } from "../Utils";
export type CrewPlacement = {
  clientID: string;
  username: string;
  botSpawn: BotSpawn;
  twitch?: TwitchProfile;
};
@customElement("crew-map-placement")
export class CrewMapPlacement extends LitElement {
  @property() map = GameMapType.CrewShip;
  @property() mapSize = GameMapSize.Compact;
  @property({ attribute: false }) placements: CrewPlacement[] = [];
  @property({ type: Boolean }) enabled = true;
  @property({ type: Boolean }) soloFill = false;
  @state() private fillCount = 100;
  @property() ownClientID = "";
  @state() private terrain: GameMap | null = null;
  @state() private error = "";
  private request = 0;
  createRenderRoot() {
    return this;
  }
  protected updated(changed: Map<string, unknown>) {
    if (changed.has("map") || changed.has("mapSize")) void this.load();
  }
  private async load() {
    const request = ++this.request;
    this.terrain = null;
    this.error = "";
    try {
      const data = await loadCachedTerrainMap(this.map, this.mapSize);
      if (request === this.request) this.terrain = data.gameMap;
    } catch {
      if (request === this.request) this.error = "crew.placement_load_failed";
    }
  }
  private choose(event: MouseEvent) {
    if (!this.enabled || !this.terrain) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const point = {
      x: Math.floor(
        ((event.clientX - box.left) / box.width) * this.terrain.width(),
      ),
      y: Math.floor(
        ((event.clientY - box.top) / box.height) * this.terrain.height(),
      ),
    };
    const others = this.placements
      .filter((p) => p.clientID !== this.ownClientID)
      .map((p) => p.botSpawn);
    if (!validBotSpawn(this.terrain, point, others)) {
      this.error = "crew.placement_invalid";
      return;
    }
    this.error = "";
    this.dispatchEvent(
      new CustomEvent("crew-place", {
        detail: point,
        bubbles: true,
        composed: true,
      }),
    );
  }
  private fill() {
    if (!this.enabled || !this.terrain || !this.soloFill) return;
    const points = fillSoloBotSpawns(
      this.terrain,
      this.placements.map((p) => p.botSpawn),
      this.fillCount,
      Math.random,
    );
    this.dispatchEvent(
      new CustomEvent("crew-fill", {
        detail: points,
        bubbles: true,
        composed: true,
      }),
    );
  }
  render() {
    const width = this.terrain?.width() ?? 1,
      height = this.terrain?.height() ?? 1;
    return html`<div class="rounded-xl border border-white/20 p-4 my-4">
      <p class="mb-3 text-white/80">
        ${translateText(
          this.enabled
            ? "crew.placement_help"
            : this.soloFill
              ? "crew.solo_limit_reached"
              : "crew.placement_closed",
        )}
      </p>
      ${this.soloFill
        ? html`<div class="flex items-center gap-3 mb-3">
              <label
                >${translateText("crew.solo_total")}
                <input
                  type="number"
                  aria-label=${translateText("crew.solo_total")}
                  min="2"
                  max=${CREW_SOLO_BOT_LIMIT}
                  .value=${String(this.fillCount)}
                  class="w-20 bg-black/60 border border-white/30 rounded p-1"
                  @input=${(e: Event) => {
                    const n = (e.target as HTMLInputElement).valueAsNumber;
                    this.fillCount = Number.isFinite(n)
                      ? Math.max(
                          2,
                          Math.min(CREW_SOLO_BOT_LIMIT, Math.floor(n)),
                        )
                      : 100;
                  }}
                />
              </label>
              <button
                type="button"
                data-solo-fill
                ?disabled=${!this.enabled || !this.terrain}
                @click=${this.fill}
              >
                ${translateText("crew.fill_bots")}
              </button>
            </div>
            <p class="mb-3 text-white/70">
              ${translateText("crew.solo_fill_help")}
            </p>`
        : nothing}
      ${this.terrain
        ? html`<button
            type="button"
            aria-label=${translateText("crew.placement_map")}
            ?disabled=${!this.enabled}
            style="display:block;position:relative;margin:auto;width:min(100%,${Math.round(
              (440 * width) / height,
            )}px);max-width:650px;aspect-ratio:${width}/${height};padding:0;border:0;cursor:${this
              .enabled
              ? "crosshair"
              : "default"}"
            @click=${this.choose}
          >
            <img
              src=${terrainMapFileLoader.getMapData(this.map).webpPath}
              alt=${translateText("crew.placement_map")}
              style="display:block;width:100%;height:100%;pointer-events:none"
            />
            ${this.placements.map(
              (p, i) =>
                html`<span
                  style="position:absolute;left:${(p.botSpawn.x / width) *
                  100}%;top:${(p.botSpawn.y / height) *
                  100}%;transform:translate(-50%,-50%);pointer-events:none;display:flex;align-items:center;gap:4px;color:white;background:rgba(0,0,0,.8);padding:3px 5px;border-radius:12px;white-space:nowrap;font-size:12px;border:2px solid hsl(${(i *
                    67) %
                  360},80%,65%)"
                >
                  ${p.twitch?.avatar
                    ? html`<img
                        src=${p.twitch.avatar}
                        alt=""
                        style="width:22px;height:22px;border-radius:50%"
                      />`
                    : nothing}${p.username}</span
                >`,
            )}
          </button>`
        : html`<p>${translateText("crew.placement_loading")}</p>`}
      ${this.error
        ? html`<p role="alert" class="text-amber-300 mt-2">
            ${translateText(this.error)}
          </p>`
        : nothing}
      <p class="mt-2 text-white/70">
        ${translateText("crew.placement_count", {
          count: this.placements.length,
        })}
      </p>
    </div>`;
  }
}
