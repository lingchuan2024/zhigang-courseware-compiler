import { describe, expect, it } from 'vitest';
import type { KnowledgeCard } from '../../types';
import { buildSynthesisEvidence } from '../synthesis-evidence';

const card = (id: string, sourceExcerpt?: string) => ({ id, sourceExcerpt } as KnowledgeCard);
describe('synthesis evidence', () => {
  it('shares repeated evidence while preserving every card association and exact source text', () => {
    const source = 'class Student:\n    def run(self):\n        return 1';
    expect(buildSynthesisEvidence([card('a', source), card('b', source), card('c')])).toEqual([
      { cardIds: ['a', 'b'], excerpt: source, truncated: false },
    ]);
  });
  it('does not starve later cards when one source is oversized, and labels truncation', () => {
    const evidence = buildSynthesisEvidence([card('a', 'a'.repeat(200)), card('b', 'b'.repeat(200))], 100);
    expect(evidence.map(e => e.excerpt.length)).toEqual([50, 50]);
    expect(evidence.every(e => e.truncated)).toBe(true);
    expect(evidence[1].cardIds).toEqual(['b']);
  });
});
