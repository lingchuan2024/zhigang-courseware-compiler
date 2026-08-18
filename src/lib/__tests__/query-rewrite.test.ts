import { describe, expect, it, vi } from 'vitest';
import type { ModelConfig, RetrievalRecord } from '../../types';
import {
  buildVocabulary,
  parseRewrittenQueries,
  rewriteQueryForRetrieval,
  type QueryRewriteCompleter,
} from '../query-rewrite';
import { searchKnowledgeCardsWithQueries } from '../card-retrieval';

function record(overrides: Partial<RetrievalRecord> & { cardId: string; title: string; keywords?: string[] }): RetrievalRecord {
  return {
    id: `rec-${overrides.cardId}`,
    courseId: 'course-1',
    documentId: 'doc-1',
    topicId: `topic-${overrides.cardId}`,
    teachingBlockId: `tb-${overrides.cardId}`,
    content: overrides.title,
    keywords: overrides.keywords ?? [],
    aliases: [],
    sourceRanges: [],
    version: 1,
    ...overrides,
  };
}

const config: ModelConfig = {
  endpoint: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'key',
};

describe('buildVocabulary', () => {
  it('合并主题名/关键词/别名并去重限长', () => {
    const records = [
      record({ cardId: 'a', title: '正则化', keywords: ['L2', '正则化', 'Ridge'] }),
      record({ cardId: 'b', title: 'Ridge', keywords: ['L2'], aliases: ['岭回归'] }),
    ];
    const vocabulary = buildVocabulary(records);
    expect(vocabulary).toEqual(['正则化', 'L2', 'Ridge', '岭回归']);
    expect(buildVocabulary(records, 3)).toHaveLength(3);
  });
});

describe('parseRewrittenQueries', () => {
  it('保留最多 3 条、去重、剔除空串与原问题', () => {
    const queries = parseRewrittenQueries(
      { queries: ['正则化 Ridge', '', '正则化 Ridge', '过拟合怎么防', 'L1 稀疏', '第四条', '过拟合怎么防'] },
      '过拟合怎么防',
    );
    expect(queries).toEqual(['正则化 Ridge', 'L1 稀疏', '第四条']);
  });

  it('非数组输出返回空', () => {
    expect(parseRewrittenQueries({ queries: '不是数组' }, 'q')).toEqual([]);
    expect(parseRewrittenQueries(null, 'q')).toEqual([]);
  });
});

describe('rewriteQueryForRetrieval', () => {
  it('无 Key 时直接返回原问题且不调用模型', async () => {
    const completer = vi.fn();
    const result = await rewriteQueryForRetrieval(null, '过拟合怎么防', ['正则化'], { completer });
    expect(result).toEqual({ queries: ['过拟合怎么防'], rewritten: false });
    expect(completer).not.toHaveBeenCalled();
  });

  it('改写成功时原问题排在首位', async () => {
    const completer: QueryRewriteCompleter = async () => ({
      data: { queries: ['正则化 Ridge Lasso', 'L1 稀疏解'] },
    });
    const result = await rewriteQueryForRetrieval(config, '过拟合怎么防', ['正则化'], { completer });
    expect(result.rewritten).toBe(true);
    expect(result.queries).toEqual(['过拟合怎么防', '正则化 Ridge Lasso', 'L1 稀疏解']);
  });

  it('模型失败时静默降级为原问题', async () => {
    const completer: QueryRewriteCompleter = async () => {
      throw new Error('api down');
    };
    const result = await rewriteQueryForRetrieval(config, '过拟合怎么防', ['正则化'], { completer });
    expect(result).toEqual({ queries: ['过拟合怎么防'], rewritten: false });
  });

  it('词表为空时不调用模型', async () => {
    const completer = vi.fn();
    const result = await rewriteQueryForRetrieval(config, '问题', [], { completer });
    expect(result.rewritten).toBe(false);
    expect(completer).not.toHaveBeenCalled();
  });
});

describe('多查询检索合并（改写验收）', () => {
  const records = [
    record({ cardId: 'reg', title: '正则化目标函数', keywords: ['正则化', 'Ridge', 'Lasso', 'L1', 'L2'] }),
    record({ cardId: 'mle', title: '似然函数与MLE', keywords: ['最大似然估计', 'MLE'] }),
  ];

  it('原问题词面零重叠查不到，加入改写查询后命中', () => {
    // 原问题只有"过拟合怎么防"，与卡片词面无任何重叠
    const single = searchKnowledgeCardsWithQueries(['过拟合怎么防'], [], records, { limit: 8 });
    expect(single.map(hit => hit.record.cardId)).toEqual([]);

    const merged = searchKnowledgeCardsWithQueries(
      ['过拟合怎么防', '正则化 Ridge Lasso', 'L1 稀疏解'],
      [],
      records,
      { limit: 8 },
    );
    expect(merged.map(hit => hit.record.cardId)).toContain('reg');
    // 词面无关的卡片不会被牵连进来
    expect(merged.map(hit => hit.record.cardId)).not.toContain('mle');
  });

  it('同卡片多查询命中时保留最高分且不重复', () => {
    const merged = searchKnowledgeCardsWithQueries(
      ['正则化', 'Ridge Lasso 正则化'],
      [],
      records,
      { limit: 8 },
    );
    const ids = merged.map(hit => hit.record.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('reg');
  });
});
