import { describe, expect, it } from 'vitest';
import type { CourseLearningStructure, SectionCompilation } from '../types';
import type { SectionBatch } from '../section-batching';
import { preserveCorrectedObjects, reconcileIncremental } from '../incremental-reconcile';

const emptyCompilation: SectionCompilation = {
  batchId: 'batch-a', sectionIds: ['s1'], topicMentions: [], teachingUnits: [],
  orderClaims: [], unresolvedReferences: [], confidence: 1,
};

function structure(): CourseLearningStructure {
  return {
    courseId: 'c', sourceVersion: 1, structureVersion: 1, compilerVersion: 'v1',
    topics: [{
      id: 'corrected-topic', stableKey: 'stable-topic', courseId: 'c', name: '用户修正名称', aliases: [],
      learningObjective: '理解主题', scope: '范围', genre: 'concept', difficulty: 1, importance: 'core',
      evidenceIds: ['e1'], sourceSectionIds: ['s1'], confidence: 1, status: 'corrected',
    }],
    teachingUnits: [],
    evidenceSpans: [{
      id: 'e1', stableKey: 'e1', documentId: 'd1', blockId: 'b1', startOffset: 0, endOffset: 2,
      quote: '证据', role: 'definition', contentHash: 'h1',
    }],
    orderConstraints: [], orderedTopicIds: ['corrected-topic'], teachingPaths: { 'corrected-topic': [] },
    status: 'ready',
    validation: { issues: [], meaningfulBlockCount: 1, coveredMeaningfulBlockCount: 1, coverageRate: 1 },
    checkpoints: [{ cacheKey: 'cache-a', batchId: 'batch-a', sectionIds: ['s1'], result: emptyCompilation }],
  };
}

const batch = (id: string, cacheKey: string): SectionBatch => ({
  id, cacheKey, documentId: 'd1', documentTitle: 'D1', sectionIds: ['s1'], blocks: [], estimatedTokens: 1,
});

describe('incremental course structure reconciliation', () => {
  it('reuses unchanged section checkpoints', () => {
    const result = reconcileIncremental(structure(), [batch('batch-a', 'cache-a'), batch('batch-b', 'cache-b')]);
    expect(result.reusedBatchIds).toEqual(['batch-a']);
    expect(result.changedBatchIds).toEqual(['batch-b']);
  });

  it('preserves corrected topic identity and name', () => {
    const previous = structure();
    const generated = {
      ...structure(),
      topics: [{ ...previous.topics[0], id: 'new-topic', name: '模型生成名称', status: 'verified' as const }],
      orderedTopicIds: ['new-topic'],
      teachingPaths: { 'new-topic': [] },
    };
    const aligned = preserveCorrectedObjects(previous, generated);
    expect(aligned.topics.find(topic => topic.id === 'corrected-topic')?.name).toBe('用户修正名称');
    expect(aligned.orderedTopicIds).toEqual(['corrected-topic']);
  });

  it('does not preserve a correction whose evidence disappeared', () => {
    const previous = structure();
    const generated = {
      ...structure(),
      evidenceSpans: [],
      topics: [{ ...previous.topics[0], id: 'new-topic', name: '模型生成名称', evidenceIds: [], status: 'draft' as const }],
      orderedTopicIds: ['new-topic'],
      teachingPaths: { 'new-topic': [] },
    };
    const aligned = preserveCorrectedObjects(previous, generated);
    expect(aligned.topics[0].id).toBe('new-topic');
    expect(aligned.status).toBe('degraded');
    expect(aligned.validation.issues.some(issue => issue.code === 'INVALID_EVIDENCE')).toBe(true);
  });
});
