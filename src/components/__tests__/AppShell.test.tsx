import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../AppShell';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AppShell', () => {
  it('renders library content above its astronomy backdrop', () => {
    act(() => root.render(createElement(
      AppShell,
      {
        onHome: vi.fn(),
        backdrop: 'library',
        children: createElement('p', null, '课程空间'),
      },
    )));

    const content = container.querySelector<HTMLElement>('[data-app-shell-content]');

    expect(container.querySelector('[data-astronomy-backdrop="library"]')).not.toBeNull();
    expect(content?.textContent).toContain('课程空间');
    expect(content?.classList.contains('relative')).toBe(true);
    expect(content?.classList.contains('z-10')).toBe(true);
  });

  it('keeps the brand home action when no backdrop is supplied', () => {
    const onHome = vi.fn();
    act(() => root.render(createElement(AppShell, {
      onHome,
      children: createElement('p', null, '内容'),
    })));

    const brand = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('知纲'))!;
    act(() => brand.click());

    expect(onHome).toHaveBeenCalledOnce();
  });
});
