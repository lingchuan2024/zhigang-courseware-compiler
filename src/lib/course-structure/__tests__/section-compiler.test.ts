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
    atomId: 'b1:atom:0',
    sourceStartOffset: 0,
    sourceEndOffset: 11,
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
    expect(prompt.promptVersion).toBe('course-section-v3');
    expect((prompt as { maxOutputTokens?: number }).maxOutputTokens).toBe(8192);
    expect((prompt as { maxStructuredAttempts?: number }).maxStructuredAttempts).toBe(1);
    expect((prompt as { maxTransportAttempts?: number }).maxTransportAttempts).toBe(1);
  });

  it('gives each GLM reasoning request a 120 second budget', async () => {
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
      120000,
      batch.id,
      'section-compile',
    );
  });

  it('honors a smaller remaining foreground budget from the course compiler', async () => {
    mocks.callChatCompletion.mockResolvedValue({
      data: { topics: [], units: [], explicitOrders: [], confidence: 0 },
      usage: {},
    });

    await compileSectionBatch({ ...config, apiMode: 'responses' }, batch, 45_000);

    expect(mocks.callChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ apiMode: 'responses' }),
      expect.any(Object),
      'course-section-compile',
      45_000,
      batch.id,
      'section-compile',
    );
  });

  it('maps lightweight topics and teaching roles onto the canonical compilation', async () => {
    mocks.callChatCompletion.mockResolvedValue({
      data: {
        topics: [{
          localId: 't1',
          name: '最大似然估计',
          aliases: ['MLE'],
          learningObjective: '理解并应用最大似然估计',
          genre: 'algorithm',
          difficulty: 2,
          importance: 'core',
        }],
        units: [{
          localId: 'u1',
          topicLocalId: 't1',
          role: 'definition',
          title: 'MLE 定义',
          evidence: [{ blockId: 'b1', anchor: 'MLE 最大化似然函数' }],
          required: true,
        }],
        explicitOrders: [],
        confidence: 0.85,
      },
      usage: {},
    });

    const result = await compileSectionBatch(config, batch);

    expect(result.topicMentions[0]).toMatchObject({
      name: '最大似然估计',
      genre: 'algorithm',
      confidence: 0.85,
    });
    expect(result.topicMentions[0].evidence[0]).toMatchObject({
      blockId: 'b1',
      quote: 'MLE 最大化似然函数',
    });
    expect(result.teachingUnits[0]).toMatchObject({
      role: 'definition',
      summary: 'MLE 定义',
      confidence: 0.85,
    });
  });

  it('translates an atom-local anchor into precise source-block offsets', async () => {
    const fragmentBatch: SectionBatch = {
      ...batch,
      blocks: [{
        ...batch.blocks[0],
        atomId: 'b1:atom:1',
        sourceStartOffset: 10,
        sourceEndOffset: 17,
        content: '重复句。尾部',
      }],
    };
    mocks.callChatCompletion.mockResolvedValue({
      data: {
        topics: [{
          localId: 't1', name: '重复知识', aliases: [], learningObjective: '理解重复知识',
          genre: 'concept', difficulty: 1, importance: 'core',
        }],
        units: [{
          localId: 'u1', topicLocalId: 't1', role: 'definition', title: '定义', required: true,
          evidence: [{ atomId: 'b1:atom:1', blockId: 'b1', anchor: '重复句' }],
        }],
        explicitOrders: [], confidence: 1,
      },
      usage: {},
    });

    const result = await compileSectionBatch(config, fragmentBatch);
    expect(buildSectionCompilerPrompt(fragmentBatch).dynamicInput).toContain('b1:atom:1');
    expect(result.teachingUnits[0].evidence[0]).toMatchObject({
      blockId: 'b1', quote: '重复句', startOffset: 10, endOffset: 13,
    });
  });
});
