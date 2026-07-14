import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { PagePreview } from '../document-review/PagePreview';
import { PageNavigator } from '../document-review/PageNavigator';
import { ReviewToolbar } from '../document-review/ReviewToolbar';
import type { CoursePage } from '../../types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  disconnect() {}
  observe(target: Element) {
    this.callback([
      {
        boundingClientRect: target.getBoundingClientRect(),
        intersectionRatio: 1,
        intersectionRect: target.getBoundingClientRect(),
        isIntersecting: true,
        rootBounds: null,
        target,
        time: 0,
      },
    ], this);
  }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  unobserve() {}

  constructor(private readonly callback: IntersectionObserverCallback) {}
}

globalThis.IntersectionObserver = ImmediateIntersectionObserver;

function render(ui: ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return container;
}

const pages: CoursePage[] = [
  { pageNumber: 1, text: '第一页', preview: 'data:image/png;base64,page1' },
  { pageNumber: 2, text: '第二页', preview: 'data:image/png;base64,page2' },
  { pageNumber: 3, text: '第三页' },
];

describe('continuous document preview', () => {
  it('一次渲染全部页面供原生滚轮连续浏览', () => {
    const onCurrentPageChange = vi.fn();
    const container = render(createElement(PagePreview, {
      pages,
      scale: 1,
      currentPage: 1,
      onCurrentPageChange,
    }));

    expect(container.querySelector('[data-testid="continuous-page-viewer"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-page-number]')).toHaveLength(3);
    expect(container.textContent).toContain('第 1 页');
    expect(container.textContent).toContain('第 2 页');
    expect(container.textContent).toContain('第 3 页');
  });

  it('缩略图导航不展示证据数量或证据状态', () => {
    const container = render(createElement(PageNavigator, {
      pages,
      currentPage: 1,
      showWarningOnly: false,
      searchHitPages: new Set<number>(),
      onPageSelect: vi.fn(),
    }));

    expect(container.textContent).not.toContain('条证据');
    expect(container.textContent).not.toContain('无证据');
  });

  it('工具栏不显示滚轮连续浏览提示', () => {
    const container = render(createElement(ReviewToolbar, {
      fileName: '课程.pdf',
      totalPages: 3,
      currentPage: 1,
      scale: 1,
      onPrevPage: vi.fn(),
      onNextPage: vi.fn(),
      onPageChange: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      onFitWidth: vi.fn(),
      onConfirm: vi.fn(),
      onBack: vi.fn(),
      hasModel: true,
    }));

    expect(container.textContent).not.toContain('滚轮连续浏览');
  });
});
