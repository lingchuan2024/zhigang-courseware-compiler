import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../types';
import type { CompiledPrompt } from '../prompt-builder';
import { callChatCompletion } from '../model-v2';
import { resetUsageStats } from '../model-usage';

const localStorageValues = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
    removeItem: (key: string) => localStorageValues.delete(key),
    clear: () => localStorageValues.clear(),
  },
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }],
    usage: {},
  }), { status, headers: { 'Content-Type': 'application/json' } });
}

const config: ModelConfig = {
  endpoint: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'test-key',
};

const compiled: CompiledPrompt = {
  system: 's',
  stablePrefix: 'p',
  dynamicInput: 'd',
  promptVersion: 'test-v1',
  messages: [{ role: 'user', content: 'hello' }],
};

function makePrompt(): CompiledPrompt {
  return { ...compiled };
}

beforeEach(() => {
  resetUsageStats();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('callChatCompletion 瞬时错误退避', () => {
  it('429 后按指数退避重试并成功', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await callChatCompletion(config, makePrompt(), 'topic-merge', 5000, undefined, undefined, sleep);

    expect(result.data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1000]);
  });

  it('5xx 连续失败时最多重试 2 次后抛出结构化错误', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const fetchMock = vi.fn()
      .mockResolvedValue(new Response('boom', { status: 503 }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callChatCompletion(config, makePrompt(), 'topic-merge', 5000, undefined, 'relation-extraction', sleep),
    ).rejects.toMatchObject({ code: 'api-http-error', stage: 'relation-extraction' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('allows latency-sensitive prompts to disable transport replay', async () => {
    const sleeps: number[] = [];
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callChatCompletion(
      config,
      { ...makePrompt(), maxTransportAttempts: 1 },
      'topic-merge',
      5000,
      undefined,
      'section-compile',
      async ms => { sleeps.push(ms); },
    )).rejects.toMatchObject({ code: 'api-http-error' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('非瞬时状态码（401）不重试，直接抛出', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const fetchMock = vi.fn()
      .mockResolvedValue(new Response('unauthorized', { status: 401 }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callChatCompletion(config, makePrompt(), 'topic-merge', 5000, undefined, undefined, sleep),
    ).rejects.toMatchObject({ code: 'api-http-error' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('代理 504 被识别为超时并立即交给上层拆批', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'agent-plan-proxy-timeout',
      message: 'Agent Plan proxy request timed out',
    }), { status: 504, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callChatCompletion(config, makePrompt(), 'topic-merge', 5000, undefined, 'section-compile', sleep),
    ).rejects.toMatchObject({ code: 'api-timeout', stage: 'section-compile' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('网络中断重试后成功，错误消息包含重试次数', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse({ value: 1 }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await callChatCompletion(config, makePrompt(), 'topic-merge', 5000, undefined, undefined, sleep);

    expect(result.data).toEqual({ value: 1 });
    expect(sleeps).toEqual([1000]);
  });

  it('请求超时不在传输层盲目重试', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const fetchMock = vi.fn().mockRejectedValue(timeout);

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callChatCompletion(config, makePrompt(), 'topic-merge', 5000, undefined, 'section-compile', sleep),
    ).rejects.toMatchObject({ code: 'api-timeout', stage: 'section-compile' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('429 携带 Retry-After 时优先按其等待', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '7' },
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    vi.stubGlobal('fetch', fetchMock);

    await callChatCompletion(config, makePrompt(), 'topic-merge', 5000, undefined, undefined, sleep);

    expect(sleeps).toEqual([7000]);
  });

  it('HTTP 错误消息为中文并可读', async () => {
    const sleep = async () => {};
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('quota exceeded', { status: 402 })));

    const error = await callChatCompletion(config, makePrompt(), 'topic-merge', 5000, undefined, undefined, sleep)
      .catch(err => err);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('模型服务返回 402');
  });
});
