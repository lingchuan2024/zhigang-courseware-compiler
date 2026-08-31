import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../../types';
import type { SectionBatch } from '../section-batching';

const mocks = vi.hoisted(() => ({ callChatCompletion: vi.fn() }));
vi.mock('../../model-v2', () => ({ callChatCompletion: mocks.callChatCompletion }));

import { buildSectionCompilerPrompt, compileSectionBatch } from '../section-compiler';

const config: ModelConfig = {
  endpoint: 'https://example.test',
  model: 'test',
  apiKey: 'key',
};

const batch: SectionBatch = {
  id: 'batch-d1-0',
  documentId: 'd1',
  documentTitle: '参数估计',
  sectionIds: ['s1'],
  estimatedTokens: 20,
  cacheKey: 'cache',
  blocks: [{
    id: 'b1',
    documentId: 'd1',
    type: 'paragraph',
    content: 'MLE 最大化似然函数。',
    headingPath: ['参数估计'],
    orderIndex: 0,
    contentHash: 'h1',
  }],
};

describe('unified section compiler', () => {
  beforeEach(() => mocks.callChatCompletion.mockReset());

  it('extracts topics, teaching units, order claims, and evidence in one call', async () => {
    mocks.callChatCompletion.mockResolvedValue({
      data: {
        topicMentions: [{
          localId: 't1',
          name: '最大似然估计',
          aliases: ['MLE'],
          learningObjective: '能够解释 MLE',
          scope: '参数估计',
          genre: 'concept',
          difficulty: 2,
          importance: 'core',
          evidence: [{ blockId: 'b1', quote: 'MLE 最大化似然函数', role: 'definition' }],
          confidence: 0.9,
        }],
        teachingUnits: [{
          localId: 'u1',
          topicLocalId: 't1',
          role: 'definition',
          title: 'MLE 定义',
          summary: '最大化似然',
          evidence: [{ blockId: 'b1', quote: 'MLE 最大化似然函数', role: 'definition' }],
          required: true,
          confidence: 0.9,
        }],
        orderClaims: [],
        unresolvedReferences: [],
        confidence: 0.9,
      },
      usage: {},
    });

    const result = await compileSectionBatch(config, batch);
    expect(mocks.callChatCompletion).toHaveBeenCalledOnce();
    expect(result.topicMentions[0].localId).toBe('batch-d1-0:t1');
    expect(result.teachingUnits[0].topicLocalId).toBe('batch-d1-0:t1');
  });

  it('drops references to unknown local topics', async () => {
    mocks.callChatCompletion.mockResolvedValue({
      data: {
        topicMentions: [],
        teachingUnits: [{
          localId: 'u1',
          topicLocalId: 'missing',
          role: 'definition',
          title: 'x',
          summary: 'x',
          evidence: [],
          required: true,
          confidence: 1,
        }],
        orderClaims: [],
        unresolvedReferences: [],
        confidence: 0.2,
      },
      usage: {},
    });
    expect((await compileSectionBatch(config, batch)).teachingUnits).toEqual([]);
  });

  it('filters invalid enums and clamps numeric fields', async () => {
    mocks.callChatCompletion.mockResolvedValue({
      data: {
        topicMentions: [
          { localId: 'bad', name: 'Bad', aliases: [], learningObjective: 'x', scope: 'x', genre: 'invented', difficulty: 99, importance: 'core', evidence: [], confidence: 3 },
          { localId: 'good', name: 'Good', aliases: [], learningObjective: 'x', scope: 'x', genre: 'concept', difficulty: 99, importance: 'core', evidence: [], confidence: 3 },
        ],
        teachingUnits: [],
        orderClaims: [],
        unresolvedReferences: [],
        confidence: -1,
      },
      usage: {},
    });
    const result = await compileSectionBatch(config, batch);
    expect(result.topicMentions.map(topic => topic.name)).toEqual(['Good']);
    expect(result.topicMentions[0].difficulty).toBe(5);
    expect(result.topicMentions[0].confidence).toBe(1);
    expect(result.confidence).toBe(0);
  });

  it('builds a prompt that carries stable block ids and ordering semantics', () => {
    const prompt = buildSectionCompilerPrompt(batch);
    expect(prompt.dynamicInput).toContain('b1');
    expect(prompt.system).toContain('beforeTopicLocalId');
    expect(prompt.promptVersion).toBe('course-section-v2');
  });

  it('allows Responses/Agent Plan enough time to finish reasoning', async () => {
    mocks.callChatCompletion.mockResolvedValue({
      data: {
        topicMentions: [],
        teachingUnits: [],
        orderClaims: [],
        unresolvedReferences: [],
        confidence: 0,
      },
      usage: {},
    });

    await compileSectionBatch({ ...config, apiMode: 'responses' }, batch);

    expect(mocks.callChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ apiMode: 'responses' }),
      expect.any(Object),
      'course-section-compile',
      240000,
      batch.id,
      'section-compile',
    );
  });
});
