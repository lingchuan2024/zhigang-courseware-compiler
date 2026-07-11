import { describe, it, expect } from 'vitest';
import { detectEvidenceType, splitIntoChunks, generateEvidencesFromPage, validateEvidenceIds } from '../evidence';
import { CoursePage, EvidenceAtom, EvidenceType } from '../../types';

function makeEvidence(overrides: Partial<EvidenceAtom> & { id: string; pageNumber: number; type: EvidenceType; content: string }): EvidenceAtom {
  return {
    documentId: 'test-doc',
    blockIndex: 0,
    contentHash: `${overrides.documentId || 'test-doc'}-${overrides.pageNumber}-${overrides.blockIndex ?? 0}-${overrides.type}-${overrides.content.slice(0, 20)}`,
    confidence: 0.8,
    ...overrides,
  };
}

describe('evidence', () => {
  describe('detectEvidenceType', () => {
    it('should detect title type', () => {
      const result = detectEvidenceType('第一章 引言');
      expect(result.type).toBe('title');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should detect definition type', () => {
      const result = detectEvidenceType('机器学习是指人工智能的一个分支，专注于算法开发。');
      expect(result.type).toBe('definition');
    });

    it('should detect formula type', () => {
      const result = detectEvidenceType('E = mc^2 是质能方程。');
      expect(result.type).toBe('formula');
    });

    it('should detect example type', () => {
      const result = detectEvidenceType('例如，当你加热水时，温度会上升。');
      expect(result.type).toBe('example');
    });

    it('should detect procedure type', () => {
      const result = detectEvidenceType('首先准备材料，然后混合，最后加热。第一步是准备。');
      expect(result.type).toBe('procedure');
    });

    it('should detect comparison type', () => {
      const result = detectEvidenceType('区别在于React使用虚拟DOM，而Vue使用响应式系统。');
      expect(result.type).toBe('comparison');
    });

    it('should default to text for unclassified content', () => {
      const result = detectEvidenceType('今天天气不错，我们一起去公园散步吧。');
      expect(['text', 'title']).toContain(result.type);
    });
  });

  describe('splitIntoChunks', () => {
    it('should split text by empty lines', () => {
      const text = '第一段内容\n\n第二段内容\n\n第三段内容';
      const chunks = splitIntoChunks(text);
      expect(chunks.length).toBe(3);
    });

    it('should return empty array for empty text', () => {
      expect(splitIntoChunks('')).toEqual([]);
      expect(splitIntoChunks('   ')).toEqual([]);
    });

    it('should handle single paragraph', () => {
      const chunks = splitIntoChunks('这是一段文字。');
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('generateEvidencesFromPage', () => {
    it('should generate evidences from page', () => {
      const page: CoursePage = {
        pageNumber: 1,
        text: '第一章 测试\n\n定义：这是一个测试定义。\n\n例如：这是一个例子。',
      };
      const evidences = generateEvidencesFromPage(page);
      expect(evidences.length).toBeGreaterThan(0);
      expect(evidences[0].pageNumber).toBe(1);
      expect(evidences.every(e => e.id.startsWith('ev_'))).toBe(true);
    });

    it('should handle page with no text', () => {
      const page: CoursePage = { pageNumber: 1, text: '' };
      const evidences = generateEvidencesFromPage(page);
      expect(evidences.length).toBe(0);
    });
  });

  describe('validateEvidenceIds', () => {
    const mockEvidences: EvidenceAtom[] = [
      makeEvidence({ id: 'ev1', pageNumber: 1, type: 'text', content: 'test', confidence: 1 }),
      makeEvidence({ id: 'ev2', pageNumber: 1, type: 'text', content: 'test2', confidence: 1 }),
    ];

    it('should filter invalid ids', () => {
      const valid = validateEvidenceIds(mockEvidences, ['ev1', 'ev3', 'ev2']);
      expect(valid).toEqual(['ev1', 'ev2']);
    });

    it('should return empty array for no valid ids', () => {
      const valid = validateEvidenceIds(mockEvidences, ['ev99']);
      expect(valid).toEqual([]);
    });
  });
});
