import { describe, it, expect } from 'vitest';
import { updateMemoryWithNote, detectSymbolConflicts } from '../course-memory';
import { CourseGenerationMemory } from '../../types';
import { makeNote, makeMemory } from './helpers';

describe('course-memory', () => {
  describe('updateMemoryWithNote', () => {
    it('same symbol + same meaning is reused (no conflict)', () => {
      const memory = makeMemory();

      const note1 = makeNote({
        topicId: 't1',
        symbolUpdates: { alpha: '学习率' },
      });
      const memory1 = updateMemoryWithNote(memory, 't1', note1, ['ev1']);

      // Same symbol, same meaning -> reuse
      const note2 = makeNote({
        topicId: 't2',
        symbolUpdates: { alpha: '学习率' },
      });
      const memory2 = updateMemoryWithNote(memory1, 't2', note2, ['ev2']);

      const symbolEntry = memory2.symbols['alpha'];
      expect(symbolEntry).toBeDefined();
      expect(symbolEntry.meaning).toBe('学习率');
      // No conflicts should be recorded
      expect(symbolEntry.conflicts).toBeUndefined();
      // Evidence IDs should be merged (deduplicated)
      expect(symbolEntry.sourceEvidenceIds).toContain('ev1');
      expect(symbolEntry.sourceEvidenceIds).toContain('ev2');
    });

    it('same symbol + different meaning records conflict', () => {
      const memory = makeMemory();

      const note1 = makeNote({
        topicId: 't1',
        symbolUpdates: { alpha: '学习率' },
      });
      const memory1 = updateMemoryWithNote(memory, 't1', note1, ['ev1']);

      // Same symbol, different meaning -> conflict
      const note2 = makeNote({
        topicId: 't2',
        symbolUpdates: { alpha: '置信度' },
      });
      const memory2 = updateMemoryWithNote(memory1, 't2', note2, ['ev2']);

      const symbolEntry = memory2.symbols['alpha'];
      expect(symbolEntry.conflicts).toBeDefined();
      expect(symbolEntry.conflicts!.length).toBe(1);
      expect(symbolEntry.conflicts![0].meaning).toBe('置信度');
      expect(symbolEntry.conflicts![0].topicId).toBe('t2');
      expect(symbolEntry.conflicts![0].evidenceIds).toContain('ev2');
    });

    it('original meaning is NOT overwritten', () => {
      const memory = makeMemory();

      const note1 = makeNote({
        topicId: 't1',
        symbolUpdates: { beta: '权重' },
      });
      const memory1 = updateMemoryWithNote(memory, 't1', note1, ['ev1']);

      const note2 = makeNote({
        topicId: 't2',
        symbolUpdates: { beta: '偏置' },
      });
      const memory2 = updateMemoryWithNote(memory1, 't2', note2, ['ev2']);

      // Original meaning should still be '权重', not '偏置'
      expect(memory2.symbols['beta'].meaning).toBe('权重');
    });

    it('does not mutate the original memory object', () => {
      const memory = makeMemory({
        symbols: {
          gamma: {
            meaning: '原始含义',
            introducedByTopicId: 't0',
            sourceEvidenceIds: ['ev0'],
          },
        },
      });

      const note = makeNote({
        topicId: 't1',
        symbolUpdates: { gamma: '新含义' },
      });
      const newMemory = updateMemoryWithNote(memory, 't1', note, ['ev1']);

      // Original memory should be unchanged
      expect(memory.symbols['gamma'].meaning).toBe('原始含义');
      expect(memory.symbols['gamma'].conflicts).toBeUndefined();

      // New memory should have the conflict
      expect(newMemory.symbols['gamma'].conflicts).toBeDefined();
      expect(newMemory.symbols['gamma'].conflicts!.length).toBe(1);
    });

    it('terminology aliases are checked (case-insensitive match adds alias, not new entry)', () => {
      const memory = makeMemory();

      const note1 = makeNote({
        topicId: 't1',
        terminologyUpdates: { 'Gradient Descent': '一种优化算法' },
      });
      const memory1 = updateMemoryWithNote(memory, 't1', note1, ['ev1']);

      expect(memory1.terminology['Gradient Descent']).toBeDefined();
      expect(memory1.terminology['Gradient Descent'].preferredName).toBe('Gradient Descent');

      // Add same term with different case -> should be added as alias, not new entry
      const note2 = makeNote({
        topicId: 't2',
        terminologyUpdates: { 'gradient descent': '一种优化算法' },
      });
      const memory2 = updateMemoryWithNote(memory1, 't2', note2, ['ev2']);

      // Should NOT create a new entry with lowercase key
      expect(memory2.terminology['gradient descent']).toBeUndefined();

      // Should be added as alias to the existing entry
      expect(memory2.terminology['Gradient Descent'].aliases).toContain('gradient descent');
    });

    it('new terminology creates a new entry', () => {
      const memory = makeMemory();

      const note = makeNote({
        topicId: 't1',
        terminologyUpdates: { '反向传播': '神经网络的训练算法' },
      });
      const newMemory = updateMemoryWithNote(memory, 't1', note, ['ev1']);

      expect(newMemory.terminology['反向传播']).toBeDefined();
      expect(newMemory.terminology['反向传播'].preferredName).toBe('反向传播');
      expect(newMemory.terminology['反向传播'].introducedByTopicId).toBe('t1');
    });

    it('updates generatedTopicSummaries', () => {
      const memory = makeMemory();

      const note = makeNote({
        topicId: 't1',
        shortSummary: '本节介绍了基础概念',
      });
      const newMemory = updateMemoryWithNote(memory, 't1', note, ['ev1']);

      expect(newMemory.generatedTopicSummaries['t1']).toBe('本节介绍了基础概念');
    });

    it('updates previousTransition from note continuityMemory', () => {
      const memory = makeMemory();

      const note = makeNote({
        topicId: 't1',
        continuityMemory: '上一节结束了概率论的讨论',
      });
      const newMemory = updateMemoryWithNote(memory, 't1', note, ['ev1']);

      expect(newMemory.previousTransition).toBe('上一节结束了概率论的讨论');
    });
  });

  describe('detectSymbolConflicts', () => {
    it('returns all conflicts across all symbols', () => {
      const memory: CourseGenerationMemory = makeMemory({
        symbols: {
          alpha: {
            meaning: '学习率',
            introducedByTopicId: 't1',
            sourceEvidenceIds: ['ev1'],
            conflicts: [
              { meaning: '置信度', topicId: 't2', evidenceIds: ['ev2'] },
            ],
          },
          beta: {
            meaning: '权重',
            introducedByTopicId: 't1',
            sourceEvidenceIds: ['ev1'],
            conflicts: [
              { meaning: '偏置', topicId: 't2', evidenceIds: ['ev3'] },
              { meaning: '动量', topicId: 't3', evidenceIds: ['ev4'] },
            ],
          },
          gamma: {
            meaning: '正则化系数',
            introducedByTopicId: 't1',
            sourceEvidenceIds: ['ev1'],
          },
        },
      });

      const conflicts = detectSymbolConflicts(memory);
      expect(conflicts.length).toBe(3);
    });

    it('returns empty array when no conflicts exist', () => {
      const memory = makeMemory({
        symbols: {
          alpha: {
            meaning: '学习率',
            introducedByTopicId: 't1',
            sourceEvidenceIds: ['ev1'],
          },
        },
      });

      const conflicts = detectSymbolConflicts(memory);
      expect(conflicts.length).toBe(0);
    });

    it('returns empty array for empty memory', () => {
      const memory = makeMemory();
      const conflicts = detectSymbolConflicts(memory);
      expect(conflicts.length).toBe(0);
    });
  });
});
