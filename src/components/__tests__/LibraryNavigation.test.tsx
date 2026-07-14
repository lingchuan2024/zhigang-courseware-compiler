import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../../App';
import { resetLibraryRepositoryForTests } from '../../lib/library-repository';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

let root: Root | null = null;
let container: HTMLElement | null = null;

function button(label: string): HTMLButtonElement {
  const match = Array.from(container!.querySelectorAll('button')).find(item => item.textContent?.includes(label));
  if (!match) throw new Error(`button not found: ${label}`);
  return match;
}

beforeEach(async () => {
  storage.clear();
  await resetLibraryRepositoryForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('multi-course library navigation', () => {
  it('starts at home, creates a course, and opens its upload workspace', async () => {
    await act(async () => root!.render(createElement(App)));
    expect(container!.textContent).toContain('从课件到知识网络');

    await act(async () => button('进入课件库').click());
    expect(container!.textContent).toContain('课程与课件');

    const input = container!.querySelector<HTMLInputElement>('input[placeholder="例如：机器学习"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '机器学习');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('创建课程').click());
    expect(container!.textContent).toContain('机器学习');

    await act(async () => button('添加课件').click());
    expect(container!.textContent).toContain('上传课件');
  });

  it('returns from the library to the start page', async () => {
    await act(async () => root!.render(createElement(App)));
    await act(async () => button('进入课件库').click());
    await act(async () => button('返回首页').click());
    expect(container!.textContent).toContain('从课件到知识网络');
  });
});
