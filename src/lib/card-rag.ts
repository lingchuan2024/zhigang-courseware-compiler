import type { ModelConfig } from '../types';
import type { KnowledgeCardSearchHit } from './card-retrieval';
import { callChatCompletion } from './model-v2';

export interface RagRequest {
  mode: 'cards' | 'general';
  system: string;
  user: string;
}

export type RagCompleter = (request: RagRequest) => Promise<unknown>;

export interface RagAnswerSection {
  source: 'cards' | 'general';
  content: string;
  cardIds: string[];
}

export interface RagAnswer {
  mode: 'cards' | 'mixed' | 'general';
  sections: RagAnswerSection[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createModelCompleter(config: ModelConfig): RagCompleter {
  return async request => {
    const { data } = await callChatCompletion<unknown>(config, {
      system: request.system,
      stablePrefix: request.system,
      dynamicInput: request.user,
      promptVersion: `card-rag-${request.mode}-v1`,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    }, 'note-generation', 120000);
    return data;
  };
}

export async function answerWithKnowledgeCards(
  config: ModelConfig,
  question: string,
  hits: KnowledgeCardSearchHit[],
  injectedCompleter?: RagCompleter,
): Promise<RagAnswer> {
  const complete = injectedCompleter ?? createModelCompleter(config);
  if (hits.length === 0) {
    const response = record(await complete({
      mode: 'general',
      system: '直接回答用户问题。当前没有命中课件知识卡片，不得伪造课程引用。返回 JSON：{ answer }。',
      user: `用户问题：${question}`,
    }));
    const answer = text(response.answer) || text(response.generalAnswer);
    return {
      mode: 'general',
      sections: [{ source: 'general', content: answer || '暂时无法生成回答。', cardIds: [] }],
    };
  }

  const allowedCardIds = new Set(hits.map(hit => hit.record.cardId));
  const response = record(await complete({
    mode: 'cards',
    system: [
      '优先根据给定知识卡片回答问题，不得把未提供的课件内容伪装成卡片事实。',
      '可以在 generalSupplement 中补充通用知识，但必须与卡片回答分开。',
      '返回 JSON：{ cardAnswer, citations, generalSupplement }。citations 只能使用提供的 cardId。',
    ].join('\n'),
    user: [
      `用户问题：${question}`,
      '知识卡片正文：',
      JSON.stringify(hits.map(hit => ({
        cardId: hit.record.cardId,
        title: hit.record.title,
        content: hit.record.content,
        retrievalOrigin: hit.origin ?? 'lexical',
        sourceExcerpt: hit.record.sourceExcerpt ?? '',
        sourceRanges: hit.record.sourceRanges,
      }))),
    ].join('\n\n'),
  }));
  const cardAnswer = text(response.cardAnswer) || text(response.answer);
  const requestedCitations = Array.isArray(response.citations)
    ? response.citations.filter((id): id is string => typeof id === 'string' && allowedCardIds.has(id))
    : [];
  const citations = requestedCitations.length > 0
    ? [...new Set(requestedCitations)]
    : hits.slice(0, 3).map(hit => hit.record.cardId);
  const generalSupplement = text(response.generalSupplement);
  const sections: RagAnswerSection[] = [{
    source: 'cards',
    content: cardAnswer || hits.map(hit => hit.record.content).join('\n\n'),
    cardIds: citations,
  }];
  if (generalSupplement) sections.push({ source: 'general', content: generalSupplement, cardIds: [] });
  return { mode: generalSupplement ? 'mixed' : 'cards', sections };
}
