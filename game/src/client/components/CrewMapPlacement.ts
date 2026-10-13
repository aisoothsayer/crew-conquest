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
import {
  constrainCrewCamera,
  crewIdentityColor,
  crewViewToMap,
  fittedCrewCamera,
  zoomCrewCamera,
  type ViewPoint,
} from "./CrewMapCamera";
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
  @property() blockedReason = "";
  @property() ownClientID = "";
  @state() private fillCount = 100;
  @state() private terrain: GameMap | null = null;
  @state() private error = "";
  @state() private camera = fittedCrewCamera();
  @state() private dragging = false;
  private request = 0;
  private pointers = new Map<number, ViewPoint>();
  private down: ViewPoint | null = null;
  private moved = false;
  private canPlaceOnDown = false;
  private ignoreClickUntil = 0;
  createRenderRoot() {
    return this;
  }
  protected updated(changed: Map<string, unknown>) {
    if (changed.has("map") || changed.has("mapSize")) void this.load();
  }
  private async load() {
    const request = ++this.request;
    this.resetView();
    this.terrain = null;
    this.error = "";
    try {
      const data = await loadCachedTerrainMap(this.map, this.mapSize);
      if (request === this.request) this.terrain = data.gameMap;
    } catch {
      if (request === this.request) this.error = "crew.placement_load_failed";
    }
  }
  private viewport() {
    return this.querySelector<HTMLElement>("[data-crew-map]");
  }
  private localPoint(point: ViewPoint): ViewPoint | null {
    const box = this.viewport()?.getBoundingClientRect();
    return box && box.width > 0 && box.height > 0
      ? {
          x: (point.x - box.left) / box.width,
          y: (point.y - box.top) / box.height,
        }
      : null;
  }
  private place(point: ViewPoint) {
    if (!this.enabled || !this.terrain) return;
    const map = crewViewToMap(
      point,
      this.terrain.width(),
      this.terrain.height(),
      this.camera,
    );
    const position = {
      x: Math.floor(map.x + 1e-7),
      y: Math.floor(map.y + 1e-7),
    };
    const others = this.placements
      .filter((p) => p.clientID !== this.ownClientID)
      .map((p) => p.botSpawn);
    if (!validBotSpawn(this.terrain, position, others)) {
      this.error = "crew.placement_invalid";
      return;
    }
    this.error = "";
    this.dispatchEvent(
      new CustomEvent("crew-place", {
        detail: position,
        bubbles: true,
        composed: true,
      }),
    );
  }
  private choose(event: MouseEvent) {
    if (Date.now() < this.ignoreClickUntil) return;
    const point =
      event.clientX === 0 && event.clientY === 0
        ? { x: 0.5, y: 0.5 }
        : this.localPoint({ x: event.clientX, y: event.clientY });
    if (point) this.place(point);
  }
  private pointerDown(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = { x: event.clientX, y: event.clientY };
    if (this.pointers.size === 0) {
      this.down = point;
      this.moved = false;
      this.canPlaceOnDown = this.enabled;
    }
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size > 1) this.moved = true;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* Older webviews may lack pointer capture. */
    }
    this.dragging = true;
  }
  private pointerMove(event: PointerEvent) {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const before = [...this.pointers.values()];
    const next = { x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, next);
    const after = [...this.pointers.values()];
    if (after.length > 1) {
      const center = (p: ViewPoint[]) => ({
        x: (p[0].x + p[1].x) / 2,
        y: (p[0].y + p[1].y) / 2,
      });
      const distance = (p: ViewPoint[]) =>
        Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const anchor = this.localPoint(center(before)),
        destination = this.localPoint(center(after));
      if (anchor && destination && distance(before) > 0)
        this.camera = zoomCrewCamera(
          this.camera,
          (this.camera.scale * distance(after)) / distance(before),
          anchor,
          destination,
        );
      this.moved = true;
    } else {
      if (
        this.down &&
        Math.hypot(next.x - this.down.x, next.y - this.down.y) > 5
      )
        this.moved = true;
      const a = this.localPoint(previous),
        b = this.localPoint(next);
      if (this.moved && a && b)
        this.camera = constrainCrewCamera({
          ...this.camera,
          x: this.camera.x + b.x - a.x,
          y: this.camera.y + b.y - a.y,
        });
    }
  }
  private pointerUp(event: PointerEvent) {
    if (!this.pointers.has(event.pointerId)) {
      this.ignoreClickUntil = Date.now() + 500;
      return;
    }
    const choose =
      event.type === "pointerup" &&
      this.pointers.size === 1 &&
      !this.moved &&
      this.canPlaceOnDown;
    this.pointers.delete(event.pointerId);
    this.ignoreClickUntil = Date.now() + 500;
    if (choose) {
      const point = this.localPoint({ x: event.clientX, y: event.clientY });
      if (point) this.place(point);
    }
    if (event.type !== "pointerup") this.moved = true;
    if (!this.pointers.size) {
      this.dragging = false;
      this.down = null;
    }
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(
        event.pointerId,
      );
    } catch {
      /* Already released/cancelled. */
    }
  }
  private wheel(event: WheelEvent) {
    event.preventDefault();
    this.cancelPointerPlacement();
    const point = this.localPoint({ x: event.clientX, y: event.clientY });
    if (point)
      this.camera = zoomCrewCamera(
        this.camera,
        this.camera.scale * Math.exp(-event.deltaY * 0.002),
        point,
      );
  }
  private cancelPointerPlacement() {
    if (this.pointers.size) {
      this.moved = true;
      this.canPlaceOnDown = false;
    }
  }
  private zoom(factor: number) {
    this.cancelPointerPlacement();
    this.camera = zoomCrewCamera(this.camera, this.camera.scale * factor, {
      x: 0.5,
      y: 0.5,
    });
  }
  private resetView() {
    this.camera = fittedCrewCamera();
    this.pointers.clear();
    this.dragging = false;
    this.down = null;
    this.ignoreClickUntil = Date.now() + 500;
  }
  private keyboard(event: KeyboardEvent) {
    const moves: Record<string, ViewPoint> = {
      ArrowLeft: { x: 0.08, y: 0 },
      ArrowRight: { x: -0.08, y: 0 },
      ArrowUp: { x: 0, y: 0.08 },
      ArrowDown: { x: 0, y: -0.08 },
    };
    if (moves[event.key]) {
      event.preventDefault();
      this.cancelPointerPlacement();
      this.camera = constrainCrewCamera({
        ...this.camera,
        x: this.camera.x + moves[event.key].x,
        y: this.camera.y + moves[event.key].y,
      });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.place({ x: 0.5, y: 0.5 });
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      this.zoom(1.5);
    } else if (event.key === "-") {
      event.preventDefault();
      this.zoom(1 / 1.5);
    } else if (event.key === "Home") {
      event.preventDefault();
      this.resetView();
    }
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
    return html`<style>
        crew-map-placement .crew-map-viewport:focus-visible {
          outline: 3px solid #facc15;
          outline-offset: 3px;
        }
        crew-map-placement .crew-map-tools {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin: 12px 0;
        }
        crew-map-placement .crew-map-tools button {
          min-width: 44px;
          min-height: 44px;
          border: 1px solid #5c7880;
          border-radius: 8px;
          padding: 6px 12px;
          background: #112732;
          color: white;
          font-weight: bold;
        }
        crew-map-placement .crew-map-tools button:disabled {
          opacity: 0.45;
        }
        crew-map-placement .crew-map-dot {
          position: absolute;
          box-sizing: border-box;
          transform: translate(-50%, -50%);
          aspect-ratio: 1;
          min-width: 6px;
          max-width: 12px;
          border-radius: 50%;
          border: 1px solid var(--dot-color);
          background: var(--dot-color);
          pointer-events: auto;
        }
        crew-map-placement .crew-map-dot img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 50%;
          display: block;
          pointer-events: none;
        }
        crew-map-placement .crew-map-dot[data-own] {
          border-color: #ffd700;
          box-shadow: 0 0 3px #ffd700;
        }
        crew-map-placement .crew-map-dot[data-own]::after {
          content: "";
          position: absolute;
          inset: -3px;
          border: 1px solid #ffd700;
          border-radius: 50%;
          animation: crew-point-pulse 1.8s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes crew-point-pulse {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.7;
          }
          50% {
            transform: scale(1.4);
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          crew-map-placement .crew-map-dot[data-own]::after {
            animation: none;
          }
        }
      </style>
      <div class="rounded-xl border border-white/20 p-4 my-4">
        <p class="mb-3 text-white/80">
          ${this.enabled
            ? translateText("crew.placement_help")
            : this.blockedReason ||
              translateText(
                this.soloFill
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
                    }} /></label
                ><button
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
          ? html`
              <div
                class="crew-map-tools"
                role="group"
                aria-label="Map view controls"
              >
                <button
                  type="button"
                  aria-label="Zoom out"
                  ?disabled=${this.camera.scale <= 1}
                  @click=${() => this.zoom(1 / 1.5)}
                >
                  −
                </button>
                <output aria-label="Map zoom" aria-live="polite"
                  >${Math.round(this.camera.scale * 100)}%</output
                >
                <button
                  type="button"
                  aria-label="Zoom in"
                  ?disabled=${this.camera.scale >= 6}
                  @click=${() => this.zoom(1.5)}
                >
                  +
                </button>
                <button type="button" @click=${this.resetView}>
                  Reset map view
                </button>
              </div>
              <div
                class="crew-map-viewport"
                data-crew-map
                data-zoom=${this.camera.scale}
                role="group"
                tabindex="0"
                aria-label=${translateText("crew.placement_map")}
                style="display:block;position:relative;overflow:hidden;margin:auto;width:100%;max-width:650px;aspect-ratio:${width}/${height};padding:0;box-shadow:inset 0 0 0 1px #31535a;border-radius:8px;background:#07111f;touch-action:none;user-select:none;cursor:${this
                  .dragging
                  ? "grabbing"
                  : this.camera.scale > 1
                    ? "grab"
                    : this.enabled
                      ? "crosshair"
                      : "default"}"
                @pointerdown=${this.pointerDown}
                @pointermove=${this.pointerMove}
                @pointerup=${this.pointerUp}
                @pointercancel=${this.pointerUp}
                @lostpointercapture=${this.pointerUp}
                @wheel=${this.wheel}
                @click=${this.choose}
                @keydown=${this.keyboard}
              >
                <div
                  data-map-world
                  style="position:absolute;width:100%;height:100%;transform-origin:0 0;transform:translate(${this
                    .camera.x * 100}%,${this.camera.y * 100}%) scale(${this
                    .camera.scale})"
                >
                  <img
                    src=${terrainMapFileLoader.getMapData(this.map).webpPath}
                    alt=""
                    draggable="false"
                    style="display:block;width:100%;height:100%;pointer-events:none"
                  />
                  ${this.placements.map(
                    (p) =>
                      html`<span
                        class="crew-map-dot"
                        data-map-x=${p.botSpawn.x}
                        data-map-y=${p.botSpawn.y}
                        ?data-own=${p.clientID === this.ownClientID}
                        role="img"
                        aria-label=${p.username +
                        (p.clientID === this.ownClientID
                          ? " (your starting point)"
                          : "")}
                        title=${p.username}
                        style="left:${(p.botSpawn.x / width) * 100}%;top:${(p
                          .botSpawn.y /
                          height) *
                        100}%;width:${(24 / width) *
                        100}%;--dot-color:${crewIdentityColor(
                          p.twitch?.id || p.clientID,
                        )}"
                      >
                        ${p.twitch?.avatar
                          ? html`<img
                              src=${p.twitch.avatar}
                              alt=""
                              referrerpolicy="no-referrer"
                              @error=${(e: Event) => {
                                (e.target as HTMLImageElement).style.opacity =
                                  "0";
                              }}
                            />`
                          : nothing}
                      </span>`,
                  )}
                </div>
              </div>
              <p class="mt-2 text-sm text-white/60">
                Scroll or pinch to zoom. Drag to pan. +/− and arrow keys work
                too; Enter picks the center when placement is open. Zooming
                never moves a starting point.
              </p>
            `
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
