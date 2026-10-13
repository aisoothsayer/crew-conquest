/** Camera coordinates are fractions of the unzoomed viewport, not screen pixels. */
export type CrewMapCamera = { scale: number; x: number; y: number };
export type ViewPoint = { x: number; y: number };
export const fittedCrewCamera = (): CrewMapCamera => ({ scale: 1, x: 0, y: 0 });
export function constrainCrewCamera(camera: CrewMapCamera): CrewMapCamera {
  const scale = Math.max(1, Math.min(6, camera.scale));
  return {
    scale,
    x: Math.max(1 - scale, Math.min(0, camera.x)),
    y: Math.max(1 - scale, Math.min(0, camera.y)),
  };
}
export function crewMapToView(
  point: ViewPoint,
  width: number,
  height: number,
  camera: CrewMapCamera,
): ViewPoint {
  return {
    x: camera.x + (camera.scale * point.x) / width,
    y: camera.y + (camera.scale * point.y) / height,
  };
}
export function crewViewToMap(
  point: ViewPoint,
  width: number,
  height: number,
  camera: CrewMapCamera,
): ViewPoint {
  return {
    x: ((point.x - camera.x) / camera.scale) * width,
    y: ((point.y - camera.y) / camera.scale) * height,
  };
}
export function zoomCrewCamera(
  camera: CrewMapCamera,
  scale: number,
  anchor: ViewPoint,
  destination = anchor,
): CrewMapCamera {
  const nextScale = Math.max(1, Math.min(6, scale));
  const map = crewViewToMap(anchor, 1, 1, camera);
  return constrainCrewCamera({
    scale: nextScale,
    x: destination.x - map.x * nextScale,
    y: destination.y - map.y * nextScale,
  });
}
export function crewIdentityColor(identity: string): string {
  let hash = 2166136261;
  for (const char of identity)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360}, 80%, 65%)`;
}
