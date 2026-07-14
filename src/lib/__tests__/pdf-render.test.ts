import { describe, expect, it } from 'vitest';
import { calculatePdfRenderMetrics } from '../pdf-render';

describe('PDF high resolution rendering metrics', () => {
  it('renders the canvas at device pixel density while preserving CSS size', () => {
    const metrics = calculatePdfRenderMetrics({
      baseWidth: 612,
      baseHeight: 792,
      targetCssWidth: 918,
      devicePixelRatio: 2,
    });

    expect(metrics.cssWidth).toBe(918);
    expect(metrics.cssHeight).toBe(1188);
    expect(metrics.pixelWidth).toBe(1836);
    expect(metrics.pixelHeight).toBe(2376);
    expect(metrics.renderScale).toBe(3);
  });

  it('caps device pixel density to avoid excessive canvas memory', () => {
    const metrics = calculatePdfRenderMetrics({
      baseWidth: 600,
      baseHeight: 800,
      targetCssWidth: 900,
      devicePixelRatio: 4,
    });

    expect(metrics.pixelRatio).toBe(2);
    expect(metrics.pixelWidth).toBe(1800);
    expect(metrics.pixelHeight).toBe(2400);
  });
});
