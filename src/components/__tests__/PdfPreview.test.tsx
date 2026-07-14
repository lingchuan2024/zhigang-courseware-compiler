import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfPreview } from '../document-review/PdfPreview';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const renderPromise = vi.fn(async () => undefined);
const getPage = vi.fn(async () => ({
  getViewport: ({ scale }: { scale: number }) => ({
    width: 600 * scale,
    height: 800 * scale,
  }),
  render: () => ({ promise: renderPromise(), cancel: vi.fn() }),
}));

vi.mock('../../lib/document-source', () => ({
  loadDocumentSource: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
}));

vi.mock('../../lib/pdf', () => ({
  loadPdfDocument: vi.fn(async () => ({ numPages: 2, getPage, destroy: vi.fn() })),
}));

class VisibleIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  constructor(private readonly callback: IntersectionObserverCallback) {}
  disconnect() {}
  observe(target: Element) {
    this.callback([{
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRatio: 1,
      intersectionRect: target.getBoundingClientRect(),
      isIntersecting: true,
      rootBounds: null,
      target,
      time: 0,
    }], this);
  }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  unobserve() {}
}

globalThis.IntersectionObserver = VisibleIntersectionObserver;

async function render(ui: ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(ui);
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  return container;
}

describe('PDF high resolution preview', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    getPage.mockClear();
    renderPromise.mockClear();
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  });

  it('renders visible PDF pages to DPR-aware canvases instead of JPEG previews', async () => {
    const container = await render(createElement(PdfPreview, {
      sourceKey: 'pdf-source',
      totalPages: 2,
      scale: 1,
      currentPage: 1,
      onCurrentPageChange: vi.fn(),
    }));

    const canvases = container.querySelectorAll('canvas');
    expect(container.querySelector('[data-testid="continuous-pdf-viewer"]')).not.toBeNull();
    expect(canvases).toHaveLength(2);
    expect(canvases[0].width).toBe(1840);
    expect(canvases[0].style.width).toBe('920px');
    expect(container.querySelector('img')).toBeNull();
  });
});
