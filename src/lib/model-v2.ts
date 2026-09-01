import { ModelConfig, type ModelApiMode } from '../types';
import { type CompiledPrompt } from './prompt-builder';
import {
  type ModelTaskType,
  type CompletionResult,
  extractUsage,
  recordUsage,
} from './model-usage';
import { ExtractionError, ExtractionStage, inferErrorCode } from './extraction-errors';

// 通用JSON解析（处理代码围栏）
function parseJsonFromResponse(text: string): unknown {
  let cleaned = text.trim();
  // 去除markdown代码围栏
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  // 尝试找到第一个{或[
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
  } else if (firstBracket !== -1) {
    const lastBracket = cleaned.lastIndexOf(']');
    if (lastBracket > firstBracket) {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    }
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/** 瞬时错误（限流/服务端错误/网络中断）的最大重试次数，配合指数退避。 */
const TRANSIENT_RETRY_MAX = 2;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;

function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function getApiMode(config: ModelConfig): ModelApiMode {
  return config.apiMode ?? 'chat-completions';
}

function buildRequestUrl(config: ModelConfig): string {
  const endpoint = config.endpoint.trim().replace(/\/+$/, '');
  const suffix = getApiMode(config) === 'responses' ? '/responses' : '/chat/completions';
  return endpoint.endsWith(suffix) ? endpoint : `${endpoint}${suffix}`;
}

function buildCompletionBody(config: ModelConfig, compiled: CompiledPrompt): Record<string, unknown> {
  const maxOutputTokens = compiled.maxOutputTokens ?? 8192;
  if (getApiMode(config) === 'responses') {
    return {
      model: config.model,
      input: compiled.messages,
      max_output_tokens: maxOutputTokens,
      text: { format: { type: 'json_object' } },
    };
  }
  return {
    model: config.model,
    messages: compiled.messages,
    temperature: 0.2,
    max_tokens: maxOutputTokens,
    response_format: { type: 'json_object' },
  };
}

function extractResponsePayload(
  rawData: unknown,
  apiMode: ModelApiMode,
): { content: string; truncated: boolean } {
  if (apiMode === 'chat-completions') {
    const data = rawData as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    };
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      truncated: choice?.finish_reason === 'length',
    };
  }

  const data = rawData as {
    status?: string;
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };
  const content = data.output_text ?? data.output
    ?.filter(item => item.type === 'message')
    .flatMap(item => item.content ?? [])
    .filter(item => item.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('') ?? '';
  return { content, truncated: data.status === 'incomplete' };
}

async function fetchWithTransientRetry(
  url: string,
  config: ModelConfig,
  compiled: CompiledPrompt,
  timeout: number,
  stage: ExtractionStage | undefined,
  sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  let lastError: ExtractionError | null = null;
  let retryAfterMs: number | null = null;
  const maxTransportAttempts = Math.max(1, compiled.maxTransportAttempts ?? TRANSIENT_RETRY_MAX + 1);

  for (let attempt = 0; attempt < maxTransportAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(retryAfterMs ?? Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS));
      retryAfterMs = null;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(buildCompletionBody(config, compiled)),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const code = inferErrorCode(e);
      lastError = new ExtractionError(
        code,
        stage || 'unknown' as ExtractionStage,
        `连接模型服务失败（已重试 ${attempt} 次）：${message}`,
        { cause: e },
      );
      // 超时通常说明当前输入规模超过了本阶段的处理预算。重复发送完全相同的
      // 请求只会再次耗尽等待时间；交给上层按内容边界拆小后重试。
      if (code === 'api-timeout') throw lastError;
      continue;
    }

    if (response.ok) return response;

    const body = await response.text().catch(() => '');
    const proxyTimedOut = response.status === 504 && body.includes('agent-plan-proxy-timeout');
    const error = new ExtractionError(
      proxyTimedOut ? 'api-timeout' : response.status === 429 ? 'api-rate-limit' : 'api-http-error',
      stage || 'unknown' as ExtractionStage,
      `模型服务返回 ${response.status}（${response.statusText}）${body ? ` — ${body.substring(0, 200)}` : ''}`,
    );
    if (proxyTimedOut || !isTransientStatus(response.status) || attempt === maxTransportAttempts - 1) {
      throw error;
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      retryAfterMs = Math.min(retryAfter * 1000, BACKOFF_CAP_MS);
    }
    lastError = error;
  }

  throw lastError ?? new ExtractionError(
    'api-network',
    stage || 'unknown' as ExtractionStage,
    '连接模型服务失败',
  );
}

