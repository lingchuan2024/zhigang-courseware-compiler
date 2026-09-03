import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store/useStore';
import { SettingsModal } from '../SettingsModal';

const verifyMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/model-v2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/model-v2')>();
  return { ...actual, verifyModelConfig: verifyMock };
});

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
  verifyMock.mockReset();
  verifyMock.mockResolvedValue({ ok: true });
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

function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('SettingsModal MinerU continuation', () => {
  it('links to the official MinerU token page and describes the free quota accurately', () => {
    const { container } = renderModal();
    const link = Array.from(container.querySelectorAll('a'))
      .find(anchor => anchor.textContent?.includes('免费申请 MinerU Token'));

    expect(link?.getAttribute('href')).toBe('https://mineru.net/apiManage/token');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noreferrer');
    expect(container.textContent).toContain('每日免费高优先级解析额度');
    expect(container.textContent).toContain('具体以官网为准');
  });

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

describe('SettingsModal model provider presets', () => {
  it('renders the provider presets with DeepSeek defaults', () => {
    const { container } = renderModal({ mode: 'default' });
    const provider = container.querySelector<HTMLSelectElement>('[aria-label="API 平台"]');

    expect(provider).not.toBeNull();
    expect(Array.from(provider!.options, option => option.textContent)).toEqual([
      'DeepSeek',
      '阿里云百炼',
      '模力方舟（Gitee AI）',
      '智谱 BigModel',
      'Kimi',
      '火山方舟',
      '火山方舟 Agent Plan',
      '硅基流动',
      'OpenAI',
      'OpenRouter',
      '自定义',
    ]);
    expect(provider!.value).toBe('deepseek');
    expect(container.querySelector<HTMLInputElement>('[aria-label="知识生成 API 地址"]')?.value).toBe('https://api.deepseek.com');
    expect(container.querySelector<HTMLInputElement>('[aria-label="知识生成模型名称"]')?.value).toBe('deepseek-v4-flash');
    expect(container.querySelector<HTMLInputElement>('[aria-label="知识生成模型名称"]')?.placeholder).toBe('deepseek-v4-flash');
  });

  it('applies modelark values while retaining the key and shows its official key link', () => {
    const { container } = renderModal({ mode: 'default' });
    const apiKey = container.querySelector<HTMLInputElement>('#knowledge-model-api-key')!;
    const provider = container.querySelector<HTMLSelectElement>('[aria-label="API 平台"]')!;
    setInput(apiKey, 'modelark-key');
    setSelect(provider, 'modelark');

    expect(container.querySelector<HTMLInputElement>('[aria-label="知识生成 API 地址"]')?.value).toBe('https://ai.gitee.com/v1');
    const model = container.querySelector<HTMLInputElement>('[aria-label="知识生成模型名称"]')!;
    expect(model.value).toBe('GLM-5');
    expect(apiKey.value).toBe('modelark-key');
    setInput(model, 'Qwen3.8-Plus');
    expect(provider.value).toBe('modelark');

    const link = container.querySelector<HTMLAnchorElement>('[data-testid="model-api-key-link"]')!;
    expect(link.textContent).toContain('模力方舟（Gitee AI）');
    expect(link.href).toBe('https://ai.gitee.com/products/apis');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.rel).toContain('noreferrer');
  });

  it('switches to custom when the endpoint does not match a preset', () => {
    const { container } = renderModal({ mode: 'default' });
    const endpoint = container.querySelector<HTMLInputElement>('[aria-label="知识生成 API 地址"]')!;
    setInput(endpoint, 'https://models.example.com/v1');

    expect(container.querySelector<HTMLSelectElement>('[aria-label="API 平台"]')?.value).toBe('custom');
    expect(container.querySelector('[data-testid="model-api-key-link"]')).toBeNull();
    expect(container.textContent).toContain('使用任意 OpenAI-compatible 服务，并手动填写地址与模型名称。');
  });

  it('keeps custom configuration when custom is explicitly selected and describes its hint', () => {
    const { container } = renderModal({ mode: 'default' });
    const provider = container.querySelector<HTMLSelectElement>('[aria-label="API 平台"]')!;
    const endpoint = container.querySelector<HTMLInputElement>('[aria-label="知识生成 API 地址"]')!;
    const model = container.querySelector<HTMLInputElement>('[aria-label="知识生成模型名称"]')!;
    const apiKey = container.querySelector<HTMLInputElement>('#knowledge-model-api-key')!;
    setInput(endpoint, 'https://models.example.com/v1');
    setInput(model, 'custom-model');
    setInput(apiKey, 'custom-key');
    setSelect(provider, 'custom');

    expect(endpoint.value).toBe('https://models.example.com/v1');
    expect(model.value).toBe('custom-model');
    expect(apiKey.value).toBe('custom-key');
    expect(provider.getAttribute('aria-describedby')).toBe('model-provider-hint');
    expect(container.querySelector('#model-provider-hint')).not.toBeNull();
  });

  it('recognizes DeepSeek again when its endpoint is restored after an unknown endpoint', () => {
    const { container } = renderModal({ mode: 'default' });
    const endpoint = container.querySelector<HTMLInputElement>('[aria-label="知识生成 API 地址"]')!;
    setInput(endpoint, 'https://models.example.com/v1');
    setInput(endpoint, 'https://api.deepseek.com/');

    expect(container.querySelector<HTMLSelectElement>('[aria-label="API 平台"]')?.value).toBe('deepseek');
    expect(container.querySelector('#model-provider-hint')?.textContent).toContain('默认使用 DeepSeek V4 Flash');
    expect(container.querySelector<HTMLAnchorElement>('[data-testid="model-api-key-link"]')?.href)
      .toBe('https://platform.deepseek.com/api_keys');
  });

  it('recognizes a stored Kimi endpoint with a trailing slash', () => {
    act(() => useStore.setState({
      modelConfig: { endpoint: 'https://api.moonshot.cn/v1/', model: 'kimi-k2.6', apiKey: 'kimi-key' },
    }));
    const { container } = renderModal({ mode: 'default' });

    expect(container.querySelector<HTMLSelectElement>('[aria-label="API 平台"]')?.value).toBe('kimi');
    expect(container.querySelector<HTMLAnchorElement>('[data-testid="model-api-key-link"]')?.href)
      .toBe('https://platform.kimi.com/console/api-keys');
  });

  it('saves chat-completions mode with an existing provider', async () => {
    const { container } = renderModal({ mode: 'default' });
    setSelect(container.querySelector<HTMLSelectElement>('[aria-label="API 平台"]')!, 'modelark');
    setInput(container.querySelector<HTMLInputElement>('#knowledge-model-api-key')!, 'modelark-key');
    const save = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '保存配置')!;
    await act(async () => save.click());

    expect(verifyMock).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://ai.gitee.com/v1',
      model: 'GLM-5',
      apiKey: 'modelark-key',
    }));
    expect(useStore.getState().modelConfig).toStrictEqual({
      endpoint: 'https://ai.gitee.com/v1',
      model: 'GLM-5',
      apiKey: 'modelark-key',
      apiMode: 'chat-completions',
    });
  });

  it('selects Agent Plan as a Responses provider with its exact model id', async () => {
    const { container } = renderModal({ mode: 'default' });
    setSelect(
      container.querySelector<HTMLSelectElement>('[aria-label="API 平台"]')!,
      'volcengine-agent-plan',
    );
    setInput(container.querySelector<HTMLInputElement>('#knowledge-model-api-key')!, 'agent-plan-test-key');

    expect(container.querySelector<HTMLInputElement>('[aria-label="知识生成 API 地址"]')?.value)
      .toBe('/api/ark-agent-plan/v3');
    expect(container.querySelector<HTMLInputElement>('[aria-label="知识生成模型名称"]')?.value)
      .toBe('glm-5-3-flash-260901');
    expect(container.querySelector('#model-provider-hint')?.textContent).toContain('Responses');

    const save = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '保存配置')!;
    await act(async () => save.click());

    expect(verifyMock).toHaveBeenCalledWith({
      endpoint: '/api/ark-agent-plan/v3',
      model: 'glm-5-3-flash-260901',
      apiKey: 'agent-plan-test-key',
      apiMode: 'responses',
    });
  });
});

