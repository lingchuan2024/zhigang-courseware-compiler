import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvidenceSpan, LearningTopic } from '../types';

const mocks = vi.hoisted(() => ({ callChatCompletion: vi.fn() }));
vi.mock('../../model-v2', () => ({ callChatCompletion: mocks.callChatCompletion }));

import { reviewCurriculum } from '../curriculum-review';

const evidence: EvidenceSpan = {
  id: 'e1',
  stableKey: 'e1',
  documentId: 'd1',
  blockId: 'b1',
  startOffset: 0,
  endOffset: 5,
  quote: 'Known',
  role: 'definition',
  contentHash: 'h1',
};

const topic = (id: string): LearningTopic => ({
  id,
  stableKey: id,
  courseId: 'c',
  name: id,
  aliases: [],
  learningObjective: `理解 ${id}`,
  scope: id,
  genre: 'concept',
  difficulty: 1,
  importance: 'core',
  evidenceIds: ['e1'],
  sourceSectionIds: ['s1'],
  confidence: 1,
  status: 'verified',
});

describe('restricted curriculum review', () => {
  beforeEach(() => mocks.callChatCompletion.mockReset());

  it('rejects operations that cite unknown topics or evidence', async () => {
    mocks.callChatCompletion.mockResolvedValue({
      data: {
        operations: [{ type: 'merge', topicIds: ['known', 'invented'], reason: 'same' }],
        constraints: [{ beforeTopicId: 'known', afterTopicId: 'invented', strength: 'hard', reason: 'dependency', evidenceIds: ['invented-evidence'], confidence: 1 }],
      },
      usage: {},
    });
    const result = await reviewCurriculum(
      { endpoint: 'x', model: 'm', apiKey: 'k' },
      [topic('known')],
      new Map([['e1', evidence]]),
    );
    expect(result.operations).toEqual([]);
    expect(result.constraints).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('downgrades an unevidenced inferred hard constraint to soft', async () => {
    mocks.callChatCompletion.mockResolvedValue({
      data: {
        operations: [],
        constraints: [{ beforeTopicId: 'a', afterTopicId: 'b', strength: 'hard', reason: '更自然', evidenceIds: [], confidence: 0.8 }],
      },
      usage: {},
    });
    const result = await reviewCurriculum(
      { endpoint: 'x', model: 'm', apiKey: 'k' },
      [topic('a'), topic('b')],
      new Map([['e1', evidence]]),
    );
    expect(result.constraints[0].strength).toBe('soft');
    expect(result.constraints[0].source).toBe('inferred');
  });
});
