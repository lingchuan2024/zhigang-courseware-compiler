import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
