import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import { expect, test, vi } from "vitest";
import {
  constrainCrewCamera,
  crewIdentityColor,
  crewMapToView,
  crewViewToMap,
  zoomCrewCamera,
} from "../../src/client/components/CrewMapCamera";
import { CrewMapPlacement } from "../../src/client/components/CrewMapPlacement";

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: () => ({ webpPath: "/fixture.webp" }) },
  loadCachedTerrainMap: async () => ({
    gameMap: new GameMapImpl(240, 200, new Uint8Array(48000).fill(0x80), 48000),
  }),
}));
async function fixture(enabled = true) {
  const map = new CrewMapPlacement();
  map.enabled = enabled;
  document.body.append(map);
  await vi.waitFor(() =>
    expect(map.querySelector("[data-crew-map]")).not.toBeNull(),
  );
  const view = map.querySelector<HTMLElement>("[data-crew-map]")!;
  vi.spyOn(view, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 20,
    width: 480,
    height: 400,
    right: 490,
    bottom: 420,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  });
  const events: unknown[] = [];
  map.addEventListener("crew-place", (e) =>
    events.push((e as CustomEvent).detail),
  );
  const pointer = (type: string, x: number, y: number, id = 1) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
    Object.defineProperties(event, {
      pointerId: { value: id },
      pointerType: { value: "touch" },
    });
    view.dispatchEvent(event);
  };
  const wheel = () =>
    view.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 250,
        clientY: 220,
        deltaY: -300,
      }),
    );
  const key = (key: string) =>
    view.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key, cancelable: true }),
    );
  return { map, view, events, pointer, wheel, key };
}
test("shared camera round-trips terrain coordinates and preserves a zoom anchor at any viewport size", () => {
  const camera = { scale: 3, x: -0.7, y: -1 };
  const point = { x: 42, y: 63 };
  const view = crewMapToView(point, 240, 200, camera);
  const roundTrip = crewViewToMap(view, 240, 200, camera);
  expect(roundTrip.x).toBeCloseTo(point.x, 10);
  expect(roundTrip.y).toBeCloseTo(point.y, 10);
  const next = zoomCrewCamera(camera, 4, view);
  const anchored = crewMapToView(point, 240, 200, next);
  expect(anchored.x).toBeCloseTo(view.x);
  expect(anchored.y).toBeCloseTo(view.y);
  for (const width of [320, 650]) {
    const screen = { x: view.x * width, y: (view.y * width * 200) / 240 };
    const inverse = crewViewToMap(
      { x: screen.x / width, y: screen.y / ((width * 200) / 240) },
      240,
      200,
      camera,
    );
    expect(inverse.x).toBeCloseTo(point.x);
    expect(inverse.y).toBeCloseTo(point.y);
  }
  expect(constrainCrewCamera({ scale: 20, x: -99, y: 2 })).toEqual({
    scale: 6,
    x: -5,
    y: 0,
  });
});
test.each([true, false])(
  "drag, wheel, pinch and cancel never choose a starting point (enabled=%s)",
  async (enabled) => {
    const f = await fixture(enabled);
    f.pointer("pointerdown", 250, 220);
    f.wheel();
    f.pointer("pointerup", 250, 220);
    expect(f.events).toEqual([]);
    expect(Number(f.view.dataset.zoom)).toBeGreaterThanOrEqual(1);
    f.pointer("pointerdown", 250, 220);
    f.pointer("pointermove", 300, 260);
    f.pointer("pointerup", 300, 260);
    f.pointer("pointerdown", 200, 200, 1);
    f.pointer("pointerdown", 300, 200, 2);
    f.pointer("pointermove", 350, 200, 2);
    f.pointer("pointerup", 200, 200, 1);
    f.pointer("pointerup", 350, 200, 2);
    f.pointer("pointerdown", 250, 220);
    f.pointer("pointercancel", 250, 220);
    f.pointer("pointerdown", 250, 220);
    f.key("ArrowLeft");
    f.pointer("pointerup", 250, 220);
    f.pointer("pointerdown", 250, 220);
    f.key("Home");
    f.pointer("pointerup", 250, 220);
    await f.map.updateComplete;
    expect(f.events).toEqual([]);
    expect(f.view.dataset.zoom).toBe("1");
  },
);
test("a deliberate click after zoom and pan chooses the inverse coordinate exactly once", async () => {
  const f = await fixture();
  f.key("+");
  f.key("ArrowRight");
  await f.map.updateComplete;
  // At 150%, pan x=-.33/y=-.25: center is (132.8,100), floored to (132,100).
  f.pointer("pointerdown", 250, 220);
  f.pointer("pointerup", 250, 220);
  f.view.dispatchEvent(
    new MouseEvent("click", { bubbles: true, clientX: 250, clientY: 220 }),
  );
  expect(f.events).toEqual([{ x: 132, y: 100 }]);
});
test("closed/spectating navigation works while clicks and Enter cannot place; reopening permits an intentional click", async () => {
  const f = await fixture(false);
  f.map.blockedReason = "Spectating — map navigation is available.";
  f.key("+");
  f.key("ArrowLeft");
  await f.map.updateComplete;
  expect(f.view.dataset.zoom).toBe("1.5");
  f.pointer("pointerdown", 250, 220);
  f.pointer("pointerup", 250, 220);
  f.key("Enter");
  expect(f.events).toEqual([]);
  f.map.enabled = true;
  await f.map.updateComplete;
  f.pointer("pointerdown", 250, 220);
  f.pointer("pointerup", 250, 220);
  expect(f.events).toHaveLength(1);
});
test("markers have no visible names, share the terrain transform, and retain identity colors after reorder; map changes reset view", async () => {
  const f = await fixture();
  f.map.ownClientID = "a";
  f.map.placements = [
    { clientID: "a", username: "Danny", botSpawn: { x: 50, y: 70 } },
    { clientID: "b", username: "Viewer", botSpawn: { x: 80, y: 100 } },
  ];
  await f.map.updateComplete;
  const own = f.map.querySelector<HTMLElement>("[data-own]")!;
  expect(own.title).toBe("Danny");
  expect(own.textContent?.trim()).toBe("");
  expect(own.getAttribute("aria-label")).toContain("your starting point");
  expect(own.parentElement).toBe(f.map.querySelector("[data-map-world]"));
  const color = own.style.getPropertyValue("--dot-color");
  f.map.placements = [...f.map.placements].reverse();
  await f.map.updateComplete;
  expect(
    f.map
      .querySelector<HTMLElement>("[data-own]")!
      .style.getPropertyValue("--dot-color"),
  ).toBe(color);
  expect(crewIdentityColor("a")).not.toBe(crewIdentityColor("b"));
  f.key("+");
  await f.map.updateComplete;
  expect(f.view.dataset.zoom).toBe("1.5");
  f.map.map = GameMapType.UnitedStates;
  f.map.mapSize = GameMapSize.Normal;
  await vi.waitFor(() =>
    expect(
      f.map.querySelector<HTMLElement>("[data-crew-map]")?.dataset.zoom,
    ).toBe("1"),
  );
});
