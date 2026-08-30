import { describe, expect, it } from 'vitest';
import type { ModelConfig, SourceDocument } from '../../../types';
import { compileCourseStructure } from '../compiler';
import { buildSectionBatches } from '../section-batching';
import type { SectionCompilation } from '../types';

const config: ModelConfig = { endpoint: 'x', model: 'm', apiKey: 'k' };

function document(id: string, content: string): SourceDocument {
  return {
    id,
    courseId: 'course-1',
    title: id,
    markdown: content,
    blocks: [{
      id: `${id}-b1`, documentId: id, type: 'paragraph', content,
      headingPath: [id], orderIndex: 0, contentHash: `${id}-h1`,
    }],
    outline: [],
    contentHash: `${id}-hash`,
    createdAt: '',
    updatedAt: '',
  };
}

describe('course structure compiler integration', () => {
  it('compiles two document-safe batches without adding calls per topic', async () => {
    const documents = [
      document('d1', '似然函数用于最大似然估计。'),
      document('d2', '对数似然便于优化计算。'),
    ];
    const seenDocumentIds: string[] = [];
    let batchCallCount = 0;
    const result = await compileCourseStructure(config, documents, 'course-1', {
      compileBatch: async batch => {
        batchCallCount += 1;
        seenDocumentIds.push(batch.documentId);
        const shared = { blockId: batch.blocks[0].id, quote: batch.blocks[0].content, role: 'definition' as const };
        const compilation: SectionCompilation = batch.documentId === 'd1'
          ? {
            batchId: batch.id,
            sectionIds: batch.sectionIds,
            topicMentions: [
              { localId: `${batch.id}:likelihood`, name: '似然函数', aliases: [], learningObjective: '解释似然函数', scope: '参数估计', genre: 'concept', difficulty: 1, importance: 'core', evidence: [shared], confidence: 0.9 },
              { localId: `${batch.id}:mle`, name: '最大似然估计', aliases: ['MLE'], learningObjective: '使用最大似然估计', scope: '参数估计', genre: 'algorithm', difficulty: 2, importance: 'core', evidence: [shared], confidence: 0.9 },
            ],
            teachingUnits: [
              { localId: `${batch.id}:u1`, topicLocalId: `${batch.id}:likelihood`, role: 'definition', title: '似然函数定义', summary: '似然函数', evidence: [shared], required: true, confidence: 0.9 },
              { localId: `${batch.id}:u2`, topicLocalId: `${batch.id}:mle`, role: 'procedure_step', title: '最大化', summary: '最大化似然', evidence: [shared], required: true, confidence: 0.9 },
            ],
            orderClaims: [{ beforeTopicLocalId: `${batch.id}:likelihood`, afterTopicLocalId: `${batch.id}:mle`, strength: 'hard', reason: 'MLE 使用似然函数', evidence: [shared], source: 'explicit', confidence: 1 }],
            unresolvedReferences: [],
            confidence: 0.9,
          }
          : {
            batchId: batch.id,
            sectionIds: batch.sectionIds,
            topicMentions: [{ localId: `${batch.id}:log`, name: '对数似然', aliases: [], learningObjective: '解释对数似然', scope: '优化', genre: 'concept', difficulty: 2, importance: 'important', evidence: [shared], confidence: 0.9 }],
            teachingUnits: [{ localId: `${batch.id}:u1`, topicLocalId: `${batch.id}:log`, role: 'definition', title: '对数似然定义', summary: '便于优化', evidence: [shared], required: true, confidence: 0.9 }],
            orderClaims: [],
            unresolvedReferences: [],
            confidence: 0.9,
          };
        return compilation;
      },
      review: async (_model, topics) => {
        const mle = topics.find(topic => topic.name === '最大似然估计')!;
        const log = topics.find(topic => topic.name === '对数似然')!;
        return {
          operations: [],
          constraints: [{ id: 'review-order', beforeTopicId: mle.id, afterTopicId: log.id, strength: 'soft', reason: '先理解估计', evidenceIds: [], source: 'inferred', confidence: 0.8 }],
          warnings: [],
        };
      },
    });

    expect(batchCallCount).toBe(buildSectionBatches(documents).length);
    expect(seenDocumentIds).toEqual(['d1', 'd2']);
    expect(result.topics).toHaveLength(3);
    const sharedEvidenceTopics = result.topics.filter(topic => topic.evidenceIds.some(id => (
      result.evidenceSpans.find(evidence => evidence.id === id)?.blockId === 'd1-b1'
    )));
    expect(sharedEvidenceTopics).toHaveLength(2);
    result.orderConstraints.filter(edge => edge.strength === 'hard').forEach(edge => {
      expect(result.orderedTopicIds.indexOf(edge.beforeTopicId))
        .toBeLessThan(result.orderedTopicIds.indexOf(edge.afterTopicId));
    });
    expect(Object.values(result.teachingPaths).every(path => path.length > 0)).toBe(true);
    expect(result.status).toBe('ready');
  });
});
