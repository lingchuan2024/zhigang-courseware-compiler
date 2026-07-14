import { describe, expect, it } from 'vitest';
import type { KnowledgeCard } from '../../types';
import { buildRetrievalRecords, searchKnowledgeCards } from '../card-retrieval';

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
});
