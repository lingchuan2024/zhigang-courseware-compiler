import { describe, expect, it, vi } from 'vitest';
import type { ModelConfig, RetrievalRecord } from '../../types';
import { answerWithKnowledgeCards, type RagCompleter, type RagRequest } from '../card-rag';

const config: ModelConfig = { endpoint: 'https://example.com/v1', model: 'deepseek-chat', apiKey: 'key' };
const record: RetrievalRecord = {
  id: 'record-1', cardId: 'card-1', courseId: 'course-1', documentId: 'doc-1', topicId: 'topic-1', teachingBlockId: 'block-1',
  title: 'GLM 组成', content: 'GLM 由随机成分、系统成分与连接函数构成。', keywords: ['GLM'], aliases: [], sourceRanges: [], version: 1,
};

describe('knowledge card RAG', () => {
  it('answers from matched cards and keeps valid card citations', async () => {
    const requests: RagRequest[] = [];
    const completer: RagCompleter = vi.fn(async request => {
      requests.push(request);
      return { cardAnswer: 'GLM 包含三个组成部分。', citations: ['card-1', 'fake-card'], generalSupplement: '' };
    });
    const result = await answerWithKnowledgeCards(config, 'GLM 有哪些组成？', [{ record, score: 8, matchedTerms: ['glm'] }], completer);

    expect(requests[0].mode).toBe('cards');
    expect(requests[0].user).toContain(record.content);
    expect(result.mode).toBe('cards');
    expect(result.sections[0].cardIds).toEqual(['card-1']);
  });

  it('uses a clearly marked general answer when no card matches', async () => {
    const completer: RagCompleter = async request => {
      expect(request.mode).toBe('general');
      expect(request.user).not.toContain('知识卡片正文');
      return { answer: '这是模型的通用回答。' };
    };
    const result = await answerWithKnowledgeCards(config, '课件没有涉及的问题', [], completer);

    expect(result.mode).toBe('general');
    expect(result.sections).toEqual([{ source: 'general', content: '这是模型的通用回答。', cardIds: [] }]);
  });

  it('sends source excerpts and graph-expanded cards as grounded context', async () => {
    const requests: RagRequest[] = [];
    const groundedRecord = {
      ...record,
      sourceExcerpt: '课件原文指出 GLM 包含随机成分、系统成分和连接函数。',
      relatedTopicIds: ['topic-2'],
    };
    const completer: RagCompleter = async request => {
      requests.push(request);
      return { cardAnswer: 'GLM 包含三个组成部分。', citations: ['card-1'], generalSupplement: '' };
    };

    await answerWithKnowledgeCards(
      config,
      'GLM 有哪些组成？',
      [{ record: groundedRecord, score: 8, matchedTerms: ['glm'], origin: 'graph' }],
      completer,
    );

    expect(requests[0].user).toContain(groundedRecord.sourceExcerpt);
    expect(requests[0].user).toContain('graph');
  });
});
