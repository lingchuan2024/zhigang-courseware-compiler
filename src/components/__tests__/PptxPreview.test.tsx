import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PptxPreview } from '../document-review/PptxPreview';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/document-source', () => ({
  loadDocumentSource: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
}));

vi.mock('pptx-preview', () => ({
  init: (host: HTMLElement) => ({
    preview: async () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'pptx-preview-wrapper';
      for (let index = 0; index < 2; index++) {
        const slide = document.createElement('div');
        slide.className = `pptx-preview-slide-wrapper pptx-preview-slide-wrapper-${index}`;
        slide.textContent = `原始幻灯片 ${index + 1}`;
        wrapper.appendChild(slide);
      }
      host.appendChild(wrapper);
    },
    destroy: vi.fn(),
  }),
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
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return container;
}

describe('PPTX original slide preview', () => {
  beforeEach(() => document.body.replaceChildren());

  it('使用原始 PPTX 二进制渲染全部幻灯片，不显示识别文字降级页', async () => {
    const container = await render(createElement(PptxPreview, {
      sourceKey: 'doc-pptx',
      totalPages: 2,
      scale: 1,
      currentPage: 1,
      onCurrentPageChange: vi.fn(),
    }));

    expect(container.querySelector('[data-testid="continuous-pptx-viewer"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-page-number]')).toHaveLength(2);
    expect(container.textContent).toContain('原始幻灯片 1');
    expect(container.textContent).not.toContain('结构化文本预览');
  });
});
