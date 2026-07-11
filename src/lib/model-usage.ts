// ========== DeepSeek / OpenAI Usage Tracking ==========

export type ModelTaskType =
  | 'topic-extraction'
  | 'topic-repair'
  | 'relation-extraction'
  | 'internal-structure'
  | 'note-generation'
  | 'note-repair'
  | 'topic-merge';

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

export function recordUsage(usage: ModelUsage): void {
  usageRecords.push(usage);
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

export function getUsageSummaryByTask(): TaskUsageSummary[] {
  const taskGroups = new Map<ModelTaskType, ModelUsage[]>();

  for (const record of usageRecords) {
    const group = taskGroups.get(record.taskType) || [];
    group.push(record);
    taskGroups.set(record.taskType, group);
  }

  const summaries: TaskUsageSummary[] = [];

  for (const [taskType, records] of taskGroups) {
    const callCount = records.length;
    const totalPromptTokens = records.reduce((sum, r) => sum + (r.promptTokens ?? 0), 0);
    const totalCompletionTokens = records.reduce((sum, r) => sum + (r.completionTokens ?? 0), 0);
    const totalCacheHitTokens = records.reduce((sum, r) => sum + (r.promptCacheHitTokens ?? 0), 0);
    const totalCacheMissTokens = records.reduce((sum, r) => sum + (r.promptCacheMissTokens ?? 0), 0);
    const totalDurationMs = records.reduce((sum, r) => sum + r.durationMs, 0);

    const overallCacheHitRate =
      totalCacheHitTokens + totalCacheMissTokens > 0
        ? totalCacheHitTokens / (totalCacheHitTokens + totalCacheMissTokens)
        : undefined;

    summaries.push({
      taskType,
      callCount,
      totalPromptTokens,
      totalCompletionTokens,
      totalCacheHitTokens,
      totalCacheMissTokens,
      overallCacheHitRate,
      totalDurationMs,
    });
  }

  return summaries;
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
      total_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_cache_miss_tokens?: number;
    };
  } | null;

  const usage = data?.usage;

  const promptTokens = usage?.prompt_tokens;
  const completionTokens = usage?.completion_tokens;
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
