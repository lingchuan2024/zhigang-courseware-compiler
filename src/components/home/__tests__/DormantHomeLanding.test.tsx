import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DormantHomeLanding } from '../DormantHomeLanding';
import { RevealSection } from '../RevealSection';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

function button(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === name)!;
}

describe('RevealSection', () => {
  it('reveals immediately when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const container = render(createElement(RevealSection, null, 'chapter'));
    expect(container.firstElementChild?.getAttribute('data-revealed')).toBe('true');
  });

  it('reveals once when the section enters the viewport', () => {
    let callback: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', vi.fn((next: IntersectionObserverCallback) => {
      callback = next;
      return {
        observe: vi.fn(),
        disconnect,
        unobserve: vi.fn(),
        takeRecords: vi.fn(),
        root: null,
        rootMargin: '',
        thresholds: [0],
      };
    }));

    const container = render(createElement(RevealSection, null, 'chapter'));
    expect(container.firstElementChild?.getAttribute('data-revealed')).toBe('false');
    act(() => callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(container.firstElementChild?.getAttribute('data-revealed')).toBe('true');
    expect(disconnect).toHaveBeenCalled();
  });
});

describe('DormantHomeLanding', () => {
  it('presents the complete product story over the dormant backdrop', () => {
    const container = render(createElement(DormantHomeLanding, {
      onOpenLibrary: vi.fn(), onOpenQa: vi.fn(), onOpenSettings: vi.fn(),
    }));

    expect(container.querySelector('[data-astronomy-backdrop="dormant"]')).not.toBeNull();
    expect(container.querySelector('[data-home-nebula-veil]')?.className).toContain('rgba(1,2,7,.52)_86%');
    expect(container.textContent).toContain('让每一份课件，成为可探索的知识宇宙。');
    expect(container.textContent).toContain('知识结构');
    expect(container.textContent).toContain('知识卡片');
    expect(container.textContent).toContain('完整笔记');
    expect(container.textContent).toContain('全库知识问答');
    expect(container.textContent).toContain('导入课程材料');
    expect(container.textContent).toContain('你的知识宇宙，等待第一次观测。');
    expect(container.textContent).not.toContain('还没有被点亮的知识星');
  });

  it('exposes the library, QA, settings, and workflow actions', () => {
    const onOpenLibrary = vi.fn();
    const onOpenQa = vi.fn();
    const onOpenSettings = vi.fn();
    const container = render(createElement(DormantHomeLanding, { onOpenLibrary, onOpenQa, onOpenSettings }));

    act(() => button(container, '添加第一份课件').click());
    act(() => button(container, '全库知识问答').click());
    act(() => button(container, '服务配置').click());

    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
    expect(onOpenQa).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(container.querySelector('a[href="#workflow"]')).not.toBeNull();
  });
});
