import type { KnowledgeCard } from '../types';

/** Evidence is kept separate from generated prose, with a fair shared character budget. */
export function buildSynthesisEvidence(cards: KnowledgeCard[], maxChars = 12000) {
  const grouped = new Map<string, string[]>();
  for (const card of cards) {
    const excerpt = card.sourceExcerpt?.trim();
    if (!excerpt) continue;
    grouped.set(excerpt, [...(grouped.get(excerpt) ?? []), card.id]);
  }
  const perSource = Math.floor(Math.max(0, maxChars) / Math.max(1, grouped.size));
  return [...grouped].map(([excerpt, cardIds]) => ({
    cardIds,
    excerpt: excerpt.slice(0, perSource),
    truncated: excerpt.length > perSource,
  }));
}
