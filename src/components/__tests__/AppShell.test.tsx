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
  it('keeps the header and child overlays in one foreground stacking context', () => {
    act(() => root.render(createElement(
      AppShell,
      {
        onHome: vi.fn(),
        backdrop: 'library',
        children: createElement('div', { 'data-test-overlay': true, className: 'fixed z-50' }, '课程空间'),
      },
    )));

    const shell = container.firstElementChild as HTMLElement;
    const foreground = container.querySelector<HTMLElement>('[data-app-shell-foreground]');
    const header = container.querySelector<HTMLElement>('header');
    const content = container.querySelector<HTMLElement>('[data-app-shell-content]');
    const overlay = container.querySelector<HTMLElement>('[data-test-overlay]');

    expect(container.querySelector('[data-astronomy-backdrop="library"]')).not.toBeNull();
    expect(content?.textContent).toContain('课程空间');
    expect(foreground?.classList.contains('relative')).toBe(true);
    expect(foreground?.classList.contains('z-10')).toBe(true);
    expect(foreground?.contains(header!)).toBe(true);
    expect(foreground?.contains(content!)).toBe(true);
    expect(foreground?.contains(overlay!)).toBe(true);
    expect(content?.classList.contains('z-10')).toBe(false);
    expect(shell.classList.contains('overflow-hidden')).toBe(false);
    expect(header?.classList.contains('bg-space-900/90')).toBe(true);
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