describe('SettingsModal model verification on save', () => {
  it('blocks saving and surfaces the rejection reason when the key is rejected', async () => {
    verifyMock.mockResolvedValueOnce({ ok: false, error: 'API Key 无效或被服务端拒绝（HTTP 401）' });
    const { container, onClose, onSaved } = renderModal({ mode: 'default' });
    setInput(container.querySelector<HTMLInputElement>('#knowledge-model-api-key')!, 'bad-key');
    const save = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '保存配置')!;
    await act(async () => save.click());

    expect(container.querySelector('[data-testid="model-verify-error"]')?.textContent)
      .toContain('API Key 无效或被服务端拒绝（HTTP 401）');
    expect(useStore.getState().modelConfig).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('saves and closes after verification passes with the trimmed config', async () => {
    const { container, onClose } = renderModal({ mode: 'default' });
    const key = container.querySelector<HTMLInputElement>('#knowledge-model-api-key')!;
    setInput(key, '  good-key  ');
    const save = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '保存配置')!;
    await act(async () => save.click());

    expect(verifyMock).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiKey: 'good-key',
    }));
    expect(useStore.getState().modelConfig?.apiKey).toBe('good-key');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears the verification error when the key is edited after a failure', async () => {
    verifyMock.mockResolvedValueOnce({ ok: false, error: 'API Key 无效或被服务端拒绝（HTTP 401）' });
    const { container } = renderModal({ mode: 'default' });
    const key = container.querySelector<HTMLInputElement>('#knowledge-model-api-key')!;
    setInput(key, 'bad-key');
    const save = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '保存配置')!;
    await act(async () => save.click());
    expect(container.querySelector('[data-testid="model-verify-error"]')).not.toBeNull();

    setInput(key, 'another-key');
    expect(container.querySelector('[data-testid="model-verify-error"]')).toBeNull();
  });

  it('skips verification when no API key is filled', async () => {
    const { container, onClose } = renderModal({ mode: 'default' });
    const save = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '保存配置')!;
    await act(async () => save.click());

    expect(verifyMock).not.toHaveBeenCalled();
    expect(useStore.getState().modelConfig).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
