import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateTopic, MarkdownBlock, ModelConfig } from '../../types';
import { reconcileTopics } from '../topic-reconciliation';

const config: ModelConfig = {
  endpoint: 'https://api.example.com/v1',
  model: 'deepseek-chat',
  apiKey: 'test-key',
};

function block(index: number): MarkdownBlock {
  return {
    id: `block-${index}`,
    documentId: 'doc-1',
    type: 'paragraph',
    content: `Source content ${index}`,
    headingPath: ['Lecture'],
    orderIndex: index,
    contentHash: `hash-${index}`,
  };
}

function candidate(index: number): CandidateTopic {
  return {
    temporaryId: `candidate-${index}`,
    name: `AI candidate ${index}`,
    aliases: [],
    sourceBlockIds: [`block-${index}`],
    scopeDescription: `Scope ${index}`,
    learningObjective: `Learn topic ${index}`,
    confidence: 0.8,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reconcileTopics degraded merge', () => {
  it('keeps AI-extracted candidates reviewable when merge JSON remains invalid', async () => {
    const invalidResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [{ finish_reason: 'length', message: { content: '{"topics":[' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(invalidResponse));
    const blocks = Array.from({ length: 13 }, (_, index) => block(index));
    const candidates = Array.from({ length: 13 }, (_, index) => candidate(index));

    const result = await reconcileTopics(config, candidates, blocks);

    expect(result.topics).toHaveLength(13);
    expect(result.topics.map(topic => topic.name)).toContain('AI candidate 0');
    expect(result.topics.every(topic => topic.sourceRanges.length === 1)).toBe(true);
    expect(result.relations).toEqual([]);
  });
});
