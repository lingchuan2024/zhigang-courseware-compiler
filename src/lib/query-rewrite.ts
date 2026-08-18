import type { ModelConfig, RetrievalRecord } from '../types';
import type { CompiledPrompt } from './prompt-builder';
import { callChatCompletion } from './model-v2';

// 查询改写：把用户问题转写为若干个"词面贴近知识卡片术语"的检索查询，
// 供既有词法检索使用。任何失败（无 Key / 超时 / 解析失败）都降级为仅用原问题，
// 不改变既有问答行为。

/** 从检索记录提取术语词表（主题名 + 关键词 + 别名，去重限长）。 */
export function buildVocabulary(records: RetrievalRecord[], limit = 80): string[] {
  const seen = new Set<string>();
  const vocabulary: string[] = [];
  for (const record of records) {
    const candidates = [record.title, ...(record.keywords ?? []), ...(record.aliases ?? [])];
    for (const candidate of candidates) {
      const term = candidate.trim();
      if (!term || seen.has(term)) continue;
      seen.add(term);
      vocabulary.push(term);
      if (vocabulary.length >= limit) return vocabulary;
    }
  }
  return vocabulary;
}

/** 解析模型改写输出：最多 3 条、去重、去空、剔除与原问题重复的条目。 */
export function parseRewrittenQueries(raw: unknown, original: string): string[] {
  const data = raw as { queries?: unknown } | null;
  if (!data || !Array.isArray(data.queries)) return [];
  const originalTrimmed = original.trim();
  const queries: string[] = [];
  for (const item of data.queries) {
    if (typeof item !== 'string') continue;
    const query = item.trim().slice(0, 80);
    if (!query || query === originalTrimmed) continue;
    if (queries.some(existing => existing === query)) continue;
    queries.push(query);
    if (queries.length >= 3) break;
  }
  return queries;
}

export interface QueryRewriteResult {
  /** 实际用于检索的查询列表（首条恒为原始问题）。 */
  queries: string[];
  /** 模型改写是否成功生效。 */
  rewritten: boolean;
}

export type QueryRewriteCompleter = (
  config: ModelConfig,
  compiled: CompiledPrompt,
) => Promise<{ data: unknown }>;

const defaultCompleter: QueryRewriteCompleter = (config, compiled) =>
  callChatCompletion(config, compiled, 'query-rewrite', 8000);

function buildRewritePrompt(question: string, vocabulary: string[]): CompiledPrompt {
  const system = [
    '你是检索查询改写器。用户提出一个学习问题，你把它改写为 2-3 个用于关键词检索的查询。',
    '规则：',
    '- 优先使用术语词表中出现的词（检索是词面匹配，词表里的词命中率最高）',
    '- 每个查询是简短的名词短语或关键词组合，不要完整句子',
    '- 覆盖问题的不同问法与相关术语，不要同义重复',
    '- 只输出 JSON：{"queries": ["查询1", "查询2", "查询3"]}',
  ].join('\n');
  const user = [
    `用户问题：${question}`,
    '',
    '术语词表（优先从中选词）：',
    vocabulary.join('、'),
  ].join('\n');
  return {
    system,
    stablePrefix: 'query-rewrite-v1',
    dynamicInput: user,
    promptVersion: 'query-rewrite-v1',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
}

/**
 * 把问题改写为多个检索查询。无 Key 或任何失败时返回仅含原问题的结果。
 */
export async function rewriteQueryForRetrieval(
  config: ModelConfig | null | undefined,
  question: string,
  vocabulary: string[],
  options: { completer?: QueryRewriteCompleter } = {},
): Promise<QueryRewriteResult> {
  const trimmed = question.trim();
  if (!trimmed) return { queries: [], rewritten: false };
  if (!config?.apiKey || vocabulary.length === 0) {
    return { queries: [trimmed], rewritten: false };
  }

  try {
    const completer = options.completer ?? defaultCompleter;
    const { data } = await completer(config, buildRewritePrompt(trimmed, vocabulary));
    const rewritten = parseRewrittenQueries(data, trimmed);
    if (rewritten.length === 0) return { queries: [trimmed], rewritten: false };
    return { queries: [trimmed, ...rewritten], rewritten: true };
  } catch {
    // 改写是纯增强：失败即回退原问题，不向上抛
    return { queries: [trimmed], rewritten: false };
  }
}
