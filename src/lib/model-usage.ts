// ========== DeepSeek / OpenAI Usage Tracking ==========

export type ModelTaskType =
  | 'topic-extraction'
  | 'topic-repair'
  | 'relation-extraction'
  | 'internal-structure'
  | 'note-generation'
  | 'note-repair'
  | 'topic-merge'
  | 'topic-candidate-extraction'
  | 'topic-granularity-judgment'
  | 'topic-quality-repair'
  | 'course-section-compile'
  | 'course-curriculum-review'
  | 'query-rewrite';

export interface ModelUsage {
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  totalTokens: number | undefined;
  promptCacheHitTokens: number | undefined;
  promptCacheMissTokens: number | undefined;
  cacheHitRate: number | undefined;
  durationMs: number;
  model: string;
  taskType: ModelTaskType;
  promptVersion: string;
  topicId?: string;
}

export interface CompletionResult<T> {
  data: T;
  usage: ModelUsage;
}

// ========== Usage Record Store ==========

const usageRecords: ModelUsage[] = [];

// ========== 累计用量持久化（跨会话，localStorage 小聚合，不含内容） ==========

const USAGE_STORAGE_KEY = 'zhigang_model_usage';

interface PersistedTaskAggregate {
  taskType: ModelTaskType;
  model: string;
  callCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCacheHitTokens: number;
  totalCacheMissTokens: number;
  totalDurationMs: number;
  updatedAt: number;
}

interface PersistedUsage {
  schemaVersion: 1;
  tasks: PersistedTaskAggregate[];
  updatedAt: number;
}

function readPersistedUsage(): PersistedUsage {
  try {
    const raw = localStorage.getItem(USAGE_STORAGE_KEY);
    if (!raw) return { schemaVersion: 1, tasks: [], updatedAt: 0 };
    const parsed = JSON.parse(raw) as PersistedUsage;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tasks)) {
      return { schemaVersion: 1, tasks: [], updatedAt: 0 };
    }
    return parsed;
  } catch {
    return { schemaVersion: 1, tasks: [], updatedAt: 0 };
  }
}

function writePersistedUsage(store: PersistedUsage): void {
  try {
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    console.warn('Failed to persist model usage:', error);
  }
}

function accumulateUsage(store: PersistedUsage, usage: ModelUsage): void {
  const existing = store.tasks.find(
    item => item.taskType === usage.taskType && item.model === usage.model,
  );
  if (existing) {
    existing.callCount += 1;
    existing.totalPromptTokens += usage.promptTokens ?? 0;
    existing.totalCompletionTokens += usage.completionTokens ?? 0;
    existing.totalCacheHitTokens += usage.promptCacheHitTokens ?? 0;
    existing.totalCacheMissTokens += usage.promptCacheMissTokens ?? 0;
    existing.totalDurationMs += usage.durationMs;
    existing.updatedAt = Date.now();
  } else {
    store.tasks.push({
      taskType: usage.taskType,
      model: usage.model,
      callCount: 1,
      totalPromptTokens: usage.promptTokens ?? 0,
      totalCompletionTokens: usage.completionTokens ?? 0,
      totalCacheHitTokens: usage.promptCacheHitTokens ?? 0,
      totalCacheMissTokens: usage.promptCacheMissTokens ?? 0,
      totalDurationMs: usage.durationMs,
      updatedAt: Date.now(),
    });
  }
  store.updatedAt = Date.now();
}

export function recordUsage(usage: ModelUsage): void {
  usageRecords.push(usage);
  const store = readPersistedUsage();
  accumulateUsage(store, usage);
  writePersistedUsage(store);
}

