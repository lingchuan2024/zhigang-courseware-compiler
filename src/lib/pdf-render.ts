export interface PdfRenderMetricInput {
  baseWidth: number;
  baseHeight: number;
  targetCssWidth: number;
  devicePixelRatio: number;
}

export interface PdfRenderMetrics {
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  pixelRatio: number;
  renderScale: number;
}

/**
 * 计算 PDF Canvas 的 CSS 尺寸和实际像素尺寸。
 * Canvas 使用最多 2x 的设备像素密度，避免低清位图放大，
 * 同时限制 Retina / 4K 屏幕上的内存占用。
 */
export function calculatePdfRenderMetrics({
  baseWidth,
  baseHeight,
  targetCssWidth,
  devicePixelRatio,
}: PdfRenderMetricInput): PdfRenderMetrics {
  const safeBaseWidth = Math.max(1, baseWidth);
  const safeBaseHeight = Math.max(1, baseHeight);
  const cssWidth = Math.max(1, Math.round(targetCssWidth));
  const cssScale = cssWidth / safeBaseWidth;
  const cssHeight = Math.max(1, Math.round(safeBaseHeight * cssScale));
  const pixelRatio = Math.max(1, Math.min(2, devicePixelRatio || 1));

  return {
    cssWidth,
    cssHeight,
    pixelWidth: Math.max(1, Math.round(cssWidth * pixelRatio)),
    pixelHeight: Math.max(1, Math.round(cssHeight * pixelRatio)),
    pixelRatio,
    renderScale: cssScale * pixelRatio,
  };
}
