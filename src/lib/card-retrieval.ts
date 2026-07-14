import type { KnowledgeCard, RetrievalRecord } from '../types';

export interface KnowledgeCardSearchHit {
  record: RetrievalRecord;
  score: number;
  matchedTerms: string[];
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
    return targets.map(documentId => ({
      id: `retrieval-${documentId}-${card.id}`,
      cardId: card.id,
      courseId: courseIdOverride ?? card.courseId,
      documentId,
      topicId: card.topicId,
      teachingBlockId: card.teachingBlockId,
      title: card.title,
      content: [card.conciseSummary, card.detailedNote].filter(Boolean).join('\n\n'),
      keywords: card.keywords,
      aliases: [...card.aliases, card.topicName],
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

export function searchKnowledgeCards(
  query: string,
  records: RetrievalRecord[],
  options: { courseIds?: string[]; documentIds?: string[]; limit?: number } = {},
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
    const hit = { record, ...scored };
    const current = bestByCard.get(record.cardId);
    if (!current || hit.score > current.score) bestByCard.set(record.cardId, hit);
  });

  return [...bestByCard.values()]
    .sort((a, b) => b.score - a.score || a.record.cardId.localeCompare(b.record.cardId))
    .slice(0, options.limit ?? 8);
}