export async function callChatCompletion<T>(
  config: ModelConfig,
  compiled: CompiledPrompt,
  taskType: ModelTaskType,
  timeout: number = 90000,
  topicId?: string,
  stage?: ExtractionStage,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<CompletionResult<T>> {
  const apiMode = getApiMode(config);
  const url = buildRequestUrl(config);

  const startedAt = Date.now();
  const maxStructuredAttempts = Math.max(1, compiled.maxStructuredAttempts ?? 2);
  let lastStructuredError: ExtractionError | null = null;

  for (let attempt = 0; attempt < maxStructuredAttempts; attempt++) {
    const response = await fetchWithTransientRetry(url, config, compiled, timeout, stage, sleep);

    const rawData = await response.json();
    const payload = extractResponsePayload(rawData, apiMode);
    const rawContent = payload.content;
    const wasTruncated = payload.truncated;
    const parsed = rawContent ? parseJsonFromResponse(rawContent) : null;

    if (!wasTruncated && parsed !== null) {
      const usage = extractUsage(
        rawData,
        config.model,
        taskType,
        compiled.promptVersion,
        Date.now() - startedAt,
        topicId,
      );
      recordUsage(usage);
      return { data: parsed as T, usage };
    }

    const code = wasTruncated || !rawContent ? 'response-truncated' : 'json-parse-failed';
    const message = !rawContent
      ? apiMode === 'responses'
        ? 'API 返回的 output_text 为空'
        : 'API 返回的 choices[0].message.content 为空'
      : wasTruncated
        ? `模型输出达到长度上限，JSON 未完成（前 200 字符：${rawContent.substring(0, 200)}）`
        : `模型输出不是合法 JSON（前 200 字符：${rawContent.substring(0, 200)}）`;
    lastStructuredError = new ExtractionError(
      code,
      stage || 'unknown' as ExtractionStage,
      message,
      { rawResponse: rawContent.substring(0, 500) },
    );
  }

  throw lastStructuredError ?? new ExtractionError(
    'json-parse-failed',
    stage || 'unknown' as ExtractionStage,
    '模型未返回可解析的 JSON',
  );
}

export { validateModelConfig } from './model';

// ========== 保存前连通性验证 ==========

export interface ModelVerificationResult {
  ok: boolean;
  error?: string;
}

/**
 * 保存配置前验证模型可用性：按配置发送一次最小请求，只看 HTTP 状态，不解析内容。
 * - 200 / 429（限流=认证已通过）视为可用
 * - 401/403 判定 Key 无效；404 多为地址或模型名错误；其余按服务端错误提示
 * - 网络失败/超时给出针对性排查提示
 */
export async function verifyModelConfig(
  config: ModelConfig,
  timeoutMs = 15000,
): Promise<ModelVerificationResult> {
  const endpoint = config.endpoint.trim().replace(/\/+$/, '');
  const model = config.model.trim();
  const apiKey = config.apiKey.trim();
  if (!endpoint || !model || !apiKey) {
    return { ok: false, error: '请完整填写 API 地址、模型名称和 API Key' };
  }
  const apiMode = getApiMode(config);
  const url = buildRequestUrl({ ...config, endpoint, model, apiKey });
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(apiMode === 'responses'
        ? { model, input: 'ping', max_output_tokens: 64 }
        : { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok || response.status === 429) {
      return { ok: true };
    }
    const body = await response.text().catch(() => '');
    const detail = body ? `（${body.substring(0, 120)}）` : '';
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: `API Key 无效或被服务端拒绝（HTTP ${response.status}）${detail}` };
    }
    if (response.status === 404) {
      return { ok: false, error: `接口不存在或模型名错误（HTTP 404）${detail}，请检查 API 地址与模型名称` };
    }
    return { ok: false, error: `模型服务返回 HTTP ${response.status}${detail}` };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { ok: false, error: `连接超时（${Math.round(timeoutMs / 1000)} 秒），请检查 API 地址是否可达` };
    }
    return { ok: false, error: `无法连接模型服务：${error instanceof Error ? error.message : String(error)}` };
  }
}
