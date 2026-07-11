import { describe, it, expect } from 'vitest';
import { assembleMasterNote } from '../master-note';
import {
  RecommendedLearningPath,
  Citation,
} from '../../types';
import {
  makeTopic,
  makeKnowledgePackage,
  makeNote,
  makeMemory,
} from './helpers';

describe('master-note', () => {
  describe('assembleMasterNote', () => {
    it('uses RecommendedLearningPath for ordering', () => {
      const topicA = makeTopic({ id: 'a', title: 'Topic A', originalOrder: 0 });
      const topicB = makeTopic({ id: 'b', title: 'Topic B', originalOrder: 1 });
      const topicC = makeTopic({ id: 'c', title: 'Topic C', originalOrder: 2 });

      const kpA = makeKnowledgePackage({
        id: 'kp1',
        topic: topicA,
        note: makeNote({ topicId: 'a', contentMarkdown: 'Content A' }),
      });
      const kpB = makeKnowledgePackage({
        id: 'kp2',
        topic: topicB,
        note: makeNote({ topicId: 'b', contentMarkdown: 'Content B' }),
      });
      const kpC = makeKnowledgePackage({
        id: 'kp3',
        topic: topicC,
        note: makeNote({ topicId: 'c', contentMarkdown: 'Content C' }),
      });

      const learningPath: RecommendedLearningPath = {
        id: 'path_test',
        topicIds: ['c', 'a', 'b'], // Different from original order
        steps: [],
        source: 'deterministic',
        warnings: [],
        version: 1,
        generatedAt: 0,
      };

      const result = assembleMasterNote(
        [kpA, kpB, kpC],
        [topicA, topicB, topicC],
        learningPath,
        'ai-recommended',
        'Test Doc',
        makeMemory()
      );

      // Topic order should follow learning path: c, a, b
      expect(result.topicNotes[0].topicId).toBe('c');
      expect(result.topicNotes[1].topicId).toBe('a');
      expect(result.topicNotes[2].topicId).toBe('b');
    });

    it('falls back to original order when orderMode is original', () => {
      const topicA = makeTopic({ id: 'a', title: 'Topic A', originalOrder: 2 });
      const topicB = makeTopic({ id: 'b', title: 'Topic B', originalOrder: 0 });
      const topicC = makeTopic({ id: 'c', title: 'Topic C', originalOrder: 1 });

      const kpA = makeKnowledgePackage({ id: 'kp1', topic: topicA });
      const kpB = makeKnowledgePackage({ id: 'kp2', topic: topicB });
      const kpC = makeKnowledgePackage({ id: 'kp3', topic: topicC });

      const result = assembleMasterNote(
        [kpA, kpB, kpC],
        [topicA, topicB, topicC],
        null,
        'original',
        'Test Doc',
        makeMemory()
      );

      // Should follow originalOrder: b(0), c(1), a(2)
      expect(result.topicNotes[0].topicId).toBe('b');
      expect(result.topicNotes[1].topicId).toBe('c');
      expect(result.topicNotes[2].topicId).toBe('a');
    });

    it('citation markers are globally unique (prefixed)', () => {
      const topicA = makeTopic({ id: 'a', title: 'Topic A', originalOrder: 0 });
      const topicB = makeTopic({ id: 'b', title: 'Topic B', originalOrder: 1 });

      const citationsA: Citation[] = [
        { marker: 'cite-1', evidenceIds: ['ev1'] },
        { marker: 'cite-2', evidenceIds: ['ev2'] },
      ];
      const citationsB: Citation[] = [
        { marker: 'cite-1', evidenceIds: ['ev3'] }, // Same marker name as topic A
      ];

      const kpA = makeKnowledgePackage({
        id: 'kp1',
        topic: topicA,
        note: makeNote({
          topicId: 'a',
          contentMarkdown: 'Content [cite-1] A [cite-2]',
          citations: citationsA,
        }),
      });
      const kpB = makeKnowledgePackage({
        id: 'kp2',
        topic: topicB,
        note: makeNote({
          topicId: 'b',
          contentMarkdown: 'Content [cite-1] B',
          citations: citationsB,
        }),
      });

      const result = assembleMasterNote(
        [kpA, kpB],
        [topicA, topicB],
        null,
        'original',
        'Test Doc',
        makeMemory()
      );

      // All citation markers should be unique
      const allMarkers = Array.from(result.allCitations.keys());
      expect(allMarkers.length).toBe(3); // 2 from A + 1 from B
      const uniqueMarkers = new Set(allMarkers);
      expect(allMarkers.length).toBe(uniqueMarkers.size);

      // Markers should be prefixed with topic index
      expect(allMarkers.some(m => m.startsWith('t1-cite-'))).toBe(true);
      expect(allMarkers.some(m => m.startsWith('t2-cite-'))).toBe(true);

      // Topic A's first citation should be t1-cite-1
      expect(result.allCitations.has('t1-cite-1')).toBe(true);
      expect(result.allCitations.has('t1-cite-2')).toBe(true);
      // Topic B's first citation should be t2-cite-1 (not conflicting with t1-cite-1)
      expect(result.allCitations.has('t2-cite-1')).toBe(true);
    });

    it('renamed citation markers are reflected in content', () => {
      const topicA = makeTopic({ id: 'a', title: 'Topic A', originalOrder: 0 });

      const citationsA: Citation[] = [
        { marker: 'cite-1', evidenceIds: ['ev1'] },
      ];

      const kpA = makeKnowledgePackage({
        id: 'kp1',
        topic: topicA,
        note: makeNote({
          topicId: 'a',
          contentMarkdown: 'Some text [cite-1] end',
          citations: citationsA,
        }),
      });

      const result = assembleMasterNote(
        [kpA],
        [topicA],
        null,
        'original',
        'Test Doc',
        makeMemory()
      );

      // The content should have the renamed marker
      expect(result.topicNotes[0].contentMarkdown).toContain('[t1-cite-1]');
      expect(result.topicNotes[0].contentMarkdown).not.toContain('[cite-1]');
    });

    it('chapter grouping is stable', () => {
      const topicA = makeTopic({ id: 'a', title: 'Topic A', originalOrder: 0, chapterId: 'ch1' });
      const topicB = makeTopic({ id: 'b', title: 'Topic B', originalOrder: 1, chapterId: 'ch1' });
      const topicC = makeTopic({ id: 'c', title: 'Topic C', originalOrder: 2, chapterId: 'ch2' });

      const kpA = makeKnowledgePackage({ id: 'kp1', topic: topicA });
      const kpB = makeKnowledgePackage({ id: 'kp2', topic: topicB });
      const kpC = makeKnowledgePackage({ id: 'kp3', topic: topicC });

      const result1 = assembleMasterNote(
        [kpA, kpB, kpC],
        [topicA, topicB, topicC],
        null,
        'original',
        'Test Doc',
        makeMemory()
      );
      const result2 = assembleMasterNote(
        [kpA, kpB, kpC],
        [topicA, topicB, topicC],
        null,
        'original',
        'Test Doc',
        makeMemory()
      );

      // Same number of chapters
      expect(result1.chapters.length).toBe(result2.chapters.length);
      // Same grouping
      for (let i = 0; i < result1.chapters.length; i++) {
        expect(result1.chapters[i].topicIds).toEqual(result2.chapters[i].topicIds);
      }

      // ch1 should have 2 topics, ch2 should have 1
      expect(result1.chapters.length).toBe(2);
      expect(result1.chapters[0].topicIds).toEqual(['a', 'b']);
      expect(result1.chapters[1].topicIds).toEqual(['c']);
    });

    it('does NOT modify original note content (original package is unchanged)', () => {
      const topicA = makeTopic({ id: 'a', title: 'Topic A', originalOrder: 0 });
      const originalContent = 'Original content [cite-1]';
      const originalCitations: Citation[] = [
        { marker: 'cite-1', evidenceIds: ['ev1'] },
      ];

      const kpA = makeKnowledgePackage({
        id: 'kp1',
        topic: topicA,
        note: makeNote({
          topicId: 'a',
          contentMarkdown: originalContent,
          citations: originalCitations,
        }),
      });

      assembleMasterNote(
        [kpA],
        [topicA],
        null,
        'original',
        'Test Doc',
        makeMemory()
      );

      // Original note content should be unchanged
      expect(kpA.note!.contentMarkdown).toBe(originalContent);
      // Original citation markers should be unchanged
      expect(kpA.note!.citations[0].marker).toBe('cite-1');
    });

    it('handles packages without notes (fallback)', () => {
      const topicA = makeTopic({ id: 'a', title: 'Topic A', originalOrder: 0 });

      const kpA = makeKnowledgePackage({
        id: 'kp1',
        topic: topicA,
        note: undefined, // No note
      });

      const result = assembleMasterNote(
        [kpA],
        [topicA],
        null,
        'original',
        'Test Doc',
        makeMemory()
      );

      // Should still produce a topic note entry
      expect(result.topicNotes.length).toBe(1);
      expect(result.topicNotes[0].topicId).toBe('a');
      expect(result.topicNotes[0].title).toBe('Topic A');
      // Content should be empty string (fallback)
      expect(result.topicNotes[0].contentMarkdown).toBe('');
      expect(result.topicNotes[0].shortSummary).toBe('');
    });

    it('collects symbol conflicts from memory', () => {
      const topicA = makeTopic({ id: 'a', title: 'Topic A', originalOrder: 0 });
      const kpA = makeKnowledgePackage({ id: 'kp1', topic: topicA });

      const memory = makeMemory({
        symbols: {
          alpha: {
            meaning: '学习率',
            introducedByTopicId: 't1',
            sourceEvidenceIds: ['ev1'],
            conflicts: [
              { meaning: '置信度', topicId: 't2', evidenceIds: ['ev2'] },
            ],
          },
        },
      });

      const result = assembleMasterNote(
        [kpA],
        [topicA],
        null,
        'original',
        'Test Doc',
        memory
      );

      expect(result.symbolConflicts.length).toBe(1);
      expect(result.symbolConflicts[0].meaning).toBe('置信度');
    });

    it('collects terminology aliases from memory', () => {
      const topicA = makeTopic({ id: 'a', title: 'Topic A', originalOrder: 0 });
      const kpA = makeKnowledgePackage({ id: 'kp1', topic: topicA });

      const memory = makeMemory({
        terminology: {
          'Gradient Descent': {
            preferredName: 'Gradient Descent',
            aliases: ['GD', '梯度下降'],
            introducedByTopicId: 't1',
          },
        },
      });

      const result = assembleMasterNote(
        [kpA],
        [topicA],
        null,
        'original',
        'Test Doc',
        memory
      );

      expect(result.terminologyAliases.length).toBe(1);
      expect(result.terminologyAliases[0].term).toBe('Gradient Descent');
      expect(result.terminologyAliases[0].aliases).toContain('GD');
      expect(result.terminologyAliases[0].aliases).toContain('梯度下降');
    });

    it('generates chapter introductions from topic titles', () => {
      const topicA = makeTopic({ id: 'a', title: '线性回归', originalOrder: 0, chapterId: 'ch1' });
      const topicB = makeTopic({ id: 'b', title: '逻辑回归', originalOrder: 1, chapterId: 'ch1' });

      const kpA = makeKnowledgePackage({ id: 'kp1', topic: topicA });
      const kpB = makeKnowledgePackage({ id: 'kp2', topic: topicB });

      const result = assembleMasterNote(
        [kpA, kpB],
        [topicA, topicB],
        null,
        'original',
        'Test Doc',
        makeMemory()
      );

      expect(result.chapters.length).toBe(1);
      expect(result.chapters[0].introduction).toContain('线性回归');
      expect(result.chapters[0].introduction).toContain('逻辑回归');
    });
  });
});
