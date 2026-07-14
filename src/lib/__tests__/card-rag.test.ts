import { describe, expect, it, vi } from 'vitest';
import type { ChatHistoryTurn, ModelConfig, RetrievalRecord } from '../../types';
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

  it('grounds a card answer in current cards while using recent dialogue for intent', async () => {
    const requests: RagRequest[] = [];
    const history: ChatHistoryTurn[] = [
      { role: 'user', content: 'GLM 有几个部分？' },
      { role: 'assistant', content: '你想继续了解哪一部分？' },
    ];
    const completer: RagCompleter = async request => {
      requests.push(request);
      return { cardAnswer: '它包含三个组成部分。', citations: ['card-1'], generalSupplement: '' };
    };

    await answerWithKnowledgeCards(
      config,
      '它们分别是什么？',
      [{ record, score: 8, matchedTerms: ['glm'] }],
      completer,
      history,
    );

    expect(requests[0].user).toContain('最近对话：\n用户：GLM 有几个部分？\n助手：你想继续了解哪一部分？');
    expect(requests[0].user).toContain('当前问题：它们分别是什么？');
    expect(requests[0].user).toContain('知识卡片正文：');
    expect(requests[0].user).toContain(record.content);
    expect(requests[0].user.indexOf('最近对话：')).toBeLessThan(requests[0].user.indexOf('当前问题：'));
    expect(requests[0].user.indexOf('当前问题：')).toBeLessThan(requests[0].user.indexOf('知识卡片正文：'));
    expect(requests[0].system).toContain(
      '历史回答只能用于理解指代和对话意图，不能作为课程事实来源；课程事实必须来自本次提供的知识卡片。',
    );
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

  it('sends recent dialogue and the current question to general mode without a card heading', async () => {
    const requests: RagRequest[] = [];
    const completer: RagCompleter = async request => {
      requests.push(request);
      return { answer: '这是模型的通用回答。' };
    };

    await answerWithKnowledgeCards(
      config,
      '那它适合什么场景？',
      [],
      completer,
      [
        { role: 'user', content: '什么是回归？' },
        { role: 'assistant', content: '回归用于预测连续值。' },
      ],
    );

    expect(requests[0].user).toContain('最近对话：\n用户：什么是回归？\n助手：回归用于预测连续值。');
    expect(requests[0].user).toContain('当前问题：那它适合什么场景？');
    expect(requests[0].user).not.toContain('知识卡片正文');
    expect(requests[0].system).toContain('不得伪造课程引用');
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
