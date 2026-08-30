import { describe, expect, it } from 'vitest';
import type { MarkdownBlock } from '../../../types';
import { projectLegacyStructure } from '../legacy-adapter';
import type { CourseLearningStructure } from '../types';

const sourceBlocks: MarkdownBlock[] = [
  { id: 'b1', documentId: 'd1', type: 'paragraph', content: '定义', headingPath: ['A'], orderIndex: 1, contentHash: 'h1' },
  { id: 'b2', documentId: 'd1', type: 'paragraph', content: '例子', headingPath: ['A'], orderIndex: 2, contentHash: 'h2' },
];

const canonical: CourseLearningStructure = {
  courseId: 'course-1',
  sourceVersion: 1,
  structureVersion: 1,
  compilerVersion: 'v1',
  topics: [{
    id: 'topic-1', stableKey: 'topic-1', courseId: 'course-1', name: '参数估计', aliases: [],
    learningObjective: '解释参数估计', scope: '统计推断', genre: 'concept', difficulty: 1,
    importance: 'core', evidenceIds: ['e1'], sourceSectionIds: ['s1'], confidence: 0.9,
    status: 'verified',
  }],
  teachingUnits: [{
    id: 'unit-1', stableKey: 'unit-1', topicId: 'topic-1', role: 'definition', title: '定义',
    summary: '参数估计定义', evidenceIds: ['e1'], required: true, confidence: 0.9, status: 'verified',
  }],
  evidenceSpans: [{
    id: 'e1', stableKey: 'e1', documentId: 'd1', blockId: 'b1', startOffset: 0, endOffset: 2,
    quote: '定义', role: 'definition', contentHash: 'h1',
  }],
  orderConstraints: [],
  orderedTopicIds: ['topic-1'],
  teachingPaths: { 'topic-1': ['unit-1'] },
  status: 'ready',
  validation: { issues: [], meaningfulBlockCount: 2, coveredMeaningfulBlockCount: 1, coverageRate: 0.5 },
  checkpoints: [],
};

describe('legacy course structure projection', () => {
  it('projects flat topics without parentTopicId', () => {
    const projected = projectLegacyStructure(canonical, sourceBlocks);
    expect(projected.topics[0].parentTopicId).toBeUndefined();
    expect(projected.topics[0].courseId).toBe('course-1');
  });

  it('projects teaching units and deterministic paths', () => {
    const projected = projectLegacyStructure(canonical, sourceBlocks);
    expect(projected.teachingBlocks[0].type).toBe('definition');
    expect(projected.narrativePaths['topic-1'].orderedTeachingBlockIds).toEqual(['unit-1']);
  });

  it('projects before-after constraints without reversing direction', () => {
    const second = { ...canonical.topics[0], id: 'topic-2', stableKey: 'topic-2', name: 'MLE' };
    const projected = projectLegacyStructure({
      ...canonical,
      topics: [...canonical.topics, second],
      orderedTopicIds: ['topic-1', 'topic-2'],
      orderConstraints: [{
        id: 'r1', beforeTopicId: 'topic-1', afterTopicId: 'topic-2', strength: 'hard',
        reason: '先理解定义', evidenceIds: ['e1'], source: 'explicit', confidence: 1,
      }],
    }, sourceBlocks);
    expect(projected.topicRelations[0]).toMatchObject({
      sourceTopicId: 'topic-1', targetTopicId: 'topic-2', type: 'hard_prerequisite',
    });
  });
});
