import { describe, it, expect } from 'vitest';
import {
  generateMasterNotesLocal,
  parseMasterNotesFromModel,
  exportToMarkdown,
  VIEW_CONFIGS,
} from '../notes';
import { EvidenceAtom, EvidenceType, LearningUnit } from '../../types';

function makeEvidence(overrides: Partial<EvidenceAtom> & { id: string; pageNumber: number; type: EvidenceType; content: string }): EvidenceAtom {
  return {
    documentId: 'test-doc',
    blockIndex: 0,
    contentHash: `${overrides.documentId || 'test-doc'}-${overrides.pageNumber}-${overrides.blockIndex ?? 0}-${overrides.type}-${overrides.content.slice(0, 20)}`,
    confidence: 0.8,
    ...overrides,
  };
}

describe('notes', () => {
  const mockEvidences: EvidenceAtom[] = [
    makeEvidence({ id: 'ev1', pageNumber: 1, type: 'title', content: '第一章 引言', confidence: 0.9 }),
    makeEvidence({ id: 'ev2', pageNumber: 1, type: 'definition', content: 'AI是研究智能的学科。', confidence: 0.8 }),
    makeEvidence({ id: 'ev3', pageNumber: 1, type: 'formula', content: 'P(A|B) = P(B|A)P(A)/P(B)', confidence: 0.9 }),
    makeEvidence({ id: 'ev4', pageNumber: 2, type: 'example', content: '例如：垃圾邮件过滤。', confidence: 0.7 }),
    makeEvidence({ id: 'ev5', pageNumber: 2, type: 'procedure', content: '第一步收集数据，第二步训练模型。', confidence: 0.8 }),
  ];

  const mockUnits: LearningUnit[] = [
    {
      id: 'unit1',
      title: '引言',
      objective: '理解AI基础概念',
      evidenceIds: ['ev1', 'ev2', 'ev3', 'ev4', 'ev5'],
      order: 0,
    },
  ];

  describe('generateMasterNotesLocal', () => {
    it('should generate master notes', () => {
      const notes = generateMasterNotesLocal(mockUnits, mockEvidences);
      expect(notes.length).toBe(1);
      expect(notes[0].unitId).toBe('unit1');
      expect(notes[0].keyClaims.length).toBeGreaterThan(0);
      expect(notes[0].formulas.length).toBeGreaterThan(0);
    });

    it('should bind evidence ids to claims', () => {
      const notes = generateMasterNotesLocal(mockUnits, mockEvidences);
      for (const claim of notes[0].keyClaims) {
        expect(claim.evidenceIds.length).toBeGreaterThan(0);
      }
    });
  });

  describe('parseMasterNotesFromModel', () => {
    it('should fallback to local on invalid output', () => {
      const notes = parseMasterNotesFromModel(null, mockUnits, mockEvidences);
      expect(notes.length).toBeGreaterThan(0);
    });

    it('should fallback on invalid structure', () => {
      const notes = parseMasterNotesFromModel({ wrong: 'format' }, mockUnits, mockEvidences);
      expect(notes.length).toBeGreaterThan(0);
    });

    it('should parse valid model output', () => {
      const validOutput = {
        units: [
          {
            unitId: 'unit1',
            title: 'AI简介',
            objective: '理解AI',
            summary: 'AI概述',
            keyClaims: [{ content: 'AI很重要', evidenceIds: ['ev2'], importance: 'core' as const }],
            formulas: [],
            examples: [],
            procedures: [],
          },
        ],
      };
      const notes = parseMasterNotesFromModel(validOutput, mockUnits, mockEvidences);
      expect(notes[0].title).toBe('AI简介');
      expect(notes[0].keyClaims[0].content).toBe('AI很重要');
    });

    it('should filter invalid evidence ids', () => {
      const output = {
        units: [
          {
            unitId: 'unit1',
            keyClaims: [{ content: 'test', evidenceIds: ['ev999', 'ev2'] }],
          },
        ],
      };
      const notes = parseMasterNotesFromModel(output, mockUnits, mockEvidences);
      // Should fallback to first valid evidence when none are valid
      expect(notes[0].keyClaims[0].evidenceIds.length).toBeGreaterThan(0);
    });
  });

  describe('exportToMarkdown', () => {
    it('should export markdown for first-study view', () => {
      const notes = generateMasterNotesLocal(mockUnits, mockEvidences);
      const md = exportToMarkdown(notes, mockEvidences, 'first-study', '测试课件');
      expect(md).toContain('# 测试课件');
      expect(md).toContain('首次学习');
      expect(md).toContain('## 引言');
    });

    it('should export exam view with keywords', () => {
      const notes = generateMasterNotesLocal(mockUnits, mockEvidences);
      const md = exportToMarkdown(notes, mockEvidences, 'exam', '测试');
      expect(md).toContain('考前速查');
    });

    it('should include page references when configured', () => {
      const notes = generateMasterNotesLocal(mockUnits, mockEvidences);
      const md = exportToMarkdown(notes, mockEvidences, 'review', '测试');
      expect(md).toContain('P1');
    });
  });

  describe('VIEW_CONFIGS', () => {
    it('should have configs for all views', () => {
      expect(VIEW_CONFIGS['first-study']).toBeDefined();
      expect(VIEW_CONFIGS['review']).toBeDefined();
      expect(VIEW_CONFIGS['exam']).toBeDefined();
    });
  });
});
