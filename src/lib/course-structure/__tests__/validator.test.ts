import { describe, expect, it } from 'vitest';
import type {
  CourseStructureValidationInput,
} from '../validator';
import { validateCourseStructure } from '../validator';
import type { EvidenceSpan, LearningTopic, TeachingUnit } from '../types';

const evidence: EvidenceSpan = {
  id: 'e1', stableKey: 'e1', documentId: 'd1', blockId: 'b1',
  startOffset: 0, endOffset: 4, quote: '定义内容', role: 'definition', contentHash: 'h1',
};
const topic: LearningTopic = {
  id: 't1', stableKey: 't1', courseId: 'c', name: '参数估计', aliases: [],
  learningObjective: '解释参数估计', scope: '统计推断', genre: 'concept', difficulty: 1,
  importance: 'core', evidenceIds: ['e1'], sourceSectionIds: ['s1'], confidence: 0.9,
  status: 'verified',
};
const unit: TeachingUnit = {
  id: 'u1', stableKey: 'u1', topicId: 't1', role: 'definition', title: '定义', summary: '定义内容',
  evidenceIds: ['e1'], required: true, confidence: 0.9, status: 'verified',
};

function input(overrides: Partial<CourseStructureValidationInput> = {}): CourseStructureValidationInput {
  return {
    topics: [topic],
    teachingUnits: [unit],
    evidenceSpans: [evidence],
    orderedTopicIds: ['t1'],
    orderConstraints: [],
    schedulerIssues: [],
    failedBatchIds: [],
    meaningfulBlockIds: ['b1'],
    ...overrides,
  };
}

describe('course structure validator', () => {
  it('fails when no valid topics exist', () => {
    expect(validateCourseStructure(input({ topics: [], orderedTopicIds: [] })).status).toBe('failed');
  });

  it('degrades when a required unit lacks evidence', () => {
    expect(validateCourseStructure(input({
      teachingUnits: [{ ...unit, evidenceIds: [] }],
    })).status).toBe('degraded');
  });

  it('degrades when any second-layer teaching unit cannot be traced to source evidence', () => {
    expect(validateCourseStructure(input({
      teachingUnits: [{ ...unit, required: false, evidenceIds: [] }],
    })).status).toBe('degraded');
  });

  it('degrades when the published order violates a prerequisite constraint', () => {
    const second = { ...topic, id: 't2', stableKey: 't2', name: '高级主题' };
    expect(validateCourseStructure(input({
      topics: [topic, second],
      orderedTopicIds: ['t2', 't1'],
      orderConstraints: [{
        id: 'r1', beforeTopicId: 't1', afterTopicId: 't2', strength: 'hard', reason: '前置',
        evidenceIds: ['e1'], source: 'explicit', confidence: 1,
      }],
    })).status).toBe('degraded');
  });

  it('degrades on unresolved corrected hard cycles', () => {
    expect(validateCourseStructure(input({
      schedulerIssues: [{ code: 'HARD_ORDER_CYCLE', severity: 'error', message: 'cycle' }],
    })).status).toBe('degraded');
  });

  it('is ready only when evidence, topics, units, and order are valid', () => {
    expect(validateCourseStructure(input()).status).toBe('ready');
  });

  it('fails when the canonical order contains unknown ids', () => {
    expect(validateCourseStructure(input({ orderedTopicIds: ['missing'] })).status).toBe('failed');
  });
});
