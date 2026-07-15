import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store/useStore';
import { SettingsModal } from '../SettingsModal';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
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

beforeEach(() => {
  storage.clear();
  act(() => useStore.setState({ mineruConfig: null, modelConfig: null }));
});

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  document.body.innerHTML = '';
});

function renderModal(props: Partial<ComponentProps<typeof SettingsModal>> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const onClose = vi.fn();
  const onSaved = vi.fn();
  act(() => root.render(createElement(SettingsModal, {
    isOpen: true,
    onClose,
    onSaved,
    mode: 'resume-mineru',
    ...props,
  })));
  return { container, onClose, onSaved };
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('SettingsModal MinerU continuation', () => {
  it('keeps the modal open until MinerU credentials are valid', () => {
    const { container, onClose, onSaved } = renderModal();
    const save = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '保存并开始解析')!;
    act(() => save.click());
    expect(container.textContent).toContain('请填写 MinerU API 地址和 Token');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('saves valid MinerU configuration and reports readiness', () => {
    const { container, onClose, onSaved } = renderModal();
    const token = container.querySelector<HTMLInputElement>('input[placeholder="MinerU Token"]')!;
    setInput(token, 'token');
    const save = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '保存并开始解析')!;
    act(() => save.click());
    expect(useStore.getState().mineruConfig?.apiKey).toBe('token');
    expect(onSaved).toHaveBeenCalledWith({ mineruConfigured: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
