import { describe, expect, it } from 'vitest';
import type { KnowledgeCard } from '../../types';
import {
  buildRetrievalRecords,
  searchKnowledgeCards,
  searchKnowledgeCardsWithContext,
} from '../card-retrieval';

function card(id: string, courseId: string, title: string, detail: string): KnowledgeCard {
  return {
    id, courseId, topicId: `${courseId}-topic`, topicName: title, teachingBlockId: `${id}-block`, teachingType: 'concept',
    title, conciseSummary: detail, detailedNote: detail, sourceRanges: [], keywords: title.split(/\s+/), aliases: [],
    prerequisiteTopicIds: [], relatedTopicIds: [], confidence: 0.9, reviewStatus: 'generated', cardVersion: 1,
  };
}

describe('knowledge card retrieval', () => {
  it('ranks the most relevant card and preserves its source index', () => {
    const records = [
      ...buildRetrievalRecords([card('card-glm', 'course-ml', 'GLM 公式', '广义线性模型包含随机成分、系统成分和连接函数')], 'lecture-1'),
      ...buildRetrievalRecords([card('card-tree', 'course-ml', '决策树', '通过信息增益选择划分')], 'lecture-2'),
    ];
    const hits = searchKnowledgeCards('GLM 的组成是什么', records);

    expect(hits[0].record.cardId).toBe('card-glm');
    expect(hits[0].record.documentId).toBe('lecture-1');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('filters retrieval records by course', () => {
    const records = [
      ...buildRetrievalRecords([card('card-a', 'course-a', '最大似然', '最大化似然函数')], 'doc-a'),
      ...buildRetrievalRecords([card('card-b', 'course-b', '最大似然', '概率统计中的参数估计')], 'doc-b'),
    ];
    const hits = searchKnowledgeCards('最大似然', records, { courseIds: ['course-b'] });
    expect(hits.map(hit => hit.record.cardId)).toEqual(['card-b']);
  });

  it('expands a lexical hit to cards in directly related topics', () => {
    const primary = card('card-glm', 'course-ml', 'GLM 公式', '广义线性模型的三个组成部分');
    primary.topicId = 'topic-glm';
    primary.relatedTopicIds = ['topic-link'];
    const neighbor = card('card-link', 'course-ml', '连接函数选择', '把均值参数映射到线性预测子');
    neighbor.topicId = 'topic-link';
    const records = buildRetrievalRecords([primary, neighbor], 'lecture-1');

    const hits = searchKnowledgeCards('GLM 的组成是什么', records);

    expect(hits.map(hit => hit.record.cardId)).toEqual(['card-glm', 'card-link']);
    expect(hits[1].origin).toBe('graph');
  });

  it('indexes structured card details and source excerpts', () => {
    const enriched = card('card-rich', 'course-ml', '指数分布族', '统一表示多种概率分布');
    enriched.keyPoints = ['自然参数', '充分统计量'];
    enriched.applicableConditions = ['分布可写成指数族标准形式'];
    enriched.examples = ['伯努利分布'];
    enriched.selfCheckQuestions = ['如何判断一个分布属于指数族？'];
    enriched.sourceExcerpt = '课件原文：指数族可以写成 h(x)exp(ηT(x)-A(η))。';

    const [record] = buildRetrievalRecords([enriched], 'lecture-1');

    expect(record.content).toContain('自然参数');
    expect(record.content).toContain('伯努利分布');
    expect(record.sourceExcerpt).toContain('课件原文');
  });

  it('ranks every current Bayes hit above stale GLM and Poisson history hits', () => {
    const records = [
      ...buildRetrievalRecords([card('card-bayes', 'course-bayes', 'Bayes 定理', 'Bayes 后验概率')], 'doc-bayes'),
      ...buildRetrievalRecords([card('card-glm', 'course-glm', 'GLM', 'GLM 广义线性模型')], 'doc-glm'),
      ...buildRetrievalRecords([card('card-poisson', 'course-poisson', 'Poisson', 'Poisson 分布')], 'doc-poisson'),
      ...buildRetrievalRecords([card('card-shared', 'course-bayes', 'Bayes 公式', 'Bayes 当前来源')], 'doc-current-shared'),
      ...buildRetrievalRecords([card('card-shared', 'course-glm', 'GLM 旧内容', 'GLM 历史来源')], 'doc-history-shared'),
    ];
    const currentHits = searchKnowledgeCards('Bayes', records, { limit: 5 });
    const hits = searchKnowledgeCardsWithContext(
      'Bayes',
      [
        { role: 'user', content: 'GLM' },
        { role: 'assistant', content: 'Poisson 是下一步指令' },
        { role: 'user', content: 'Poisson' },
      ],
      records,
      { limit: 5 },
    );

    expect(hits.slice(0, currentHits.length).map(hit => hit.record.cardId)).toEqual(
      currentHits.map(hit => hit.record.cardId),
    );
    expect(hits.map(hit => hit.record.cardId)).toContain('card-glm');
    expect(hits.map(hit => hit.record.cardId)).toContain('card-poisson');
    expect(hits.find(hit => hit.record.cardId === 'card-shared')?.record.documentId).toBe('doc-current-shared');
    const historyOnlyHits = hits.slice(currentHits.length);
    expect(historyOnlyHits).toHaveLength(2);
    expect(historyOnlyHits.every(hit => hit.score < Math.min(...currentHits.map(current => current.score)))).toBe(true);
  });
});
