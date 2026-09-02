import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../types';
import type { CompiledPrompt } from '../prompt-builder';
import { callChatCompletion, verifyModelConfig } from '../model-v2';

const config: ModelConfig = {
  endpoint: '/api/ark-agent-plan/v3',
  model: 'glm-5-3-flash-260901',
  apiKey: 'agent-plan-test-key',
  apiMode: 'responses',
};

const prompt: CompiledPrompt = {
  system: 'Return JSON.',
  stablePrefix: 'Return JSON.',
  dynamicInput: 'Compile the course.',
  promptVersion: 'responses-test',
  messages: [
    { role: 'system', content: 'Return JSON.' },
    { role: 'user', content: 'Compile the course.' },
  ],
};

function responsesResponse(text: string, status: 'completed' | 'incomplete' = 'completed') {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      status,
      incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      }],
      usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Responses API transport', () => {
  it('sends Responses fields and parses output_text with Responses usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responsesResponse('{"units":[]}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callChatCompletion<{ units: unknown[] }>(
      config,
      prompt,
      'course-section-compile',
      1000,
    );

    expect(result.data).toEqual({ units: [] });
    expect(result.usage.promptTokens).toBe(12);
    expect(result.usage.completionTokens).toBe(8);
    expect(fetchMock).toHaveBeenCalledWith('/api/ark-agent-plan/v3/responses', expect.any(Object));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'glm-5-3-flash-260901',
      input: prompt.messages,
      max_output_tokens: 8192,
      text: { format: { type: 'json_object' } },
    });
    expect(body).not.toHaveProperty('messages');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('thinking');
  });

  it('uses a task-specific output limit when the prompt provides one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responsesResponse('{"units":[]}'));
    vi.stubGlobal('fetch', fetchMock);

    await callChatCompletion<{ units: unknown[] }>(
      config,
      { ...prompt, maxOutputTokens: 2048 } as CompiledPrompt,
      'course-section-compile',
      1000,
    );

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.max_output_tokens).toBe(2048);
  });

  it('retries once when Responses reports an incomplete output', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responsesResponse('{"units":[', 'incomplete'))
      .mockResolvedValueOnce(responsesResponse('{"units":[]}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callChatCompletion<{ units: unknown[] }>(
      config,
      prompt,
      'course-section-compile',
      1000,
    );

    expect(result.data).toEqual({ units: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not replay a lightweight extraction after truncated structured output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responsesResponse('{"topics":[', 'incomplete'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callChatCompletion(
      config,
      { ...prompt, maxStructuredAttempts: 1 } as CompiledPrompt,
      'course-section-compile',
      1000,
    )).rejects.toMatchObject({ code: 'response-truncated' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a reasoning-exhausted output budget with incomplete reason and usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [{ type: 'reasoning', summary: [] }],
        usage: { input_tokens: 812, output_tokens: 1024, total_tokens: 1836 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const error: Error & { code?: string } = await callChatCompletion(
      config,
      { ...prompt, maxStructuredAttempts: 1, maxOutputTokens: 1024 } as CompiledPrompt,
      'course-section-compile',
      1000,
    ).catch(err => err);

    expect(error.code).toBe('response-truncated');
    expect(error.message).toContain('推理耗尽输出预算');
    expect(error.message).toContain('max_output_tokens=1024');
    expect(error.message).toContain('incomplete_details.reason=max_output_tokens');
    expect(error.message).toContain('输出 1024');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('verifies Agent Plan through the Responses endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyModelConfig(config)).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith('/api/ark-agent-plan/v3/responses', expect.any(Object));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({
      model: 'glm-5-3-flash-260901',
      input: 'ping',
      max_output_tokens: 64,
    });
  });
});
