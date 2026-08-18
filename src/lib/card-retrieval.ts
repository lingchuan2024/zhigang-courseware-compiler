import type { ChatHistoryTurn, KnowledgeCard, RetrievalRecord } from '../types';

export interface KnowledgeCardSearchHit {
  record: RetrievalRecord;
  score: number;
  matchedTerms: string[];
  origin?: 'lexical' | 'graph';
}

export interface KnowledgeCardSearchOptions {
  courseIds?: string[];
  documentIds?: string[];
  limit?: number;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function queryTerms(query: string): string[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  const terms = new Set<string>([normalized]);
  normalized.match(/[a-z0-9][a-z0-9+_.-]*/g)?.forEach(term => terms.add(term));
  normalized.match(/[\u4e00-\u9fff]+/g)?.forEach(segment => {
    terms.add(segment);
    for (let index = 0; index < segment.length - 1; index++) terms.add(segment.slice(index, index + 2));
  });
  return [...terms].filter(term => term.length > 1);
}

export function buildRetrievalRecords(
  cards: KnowledgeCard[],
  fallbackDocumentId: string,
  courseIdOverride?: string,
): RetrievalRecord[] {
  return cards.flatMap(card => {
    const documentIds = [...new Set(card.sourceRanges.map(range => range.documentId).filter(Boolean))];
    const targets = documentIds.length > 0 ? documentIds : [fallbackDocumentId];
    const content = [
      card.conciseSummary,
      card.detailedNote,
      card.keyPoints?.length ? `关键要点：${card.keyPoints.join('；')}` : '',
      card.applicableConditions?.length ? `适用条件：${card.applicableConditions.join('；')}` : '',
      card.examples?.length ? `示例：${card.examples.join('；')}` : '',
      card.misconceptions?.length ? `易错点：${card.misconceptions.join('；')}` : '',
      card.selfCheckQuestions?.length ? `自检问题：${card.selfCheckQuestions.join('；')}` : '',
      card.formulas?.length ? `公式：${card.formulas.map(formula => formula.formula).join('；')}` : '',
    ].filter(Boolean).filter((item, index, values) => values.indexOf(item) === index).join('\n\n');
    return targets.map(documentId => ({
      id: `retrieval-${documentId}-${card.id}`,
      cardId: card.id,
      courseId: courseIdOverride ?? card.courseId,
      documentId,
      topicId: card.topicId,
      teachingBlockId: card.teachingBlockId,
      title: card.title,
      content,
      keywords: card.keywords,
      aliases: [...card.aliases, card.topicName],
      sourceExcerpt: card.sourceExcerpt,
      prerequisiteTopicIds: card.prerequisiteTopicIds,
      relatedTopicIds: card.relatedTopicIds,
      sourceRanges: card.sourceRanges.filter(range => range.documentId === documentId),
      version: card.cardVersion ?? 1,
    }));
  });
}

function scoreRecord(terms: string[], record: RetrievalRecord): { score: number; matchedTerms: string[] } {
  const title = normalize(record.title);
  const content = normalize(record.content);
  const keywords = record.keywords.map(normalize);
  const aliases = record.aliases.map(normalize);
  const matchedTerms: string[] = [];
  let score = 0;

  for (const term of terms) {
    let termScore = 0;
    if (title === term) termScore += 12;
    else if (title.includes(term)) termScore += 6;
    if (keywords.some(keyword => keyword === term || keyword.includes(term))) termScore += 4;
    if (aliases.some(alias => alias === term || alias.includes(term))) termScore += 4;
    if (content.includes(term)) {
      const occurrences = Math.min(4, content.split(term).length - 1);
      termScore += 1 + occurrences;
    }
    if (termScore > 0) {
      matchedTerms.push(term);
      score += termScore * Math.min(1.5, 0.8 + term.length / 10);
    }
  }
  return { score, matchedTerms };
}

function compareHits(a: KnowledgeCardSearchHit, b: KnowledgeCardSearchHit): number {
  if (b.score !== a.score) return b.score - a.score;
  const rank = (hit: KnowledgeCardSearchHit) => (hit.origin === 'lexical' ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  return a.record.cardId.localeCompare(b.record.cardId);
}

export function searchKnowledgeCards(
  query: string,
  records: RetrievalRecord[],
  options: KnowledgeCardSearchOptions = {},
): KnowledgeCardSearchHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const courseIds = options.courseIds ? new Set(options.courseIds) : null;
  const documentIds = options.documentIds ? new Set(options.documentIds) : null;
  const bestByCard = new Map<string, KnowledgeCardSearchHit>();

  records.forEach(record => {
    if (courseIds && !courseIds.has(record.courseId)) return;
    if (documentIds && !documentIds.has(record.documentId)) return;
    const scored = scoreRecord(terms, record);
    if (scored.score <= 0) return;
    const hit: KnowledgeCardSearchHit = { record, ...scored, origin: 'lexical' };
    const current = bestByCard.get(record.cardId);
    if (!current || hit.score > current.score) bestByCard.set(record.cardId, hit);
  });

  const lexicalHits = [...bestByCard.values()]
    .sort((a, b) => b.score - a.score || a.record.cardId.localeCompare(b.record.cardId))
    .slice(0, options.limit ?? 8);

  const expanded = new Map(lexicalHits.map(hit => [hit.record.cardId, hit]));
  for (const hit of lexicalHits) {
    const neighborTopicIds = new Set([
      hit.record.topicId,
      ...(hit.record.prerequisiteTopicIds ?? []),
      ...(hit.record.relatedTopicIds ?? []),
    ]);
    if (neighborTopicIds.size === 0) continue;
    records.forEach(record => {
      if (
        record.courseId !== hit.record.courseId ||
        (documentIds && !documentIds.has(record.documentId)) ||
        !neighborTopicIds.has(record.topicId) ||
        expanded.has(record.cardId)
      ) return;
      expanded.set(record.cardId, {
        record,
        score: Math.max(0.5, hit.score * 0.35),
        matchedTerms: ['知识网一跳关联'],
        origin: 'graph',
      });
    });
  }

  return [...expanded.values()]
    .sort(compareHits)
    .slice(0, options.limit ?? 8);
}

export function searchKnowledgeCardsWithContext(
  question: string,
  history: ChatHistoryTurn[],
  records: RetrievalRecord[],
  options: KnowledgeCardSearchOptions = {},
): KnowledgeCardSearchHit[] {
  return searchKnowledgeCardsWithQueries([question], history, records, options);
}

/**
 * 多查询检索（查询改写后使用）：对每个查询独立打分，按卡片取最高分合并，
 * 再走与单查询相同的历史席位策略。
 */
export function searchKnowledgeCardsWithQueries(
  queries: string[],
  history: ChatHistoryTurn[],
  records: RetrievalRecord[],
  options: KnowledgeCardSearchOptions = {},
): KnowledgeCardSearchHit[] {
  const limit = options.limit ?? 8;
  if (limit <= 0) return [];
  const activeQueries = queries.map(query => query.trim()).filter(Boolean);

  // 逐查询取词法命中（含一跳图扩展），同卡片保留最高分，来源记为最优查询
  const bestByCard = new Map<string, KnowledgeCardSearchHit>();
  for (const query of activeQueries) {
    for (const hit of searchKnowledgeCards(query, records, { ...options, limit })) {
      const current = bestByCard.get(hit.record.cardId);
      if (!current || hit.score > current.score) bestByCard.set(hit.record.cardId, hit);
    }
  }
  const currentHits = [...bestByCard.values()]
    .sort(compareHits)
    .slice(0, limit);

  const recentQuestions = history
    .filter(turn => turn.role === 'user')
    .map(turn => turn.content.trim())
    .filter(Boolean)
    .slice(-2)
    .reverse();
  if (limit === 1 || recentQuestions.length === 0) return currentHits;

  const reservedHistoryLimit = Math.min(2, Math.max(1, Math.floor(limit / 3)));
  const openCapacity = Math.max(0, limit - currentHits.length);
  const flexibleHistoryLimit = Math.min(Math.max(1, Math.floor(limit / 2)), openCapacity);
  const historyLimit = Math.max(reservedHistoryLimit, flexibleHistoryLimit);
  const currentCardIds = new Set(currentHits.map(hit => hit.record.cardId));
  const historyHitsByCardId = new Map<string, KnowledgeCardSearchHit>();

  recentQuestions.forEach(contextQuestion => {
    searchKnowledgeCards(contextQuestion, records, { ...options, limit }).forEach(hit => {
      if (currentCardIds.has(hit.record.cardId) || historyHitsByCardId.has(hit.record.cardId)) return;
      historyHitsByCardId.set(hit.record.cardId, hit);
    });
  });

  const selectedHistoryHits = [...historyHitsByCardId.values()]
    .sort((a, b) => b.score - a.score || a.record.cardId.localeCompare(b.record.cardId))
    .slice(0, historyLimit);
  const selectedCurrentHits = currentHits.slice(0, limit - selectedHistoryHits.length);
  const currentScoreFloor = selectedCurrentHits.length > 0
    ? Math.min(...selectedCurrentHits.map(hit => hit.score))
    : Number.POSITIVE_INFINITY;
  const historyScoreCeiling = currentScoreFloor * 0.5;
  const historyHits = selectedHistoryHits.map(hit => ({
    ...hit,
    score: Math.min(hit.score * 0.25, historyScoreCeiling),
  }));
  return [...selectedCurrentHits, ...historyHits];
}
