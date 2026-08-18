import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractUsage,
  recordUsage,
  getUsageRecords,
  clearUsageRecords,
  resetUsageStats,
  getUsageSummaryByTask,
  formatUsageForDisplay,
  formatSummaryForDisplay,
  type ModelUsage,
  type ModelTaskType,
} from '../model-usage';

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

describe('model-usage', () => {
  beforeEach(() => {
    resetUsageStats();
  });

  afterEach(() => {
    resetUsageStats();
  });

  describe('累计用量持久化', () => {
    it('清空内存记录后，累计汇总仍可从本机存储恢复', () => {
      const usage: ModelUsage = {
        promptTokens: 100, completionTokens: 40, totalTokens: 140,
        promptCacheHitTokens: 60, promptCacheMissTokens: 40, cacheHitRate: 0.6,
        durationMs: 1200, model: 'deepseek-chat', taskType: 'note-generation',
        promptVersion: 'v1',
      };
      recordUsage(usage);
      recordUsage(usage);

      // 模拟刷新：内存记录清空，仅剩持久化数据
      clearUsageRecords();
      expect(getUsageRecords()).toEqual([]);

      const summary = getUsageSummaryByTask();
      expect(summary).toHaveLength(1);
      expect(summary[0].callCount).toBe(2);
      expect(summary[0].totalPromptTokens).toBe(200);
      expect(summary[0].overallCacheHitRate).toBeCloseTo(0.6);

      resetUsageStats();
      expect(getUsageSummaryByTask()).toEqual([]);
    });
  });

  // Helper: build a DeepSeek-style API response
  const buildDeepSeekResponse = (overrides: Record<string, unknown> = {}) => ({
    id: 'chatcmpl-123',
    object: 'chat.completion',
    model: 'deepseek-chat',
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 20,
      ...overrides,
    },
  });

  // Helper: build a ModelUsage record
  const makeUsage = (overrides: Partial<ModelUsage> = {}): ModelUsage => ({
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    promptCacheHitTokens: 80,
    promptCacheMissTokens: 20,
    cacheHitRate: 0.8,
    durationMs: 1000,
    model: 'deepseek-chat',
    taskType: 'topic-extraction',
    promptVersion: 'v1',
    ...overrides,
  });

  // ============================================================
  // extractUsage
  // ============================================================
  describe('extractUsage', () => {
    it('correctly parses DeepSeek cache fields (prompt_cache_hit_tokens, prompt_cache_miss_tokens)', () => {
      const response = buildDeepSeekResponse({
        prompt_cache_hit_tokens: 75,
        prompt_cache_miss_tokens: 25,
      });

      const usage = extractUsage(response, 'deepseek-chat', 'topic-extraction', 'v1', 1234);

      expect(usage.promptCacheHitTokens).toBe(75);
      expect(usage.promptCacheMissTokens).toBe(25);
      expect(usage.promptTokens).toBe(100);
      expect(usage.completionTokens).toBe(50);
      expect(usage.totalTokens).toBe(150);
      expect(usage.model).toBe('deepseek-chat');
      expect(usage.taskType).toBe('topic-extraction');
      expect(usage.promptVersion).toBe('v1');
      expect(usage.durationMs).toBe(1234);
    });

    it('does not error when DeepSeek cache fields are missing', () => {
      const response = {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          // no cache fields
        },
      };

      expect(() => extractUsage(response, 'gpt-4', 'note-generation', 'v2', 500)).not.toThrow();

      const usage = extractUsage(response, 'gpt-4', 'note-generation', 'v2', 500);
      expect(usage.promptCacheHitTokens).toBeUndefined();
      expect(usage.promptCacheMissTokens).toBeUndefined();
    });

    it('does not error when usage object is entirely missing', () => {
      const response = { id: '123', model: 'gpt-4' };

      expect(() => extractUsage(response, 'gpt-4', 'note-generation', 'v2', 500)).not.toThrow();

      const usage = extractUsage(response, 'gpt-4', 'note-generation', 'v2', 500);
      expect(usage.promptTokens).toBeUndefined();
      expect(usage.completionTokens).toBeUndefined();
      expect(usage.totalTokens).toBeUndefined();
      expect(usage.cacheHitRate).toBeUndefined();
    });

    it('does not error when responseData is null', () => {
      expect(() => extractUsage(null, 'gpt-4', 'note-generation', 'v2', 500)).not.toThrow();

      const usage = extractUsage(null, 'gpt-4', 'note-generation', 'v2', 500);
      expect(usage.promptTokens).toBeUndefined();
      expect(usage.cacheHitRate).toBeUndefined();
    });

    it('cacheHitRate is undefined when cache fields are missing (NOT 0%)', () => {
      const response = {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          // no cache fields
        },
      };

      const usage = extractUsage(response, 'gpt-4', 'note-generation', 'v2', 500);

      expect(usage.cacheHitRate).toBeUndefined();
      // explicitly NOT 0 or 0% — missing data must not be confused with 0% hit rate
      expect(usage.cacheHitRate).not.toBe(0);
      expect(usage.cacheHitRate).not.toBe(0.0);
    });

    it('cacheHitRate is correctly computed when both fields present', () => {
      // 80 hit, 20 miss -> 0.8
      const r1 = buildDeepSeekResponse({ prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 });
      const u1 = extractUsage(r1, 'deepseek-chat', 'topic-extraction', 'v1', 1000);
      expect(u1.cacheHitRate).toBeCloseTo(0.8, 5);

      // 0 hit, 100 miss -> 0
      const r2 = buildDeepSeekResponse({ prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 });
      const u2 = extractUsage(r2, 'deepseek-chat', 'topic-extraction', 'v1', 1000);
      expect(u2.cacheHitRate).toBe(0);

      // 100 hit, 0 miss -> 1
      const r3 = buildDeepSeekResponse({ prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 0 });
      const u3 = extractUsage(r3, 'deepseek-chat', 'topic-extraction', 'v1', 1000);
      expect(u3.cacheHitRate).toBe(1);

      // 1 hit, 2 miss -> 1/3
      const r4 = buildDeepSeekResponse({ prompt_cache_hit_tokens: 1, prompt_cache_miss_tokens: 2 });
      const u4 = extractUsage(r4, 'deepseek-chat', 'topic-extraction', 'v1', 1000);
      expect(u4.cacheHitRate).toBeCloseTo(1 / 3, 5);
    });

    it('cacheHitRate is undefined when both cache fields are 0', () => {
      const response = buildDeepSeekResponse({
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 0,
      });

      const usage = extractUsage(response, 'deepseek-chat', 'topic-extraction', 'v1', 1000);

      expect(usage.promptCacheHitTokens).toBe(0);
      expect(usage.promptCacheMissTokens).toBe(0);
      // sum is 0, so rate is undefined (not 0%)
      expect(usage.cacheHitRate).toBeUndefined();
    });

    it('preserves topicId when provided', () => {
      const usage = extractUsage(
        buildDeepSeekResponse(),
        'deepseek-chat',
        'topic-extraction',
        'v1',
        1000,
        'topic-abc'
      );
      expect(usage.topicId).toBe('topic-abc');
    });

    it('topicId is undefined when not provided', () => {
      const usage = extractUsage(buildDeepSeekResponse(), 'deepseek-chat', 'topic-extraction', 'v1', 1000);
      expect(usage.topicId).toBeUndefined();
    });
  });

  // ============================================================
  // recordUsage / getUsageRecords / clearUsageRecords
  // ============================================================
  describe('recordUsage / getUsageRecords / clearUsageRecords', () => {
    it('recordUsage stores records and getUsageRecords retrieves them', () => {
      const u1 = makeUsage({ taskType: 'topic-extraction', durationMs: 1000 });
      const u2 = makeUsage({ taskType: 'note-generation', durationMs: 2000 });

      recordUsage(u1);
      recordUsage(u2);

      const records = getUsageRecords();
      expect(records).toHaveLength(2);
      expect(records[0]).toEqual(u1);
      expect(records[1]).toEqual(u2);
    });

    it('getUsageRecords returns a copy, not the internal array', () => {
      recordUsage(makeUsage());

      const records1 = getUsageRecords();
      records1.push(makeUsage({ taskType: 'note-generation' })); // mutate the copy

      const records2 = getUsageRecords();
      expect(records2).toHaveLength(1); // internal store unaffected by external mutation
    });

    it('clearUsageRecords empties the store', () => {
      recordUsage(makeUsage());
      recordUsage(makeUsage({ taskType: 'note-generation' }));
      expect(getUsageRecords()).toHaveLength(2);

      clearUsageRecords();
      expect(getUsageRecords()).toHaveLength(0);
    });

    it('clearUsageRecords on empty store does not error', () => {
      expect(() => clearUsageRecords()).not.toThrow();
      expect(getUsageRecords()).toHaveLength(0);
    });

    it('preserves insertion order across multiple records', () => {
      for (let i = 0; i < 5; i++) {
        recordUsage(makeUsage({ taskType: 'topic-extraction', durationMs: 1000 + i }));
      }
      const records = getUsageRecords();
      expect(records.map((r) => r.durationMs)).toEqual([1000, 1001, 1002, 1003, 1004]);
    });
  });

  // ============================================================
  // getUsageSummaryByTask
  // ============================================================
  describe('getUsageSummaryByTask', () => {
    it('aggregates records by task type correctly', () => {
      recordUsage(
        makeUsage({
          taskType: 'topic-extraction',
          promptTokens: 100,
          completionTokens: 50,
          promptCacheHitTokens: 80,
          promptCacheMissTokens: 20,
          durationMs: 1000,
        })
      );
      recordUsage(
        makeUsage({
          taskType: 'topic-extraction',
          promptTokens: 200,
          completionTokens: 100,
          promptCacheHitTokens: 60,
          promptCacheMissTokens: 40,
          durationMs: 2000,
        })
      );
      recordUsage(
        makeUsage({
          taskType: 'note-generation',
          promptTokens: 50,
          completionTokens: 30,
          promptCacheHitTokens: 10,
          promptCacheMissTokens: 90,
          durationMs: 500,
        })
      );

      const summaries = getUsageSummaryByTask();
      expect(summaries).toHaveLength(2);

      const topicSummary = summaries.find((s) => s.taskType === 'topic-extraction');
      expect(topicSummary).toBeDefined();
      expect(topicSummary!.callCount).toBe(2);
      expect(topicSummary!.totalPromptTokens).toBe(300);
      expect(topicSummary!.totalCompletionTokens).toBe(150);
      expect(topicSummary!.totalCacheHitTokens).toBe(140);
      expect(topicSummary!.totalCacheMissTokens).toBe(60);
      expect(topicSummary!.overallCacheHitRate).toBeCloseTo(140 / 200, 5);
      expect(topicSummary!.totalDurationMs).toBe(3000);

      const noteSummary = summaries.find((s) => s.taskType === 'note-generation');
      expect(noteSummary).toBeDefined();
      expect(noteSummary!.callCount).toBe(1);
      expect(noteSummary!.totalPromptTokens).toBe(50);
      expect(noteSummary!.totalCompletionTokens).toBe(30);
      expect(noteSummary!.totalCacheHitTokens).toBe(10);
      expect(noteSummary!.totalCacheMissTokens).toBe(90);
      expect(noteSummary!.overallCacheHitRate).toBeCloseTo(10 / 100, 5);
      expect(noteSummary!.totalDurationMs).toBe(500);
    });

    it('returns empty array when there are no records', () => {
      expect(getUsageSummaryByTask()).toEqual([]);
    });

    it('overallCacheHitRate is undefined when all cache tokens are 0', () => {
      recordUsage(makeUsage({ taskType: 'topic-extraction', promptCacheHitTokens: 0, promptCacheMissTokens: 0 }));
      recordUsage(makeUsage({ taskType: 'topic-extraction', promptCacheHitTokens: 0, promptCacheMissTokens: 0 }));

      const summaries = getUsageSummaryByTask();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].overallCacheHitRate).toBeUndefined();
    });

    it('handles mixed records (some with cache data, some without)', () => {
      // record WITH cache data
      recordUsage(
        makeUsage({
          taskType: 'topic-extraction',
          promptCacheHitTokens: 80,
          promptCacheMissTokens: 20,
          cacheHitRate: 0.8,
          promptTokens: 100,
          completionTokens: 50,
          durationMs: 1000,
        })
      );
      // record WITHOUT cache data (fields undefined)
      recordUsage(
        makeUsage({
          taskType: 'topic-extraction',
          promptCacheHitTokens: undefined,
          promptCacheMissTokens: undefined,
          cacheHitRate: undefined,
          promptTokens: 200,
          completionTokens: 80,
          durationMs: 2000,
        })
      );

      const summaries = getUsageSummaryByTask();
      expect(summaries).toHaveLength(1);

      const summary = summaries[0];
      expect(summary.callCount).toBe(2);
      expect(summary.totalPromptTokens).toBe(300);
      expect(summary.totalCompletionTokens).toBe(130);
      // missing cache fields treated as 0 in aggregation
      expect(summary.totalCacheHitTokens).toBe(80);
      expect(summary.totalCacheMissTokens).toBe(20);
      // overall rate computed from available cache data (80 / (80 + 20))
      expect(summary.overallCacheHitRate).toBeCloseTo(0.8, 5);
      expect(summary.totalDurationMs).toBe(3000);
    });

    it('overallCacheHitRate is undefined when ALL records lack cache data', () => {
      recordUsage(
        makeUsage({
          taskType: 'note-generation',
          promptCacheHitTokens: undefined,
          promptCacheMissTokens: undefined,
          cacheHitRate: undefined,
        })
      );
      recordUsage(
        makeUsage({
          taskType: 'note-generation',
          promptCacheHitTokens: undefined,
          promptCacheMissTokens: undefined,
          cacheHitRate: undefined,
        })
      );

      const summaries = getUsageSummaryByTask();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].overallCacheHitRate).toBeUndefined();
      expect(summaries[0].totalCacheHitTokens).toBe(0);
      expect(summaries[0].totalCacheMissTokens).toBe(0);
    });

    it('treats undefined prompt/completion tokens as 0 in aggregation', () => {
      recordUsage(
        makeUsage({
          taskType: 'topic-repair',
          promptTokens: undefined,
          completionTokens: undefined,
          totalTokens: undefined,
        })
      );
      recordUsage(
        makeUsage({
          taskType: 'topic-repair',
          promptTokens: 50,
          completionTokens: 25,
          totalTokens: 75,
        })
      );

      const summaries = getUsageSummaryByTask();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].totalPromptTokens).toBe(50);
      expect(summaries[0].totalCompletionTokens).toBe(25);
    });

    it('groups each task type separately', () => {
      const taskTypes: ModelTaskType[] = [
        'topic-extraction',
        'topic-repair',
        'relation-extraction',
        'internal-structure',
        'note-generation',
        'note-repair',
        'topic-merge',
      ];
      for (const tt of taskTypes) {
        recordUsage(makeUsage({ taskType: tt }));
      }

      const summaries = getUsageSummaryByTask();
      expect(summaries).toHaveLength(taskTypes.length);
      const summaryTypes = summaries.map((s) => s.taskType).sort();
      expect(summaryTypes).toEqual([...taskTypes].sort());
    });
  });

  // ============================================================
  // formatUsageForDisplay
  // ============================================================
  describe('formatUsageForDisplay', () => {
    it('produces readable output with cache data', () => {
      const usage: ModelUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        promptCacheHitTokens: 80,
        promptCacheMissTokens: 20,
        cacheHitRate: 0.8,
        durationMs: 1500,
        model: 'deepseek-chat',
        taskType: 'topic-extraction',
        promptVersion: 'v1',
      };

      const output = formatUsageForDisplay(usage);
      expect(output).toContain('Prompt: 100 tokens');
      expect(output).toContain('缓存命中: 80 tokens');
      expect(output).toContain('缓存未命中: 20 tokens');
      expect(output).toContain('命中率: 80.0%');
      expect(output).toContain('输出: 50 tokens');
      expect(output).toContain('耗时: 1.5s');
      expect(output).toContain(' | ');
    });

    it('produces readable output without cache data (omits cache lines)', () => {
      const usage: ModelUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        promptCacheHitTokens: undefined,
        promptCacheMissTokens: undefined,
        cacheHitRate: undefined,
        durationMs: 500,
        model: 'gpt-4',
        taskType: 'note-generation',
        promptVersion: 'v2',
      };

      const output = formatUsageForDisplay(usage);
      expect(output).toContain('Prompt: 100 tokens');
      expect(output).not.toContain('缓存命中');
      expect(output).not.toContain('缓存未命中');
      expect(output).not.toContain('命中率');
      expect(output).toContain('输出: 50 tokens');
      expect(output).toContain('耗时: 0.5s');
    });

    it('shows N/A for missing prompt/completion tokens', () => {
      const usage: ModelUsage = {
        promptTokens: undefined,
        completionTokens: undefined,
        totalTokens: undefined,
        promptCacheHitTokens: undefined,
        promptCacheMissTokens: undefined,
        cacheHitRate: undefined,
        durationMs: 1000,
        model: 'gpt-4',
        taskType: 'note-generation',
        promptVersion: 'v2',
      };

      const output = formatUsageForDisplay(usage);
      expect(output).toContain('Prompt: N/A tokens');
      expect(output).toContain('输出: N/A tokens');
    });

    it('formats cache hit rate with one decimal place', () => {
      const usage: ModelUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        promptCacheHitTokens: 1,
        promptCacheMissTokens: 2,
        cacheHitRate: 1 / 3,
        durationMs: 1000,
        model: 'deepseek-chat',
        taskType: 'topic-extraction',
        promptVersion: 'v1',
      };

      const output = formatUsageForDisplay(usage);
      expect(output).toContain('命中率: 33.3%');
    });

    it('formatSummaryForDisplay produces readable aggregated output', () => {
      recordUsage(
        makeUsage({
          taskType: 'topic-extraction',
          promptTokens: 100,
          completionTokens: 50,
          promptCacheHitTokens: 80,
          promptCacheMissTokens: 20,
          durationMs: 1500,
        })
      );
      const summaries = getUsageSummaryByTask();
      const output = formatSummaryForDisplay(summaries[0]);

      expect(output).toContain('1 次调用');
      expect(output).toContain('Prompt: 100 tokens');
      expect(output).toContain('命中: 80 tokens');
      expect(output).toContain('未命中: 20 tokens');
      expect(output).toContain('命中率: 80.0%');
      expect(output).toContain('输出: 50 tokens');
      expect(output).toContain('耗时: 1.5s');
    });
  });

  // ============================================================
  // Security: no API keys recorded in usage records
  // ============================================================
  describe('security: no API keys recorded in usage records', () => {
    const SECRET_KEY = 'sk-secret-api-key-1234567890abcdef';

    it('extractUsage does not capture API key / auth fields from response', () => {
      const response = {
        // simulate a response object that may carry sensitive material
        api_key: SECRET_KEY,
        apiKey: SECRET_KEY,
        authorization: `Bearer ${SECRET_KEY}`,
        headers: { 'x-api-key': SECRET_KEY },
        config: { apiKey: SECRET_KEY },
        secret: SECRET_KEY,
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_cache_hit_tokens: 80,
          prompt_cache_miss_tokens: 20,
        },
      };

      const usage = extractUsage(response, 'deepseek-chat', 'topic-extraction', 'v1', 1000);

      // No sensitive property should exist on the record
      expect(usage).not.toHaveProperty('api_key');
      expect(usage).not.toHaveProperty('apiKey');
      expect(usage).not.toHaveProperty('authorization');
      expect(usage).not.toHaveProperty('secret');

      // No string value should contain the secret
      for (const value of Object.values(usage)) {
        if (typeof value === 'string') {
          expect(value).not.toContain(SECRET_KEY);
        }
      }

      // Serialized form must not leak the key
      expect(JSON.stringify(usage)).not.toContain(SECRET_KEY);
    });

    it('recordUsage / getUsageRecords do not retain API key material', () => {
      const response = {
        api_key: SECRET_KEY,
        authorization: `Bearer ${SECRET_KEY}`,
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_cache_hit_tokens: 80,
          prompt_cache_miss_tokens: 20,
        },
      };

      const usage = extractUsage(response, 'deepseek-chat', 'topic-extraction', 'v1', 1000);
      recordUsage(usage);

      const records = getUsageRecords();
      expect(records).toHaveLength(1);
      expect(JSON.stringify(records)).not.toContain(SECRET_KEY);
    });

    it('ModelUsage record only contains expected fields (no key/auth fields)', () => {
      const usage = extractUsage(
        { usage: { prompt_tokens: 1 } },
        'deepseek-chat',
        'topic-extraction',
        'v1',
        1000
      );

      const expectedKeys = [
        'promptTokens',
        'completionTokens',
        'totalTokens',
        'promptCacheHitTokens',
        'promptCacheMissTokens',
        'cacheHitRate',
        'durationMs',
        'model',
        'taskType',
        'promptVersion',
        'topicId',
      ].sort();
      const actualKeys = Object.keys(usage).sort();
      expect(actualKeys).toEqual(expectedKeys);
    });
  });
});
