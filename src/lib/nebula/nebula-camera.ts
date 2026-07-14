import type { Point, SceneBounds, Size } from './nebula-layout';

export interface NebulaCamera {
  /** World-space coordinate at the viewport's top-left corner. */
  x: number;
  y: number;
  zoom: number;
}

export const MIN_NEBULA_ZOOM = 0.6;
export const MAX_NEBULA_ZOOM = 1.8;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function screenToWorld(point: Point, camera: NebulaCamera): Point {
  return {
    x: camera.x + point.x / camera.zoom,
    y: camera.y + point.y / camera.zoom,
  };
}

export function worldToScreen(point: Point, camera: NebulaCamera): Point {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  };
}

export function clampCamera(camera: NebulaCamera, bounds: SceneBounds, viewport: Size): NebulaCamera {
  const zoom = clamp(camera.zoom, MIN_NEBULA_ZOOM, MAX_NEBULA_ZOOM);
  const worldWidth = Math.max(0, viewport.width) / zoom;
  const worldHeight = Math.max(0, viewport.height) / zoom;
  const sceneWidth = Math.max(0, bounds.maxX - bounds.minX);
  const sceneHeight = Math.max(0, bounds.maxY - bounds.minY);

  const x = worldWidth >= sceneWidth
    ? bounds.minX - (worldWidth - sceneWidth) / 2
    : clamp(camera.x, bounds.minX, bounds.maxX - worldWidth);
  const y = worldHeight >= sceneHeight
    ? bounds.minY - (worldHeight - sceneHeight) / 2
    : clamp(camera.y, bounds.minY, bounds.maxY - worldHeight);
  return { x, y, zoom };
}

export function zoomAtPoint(
  camera: NebulaCamera,
  point: Point,
  nextZoom: number,
  bounds: SceneBounds,
  viewport: Size,
): NebulaCamera {
  const worldPoint = screenToWorld(point, camera);
  const zoom = clamp(nextZoom, MIN_NEBULA_ZOOM, MAX_NEBULA_ZOOM);
  return clampCamera({
    x: worldPoint.x - point.x / zoom,
    y: worldPoint.y - point.y / zoom,
    zoom,
  }, bounds, viewport);
}

export function fitScene(bounds: SceneBounds, viewport: Size, padding = 64): NebulaCamera {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const sceneWidth = Math.max(1, bounds.maxX - bounds.minX);
  const sceneHeight = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = clamp(Math.min(availableWidth / sceneWidth, availableHeight / sceneHeight), MIN_NEBULA_ZOOM, MAX_NEBULA_ZOOM);
  return clampCamera({
    x: (bounds.minX + bounds.maxX) / 2 - viewport.width / zoom / 2,
    y: (bounds.minY + bounds.maxY) / 2 - viewport.height / zoom / 2,
    zoom,
  }, bounds, viewport);
}

export function edgePanVelocity(pointer: Point, viewport: Size, threshold = 72): Point {
  const edgeVelocity = (distance: number, direction: -1 | 1): number => {
    if (distance >= threshold) return 0;
    const strength = 1 - clamp(distance / threshold, 0, 1);
    return direction * strength * strength * 18;
  };
  const x = pointer.x < threshold
    ? edgeVelocity(pointer.x, -1)
    : edgeVelocity(viewport.width - pointer.x, 1);
  const y = pointer.y < threshold
    ? edgeVelocity(pointer.y, -1)
    : edgeVelocity(viewport.height - pointer.y, 1);
  return { x, y };
}