/** 清空累计用量统计（含本机持久化数据）。 */
export function resetUsageStats(): void {
  usageRecords.length = 0;
  try {
    localStorage.removeItem(USAGE_STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear model usage:', error);
  }
}

export function getUsageRecords(): ModelUsage[] {
  return [...usageRecords];
}

export function clearUsageRecords(): void {
  usageRecords.length = 0;
}

// ========== Aggregation ==========

export interface TaskUsageSummary {
  taskType: ModelTaskType;
  callCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCacheHitTokens: number;
  totalCacheMissTokens: number;
  overallCacheHitRate: number | undefined;
  totalDurationMs: number;
}

/** 按任务返回累计用量（跨会话持久化，而非仅本次运行）。 */
export function getUsageSummaryByTask(): TaskUsageSummary[] {
  return readPersistedUsage().tasks.map(item => ({
    taskType: item.taskType,
    callCount: item.callCount,
    totalPromptTokens: item.totalPromptTokens,
    totalCompletionTokens: item.totalCompletionTokens,
    totalCacheHitTokens: item.totalCacheHitTokens,
    totalCacheMissTokens: item.totalCacheMissTokens,
    overallCacheHitRate:
      item.totalCacheHitTokens + item.totalCacheMissTokens > 0
        ? item.totalCacheHitTokens / (item.totalCacheHitTokens + item.totalCacheMissTokens)
        : undefined,
    totalDurationMs: item.totalDurationMs,
  }));
}

// ========== Usage Extraction ==========

/**
 * Extract usage data from an OpenAI-compatible API response.
 * Handles DeepSeek-specific fields (prompt_cache_hit_tokens, prompt_cache_miss_tokens).
 * Does NOT error on missing fields — returns undefined for unsupported fields.
 */
export function extractUsage(
  responseData: unknown,
  model: string,
  taskType: ModelTaskType,
  promptVersion: string,
  durationMs: number,
  topicId?: string
): ModelUsage {
  const data = responseData as {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_cache_miss_tokens?: number;
    };
  } | null;

  const usage = data?.usage;

  const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens;
  const completionTokens = usage?.completion_tokens ?? usage?.output_tokens;
  const totalTokens = usage?.total_tokens;
  const promptCacheHitTokens = usage?.prompt_cache_hit_tokens;
  const promptCacheMissTokens = usage?.prompt_cache_miss_tokens;

  // Only compute cacheHitRate when both fields are present
  let cacheHitRate: number | undefined;
  if (
    promptCacheHitTokens !== undefined &&
    promptCacheMissTokens !== undefined &&
    promptCacheHitTokens + promptCacheMissTokens > 0
  ) {
    cacheHitRate =
      promptCacheHitTokens / (promptCacheHitTokens + promptCacheMissTokens);
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    promptCacheHitTokens,
    promptCacheMissTokens,
    cacheHitRate,
    durationMs,
    model,
    taskType,
    promptVersion,
    topicId,
  };
}

// ========== Formatting ==========

export function formatUsageForDisplay(usage: ModelUsage): string {
  const parts: string[] = [];
  parts.push(`Prompt: ${usage.promptTokens ?? 'N/A'} tokens`);
  if (usage.promptCacheHitTokens !== undefined) {
    parts.push(`缓存命中: ${usage.promptCacheHitTokens} tokens`);
  }
  if (usage.promptCacheMissTokens !== undefined) {
    parts.push(`缓存未命中: ${usage.promptCacheMissTokens} tokens`);
  }
  if (usage.cacheHitRate !== undefined) {
    parts.push(`命中率: ${(usage.cacheHitRate * 100).toFixed(1)}%`);
  }
  parts.push(`输出: ${usage.completionTokens ?? 'N/A'} tokens`);
  parts.push(`耗时: ${(usage.durationMs / 1000).toFixed(1)}s`);
  return parts.join(' | ');
}

export function formatSummaryForDisplay(summary: TaskUsageSummary): string {
  const rateStr = summary.overallCacheHitRate !== undefined
    ? `${(summary.overallCacheHitRate * 100).toFixed(1)}%`
    : 'N/A';
  return [
    `${summary.callCount} 次调用`,
    `Prompt: ${summary.totalPromptTokens} tokens`,
    `命中: ${summary.totalCacheHitTokens} tokens`,
    `未命中: ${summary.totalCacheMissTokens} tokens`,
    `命中率: ${rateStr}`,
    `输出: ${summary.totalCompletionTokens} tokens`,
    `耗时: ${(summary.totalDurationMs / 1000).toFixed(1)}s`,
  ].join(' | ');
}
