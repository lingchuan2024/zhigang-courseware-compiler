import { ModelConfig } from '../types';
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

  for (let attempt = 0; attempt <= TRANSIENT_RETRY_MAX; attempt++) {
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
        body: JSON.stringify({
          model: config.model,
          messages: compiled.messages,
          temperature: 0.2,
          max_tokens: 8192,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      lastError = new ExtractionError(
        inferErrorCode(e),
        stage || 'unknown' as ExtractionStage,
        `连接模型服务失败（已重试 ${attempt} 次）：${message}`,
        { cause: e },
      );
      continue;
    }

    if (response.ok) return response;

    const body = await response.text().catch(() => '');
    const error = new ExtractionError(
      response.status === 429 ? 'api-rate-limit' : 'api-http-error',
      stage || 'unknown' as ExtractionStage,
      `模型服务返回 ${response.status}（${response.statusText}）${body ? ` — ${body.substring(0, 200)}` : ''}`,
    );
    if (!isTransientStatus(response.status) || attempt === TRANSIENT_RETRY_MAX) {
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
  const endpoint = config.endpoint.replace(/\/$/, '');
  const url = endpoint.endsWith('/chat/completions')
    ? endpoint
    : `${endpoint}/chat/completions`;

  const startedAt = Date.now();
  const maxStructuredAttempts = 2;
  let lastStructuredError: ExtractionError | null = null;

  for (let attempt = 0; attempt < maxStructuredAttempts; attempt++) {
    const response = await fetchWithTransientRetry(url, config, compiled, timeout, stage, sleep);

    const rawData = await response.json();
    const choice = rawData.choices?.[0];
    const rawContent: string = choice?.message?.content || '';
    const wasTruncated = choice?.finish_reason === 'length';
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
      ? 'API 返回的 choices[0].message.content 为空'
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
