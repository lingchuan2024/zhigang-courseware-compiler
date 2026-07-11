import { describe, it, expect } from 'vitest';
import {
  generateLearningUnitsLocal,
  renameLearningUnit,
  updateUnitObjective,
  moveLearningUnit,
  deleteLearningUnit,
} from '../structure';
import { EvidenceAtom, EvidenceType } from '../../types';

function makeEvidence(overrides: Partial<EvidenceAtom> & { id: string; pageNumber: number; type: EvidenceType; content: string }): EvidenceAtom {
  return {
    documentId: 'test-doc',
    blockIndex: 0,
    contentHash: `${overrides.documentId || 'test-doc'}-${overrides.pageNumber}-${overrides.blockIndex ?? 0}-${overrides.type}-${overrides.content.slice(0, 20)}`,
    confidence: 0.8,
    ...overrides,
  };
}

describe('structure', () => {
  const mockEvidences: EvidenceAtom[] = [
    makeEvidence({ id: 'ev1', pageNumber: 1, type: 'title', content: '第一章 引言', confidence: 0.9 }),
    makeEvidence({ id: 'ev2', pageNumber: 1, type: 'text', content: '这是引言内容。', confidence: 0.5 }),
    makeEvidence({ id: 'ev3', pageNumber: 2, type: 'title', content: '第二章 方法', confidence: 0.9 }),
    makeEvidence({ id: 'ev4', pageNumber: 2, type: 'definition', content: '方法定义。', confidence: 0.8 }),
  ];

  describe('generateLearningUnitsLocal', () => {
    it('should generate units from evidences', () => {
      const units = generateLearningUnitsLocal(mockEvidences);
      expect(units.length).toBeGreaterThanOrEqual(2);
      expect(units[0].title).toContain('引言');
      expect(units[0].evidenceIds).toContain('ev1');
    });

    it('should create default unit when no titles', () => {
      const noTitleEvidences: EvidenceAtom[] = [
        makeEvidence({ id: 'ev1', pageNumber: 1, type: 'text', content: '内容1', confidence: 0.5 }),
        makeEvidence({ id: 'ev2', pageNumber: 1, type: 'text', content: '内容2', confidence: 0.5 }),
      ];
      const units = generateLearningUnitsLocal(noTitleEvidences);
      expect(units.length).toBe(1);
    });
  });

  describe('renameLearningUnit', () => {
    it('should rename a unit', () => {
      const units = generateLearningUnitsLocal(mockEvidences);
      const renamed = renameLearningUnit(units, units[0].id, '新标题');
      expect(renamed[0].title).toBe('新标题');
    });
  });

  describe('updateUnitObjective', () => {
    it('should update objective', () => {
      const units = generateLearningUnitsLocal(mockEvidences);
      const updated = updateUnitObjective(units, units[0].id, '新目标');
      expect(updated[0].objective).toBe('新目标');
    });
  });

  describe('moveLearningUnit', () => {
    it('should move unit position', () => {
      const units = [
        { id: 'u1', title: 'A', objective: '', evidenceIds: [], order: 0 },
        { id: 'u2', title: 'B', objective: '', evidenceIds: [], order: 1 },
        { id: 'u3', title: 'C', objective: '', evidenceIds: [], order: 2 },
      ];
      const moved = moveLearningUnit(units, 0, 2);
      expect(moved[0].id).toBe('u2');
      expect(moved[2].id).toBe('u1');
      expect(moved[2].order).toBe(2);
    });
  });

  describe('deleteLearningUnit', () => {
    it('should delete unit and merge evidences', () => {
      const units = [
        { id: 'u1', title: 'A', objective: '', evidenceIds: ['ev1'], order: 0 },
        { id: 'u2', title: 'B', objective: '', evidenceIds: ['ev2'], order: 1 },
      ];
      const afterDelete = deleteLearningUnit(units, 'u2');
      expect(afterDelete.length).toBe(1);
      expect(afterDelete[0].evidenceIds).toContain('ev2');
    });
  });
});
