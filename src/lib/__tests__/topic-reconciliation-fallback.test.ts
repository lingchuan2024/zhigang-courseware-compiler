import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateTopic, MarkdownBlock, ModelConfig, KnowledgeTopic } from '../../types';
import { reconcileTopics, topicsToCandidates, buildSourceRanges, parseMergeResponse } from '../topic-reconciliation';

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


describe('merge evidence preservation', () => {
  it('retains interior formula blocks across repeated compaction without crossing documents', () => {
    const blocks = [block(0), { ...block(1), type: 'formula' as const }, block(2), { ...block(1), id: 'other-doc', documentId: 'doc-2' }];
    const topic: KnowledgeTopic = {
      id: 'topic', courseId: 'course', name: 'Least squares', aliases: [], summary: 'Derivation',
      learningObjective: 'derive', sourceRanges: [{ documentId: 'doc-1', startBlockId: 'block-2', endBlockId: 'block-0' }],
      childTopicIds: [], importance: 'core', difficulty: 2, knowledgeGenre: 'mathematical_derivation', confidence: 1, status: 'generated',
    };
    const first = topicsToCandidates([topic], 'first', blocks);
    expect(first[0].sourceBlockIds).toEqual(['block-0', 'block-1', 'block-2']);
    const second = topicsToCandidates([{ ...topic, sourceRanges: buildSourceRanges(first[0].sourceBlockIds, blocks) }], 'second', blocks);
    expect(second[0].sourceBlockIds).toEqual(first[0].sourceBlockIds);
  });
});


describe('merge candidate provenance', () => {
  it('retains all blocks of referenced candidates even when the model abbreviates the block list', () => {
    const source = { ...candidate(0), sourceBlockIds: ['block-0', 'block-1', 'block-2'] };
    const result = parseMergeResponse({ topics: [{ name: 'Gas example', sourceCandidateIds: ['candidate-0', 'invented'], sourceBlockIds: ['block-0', 'invented'] }] }, [source], [block(0), block(1), block(2)]);
    expect(topicsToCandidates(result.topics, 'test', [block(0), block(1), block(2)])[0].sourceBlockIds).toEqual(source.sourceBlockIds);
    expect(result.topics).toHaveLength(1);
  });

  it('keeps omitted candidate evidence separately and accepts valid candidate-only references', () => {
    const result = parseMergeResponse({ topics: [{ name: 'Merged', sourceCandidateIds: ['candidate-0'] }] }, [candidate(0), candidate(1)], [block(0), block(1)]);
    expect(result.topics.map(topic => topic.name)).toEqual(['Merged', 'AI candidate 1']);
    expect(topicsToCandidates(result.topics, 'test', [block(0), block(1)]).flatMap(c => c.sourceBlockIds)).toEqual(['block-0', 'block-1']);
  });
});
