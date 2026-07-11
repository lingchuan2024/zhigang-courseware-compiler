import { describe, it, expect } from 'vitest';
import { computeContentHash, generateStableEvidenceId, generateEvidences } from '../evidence';
import { CoursePage } from '../../types';

describe('evidence-identity', () => {
  describe('computeContentHash', () => {
    it('same input produces same hash', () => {
      const h1 = computeContentHash('doc1', 1, 0, 'text', 'hello world');
      const h2 = computeContentHash('doc1', 1, 0, 'text', 'hello world');
      expect(h1).toBe(h2);
    });

    it('different documentId produces different hash', () => {
      const h1 = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const h2 = computeContentHash('doc2', 1, 0, 'text', 'hello');
      expect(h1).not.toBe(h2);
    });

    it('different blockIndex produces different hash', () => {
      const h1 = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const h2 = computeContentHash('doc1', 1, 1, 'text', 'hello');
      expect(h1).not.toBe(h2);
    });

    it('different content produces different hash', () => {
      const h1 = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const h2 = computeContentHash('doc1', 1, 0, 'text', 'world');
      expect(h1).not.toBe(h2);
    });

    it('returns a hash prefixed with "h"', () => {
      const h = computeContentHash('doc1', 1, 0, 'text', 'hello');
      expect(h.startsWith('h')).toBe(true);
    });
  });

  describe('generateStableEvidenceId', () => {
    it('same documentId+page+block+content produces same stable ID', () => {
      const hash = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const id1 = generateStableEvidenceId('doc1', 1, 0, hash);
      const id2 = generateStableEvidenceId('doc1', 1, 0, hash);
      expect(id1).toBe(id2);
    });

    it('ID follows the ev_documentId_page_blockHash format', () => {
      const hash = computeContentHash('doc1', 2, 3, 'formula', 'E=mc^2');
      const id = generateStableEvidenceId('doc1', 2, 3, hash);
      expect(id).toBe(`ev_doc1_2_3_${hash}`);
    });

    it('different documentId produces different evidence IDs', () => {
      const hash1 = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const hash2 = computeContentHash('doc2', 1, 0, 'text', 'hello');
      const id1 = generateStableEvidenceId('doc1', 1, 0, hash1);
      const id2 = generateStableEvidenceId('doc2', 1, 0, hash2);
      expect(id1).not.toBe(id2);
    });
  });

  describe('generateEvidences', () => {
    it('includes documentId, blockIndex, contentHash', () => {
      const pages: CoursePage[] = [
        { pageNumber: 1, text: '定义：这是一个测试定义。\n\n例如：这是一个例子。' },
      ];
      const evidences = generateEvidences(pages, 'my-doc');
      expect(evidences.length).toBeGreaterThan(0);
      for (const ev of evidences) {
        expect(ev.documentId).toBe('my-doc');
        expect(ev.blockIndex).toBeGreaterThanOrEqual(0);
        expect(ev.contentHash).toBeTruthy();
        expect(ev.contentHash.startsWith('h')).toBe(true);
        expect(ev.id.startsWith('ev_')).toBe(true);
      }
    });

    it('different documentId produces different evidence IDs', () => {
      const pages: CoursePage[] = [
        { pageNumber: 1, text: '定义：这是一个测试定义。' },
      ];
      const evs1 = generateEvidences(pages, 'doc1');
      const evs2 = generateEvidences(pages, 'doc2');
      expect(evs1.length).toBe(evs2.length);
      for (let i = 0; i < evs1.length; i++) {
        expect(evs1[i].id).not.toBe(evs2[i].id);
        expect(evs1[i].documentId).toBe('doc1');
        expect(evs2[i].documentId).toBe('doc2');
      }
    });

    it('same pages and documentId produce same evidence IDs (deterministic)', () => {
      const pages: CoursePage[] = [
        { pageNumber: 1, text: '定义：这是一个测试定义。' },
      ];
      const evs1 = generateEvidences(pages, 'doc1');
      const evs2 = generateEvidences(pages, 'doc1');
      expect(evs1.length).toBe(evs2.length);
      for (let i = 0; i < evs1.length; i++) {
        expect(evs1[i].id).toBe(evs2[i].id);
        expect(evs1[i].contentHash).toBe(evs2[i].contentHash);
      }
    });
  });
});
