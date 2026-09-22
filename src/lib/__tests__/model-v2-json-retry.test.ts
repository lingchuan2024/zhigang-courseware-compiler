import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../types';
import type { CompiledPrompt } from '../prompt-builder';
import { clearUsageRecords, getUsageRecords } from '../model-usage';
import { callChatCompletion } from '../model-v2';

const config: ModelConfig = {
  endpoint: 'https://api.example.com/v1',
  model: 'deepseek-chat',
  apiKey: 'test-key',
};

const prompt: CompiledPrompt = {
  system: 'Return JSON.',
  stablePrefix: 'Return JSON.',
  dynamicInput: 'Merge topics.',
  promptVersion: 'json-retry-test',
  messages: [
    { role: 'system', content: 'Return JSON.' },
    { role: 'user', content: 'Merge topics.' },
  ],
};

function response(content: string, finishReason: string) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      choices: [{ finish_reason: finishReason, message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('callChatCompletion JSON recovery', () => {
  it('retries once when the provider reports a truncated JSON response', async () => {
    clearUsageRecords();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('{"topics":[', 'length'))
      .mockResolvedValueOnce(response('{"topics":[]}', 'stop'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callChatCompletion<{ topics: unknown[] }>(
      config,
      prompt,
      'topic-merge',
      1000,
      undefined,
      'local-merge',
    );

    expect(getUsageRecords()).toHaveLength(2);
    expect(getUsageRecords().reduce((sum, item) => sum + (item.totalTokens ?? 0), 0)).toBe(40);
    expect(result.data).toEqual({ topics: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(firstRequest.max_tokens).toBeGreaterThanOrEqual(4096);
  });
  it('records both billed responses when JSON recovery is exhausted', async () => {
    clearUsageRecords();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('invalid', 'stop')));
    await expect(callChatCompletion(config, prompt, 'topic-merge')).rejects.toThrow();
    expect(getUsageRecords()).toHaveLength(2);
    expect(getUsageRecords().map(item => item.totalTokens)).toEqual([20, 20]);
  });

});
