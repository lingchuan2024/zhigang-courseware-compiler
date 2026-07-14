import { describe, expect, it } from 'vitest';
import {
  clampCamera,
  edgePanVelocity,
  fitScene,
  screenToWorld,
  zoomAtPoint,
} from '../nebula-camera';

const bounds = { minX: 0, minY: 0, maxX: 2400, maxY: 1800 };
const viewport = { width: 800, height: 600 };

describe('nebula camera', () => {
  it('keeps the world coordinate under the pointer stable while zooming', () => {
    const camera = { x: 200, y: 150, zoom: 1 };
    const point = { x: 400, y: 300 };
    const before = screenToWorld(point, camera);
    const zoomed = zoomAtPoint(camera, point, 1.4, bounds, viewport);
    const after = screenToWorld(point, zoomed);

    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
  });

  it('clamps position and zoom to the navigable scene', () => {
    expect(clampCamera({ x: -100, y: 9999, zoom: 4 }, bounds, viewport)).toEqual({
      x: 0,
      y: 1466.6666666666667,
      zoom: 1.8,
    });
  });

  it('fits the entire scene inside the viewport', () => {
    const fitted = fitScene(bounds, viewport, 40);
    expect(fitted.zoom).toBeCloseTo(0.6);
    expect(fitted.x).toBeCloseTo(533.3333333);
    expect(fitted.y).toBeCloseTo(400);
  });

  it('only pans when the pointer approaches an edge', () => {
    expect(edgePanVelocity({ x: 400, y: 300 }, viewport)).toEqual({ x: 0, y: 0 });
    expect(edgePanVelocity({ x: 2, y: 598 }, viewport)).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(edgePanVelocity({ x: 2, y: 598 }, viewport).x).toBeLessThan(0);
    expect(edgePanVelocity({ x: 2, y: 598 }, viewport).y).toBeGreaterThan(0);
  });
});
