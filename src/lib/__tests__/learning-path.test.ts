import { describe, it, expect } from 'vitest';
import { deriveLearningPath } from '../learning-path';
import { CourseTopic, MacroKnowledgeRelation } from '../../types';
import { makeTopic, makeRelation } from './helpers';

describe('learning-path', () => {
  describe('deriveLearningPath', () => {
    it('hard prerequisite priority is respected', () => {
      // c is hard prerequisite of a
      // Without the relation, a would come first (originalOrder=0)
      // With the relation, c must come before a
      const topics: CourseTopic[] = [
        makeTopic({ id: 'a', originalOrder: 0, originalPageNumbers: [3] }),
        makeTopic({ id: 'b', originalOrder: 1, originalPageNumbers: [2] }),
        makeTopic({ id: 'c', originalOrder: 2, originalPageNumbers: [1] }),
      ];
      const relations: MacroKnowledgeRelation[] = [
        makeRelation({ id: 'r1', sourceTopicId: 'c', targetTopicId: 'a', type: 'hard_prerequisite' }),
      ];
      const path = deriveLearningPath(topics, relations);

      const idxC = path.topicIds.indexOf('c');
      const idxA = path.topicIds.indexOf('a');
      expect(idxC).toBeLessThan(idxA);
    });

    it('soft prerequisite comes after hard', () => {
      // a is hard prereq of b, b is soft prereq of c
      // Order should be: a, b, c
      const topics: CourseTopic[] = [
        makeTopic({ id: 'a', originalOrder: 0, originalPageNumbers: [1] }),
        makeTopic({ id: 'b', originalOrder: 1, originalPageNumbers: [2] }),
        makeTopic({ id: 'c', originalOrder: 2, originalPageNumbers: [3] }),
      ];
      const relations: MacroKnowledgeRelation[] = [
        makeRelation({ id: 'r1', sourceTopicId: 'a', targetTopicId: 'b', type: 'hard_prerequisite' }),
        makeRelation({ id: 'r2', sourceTopicId: 'b', targetTopicId: 'c', type: 'soft_prerequisite' }),
      ];
      const path = deriveLearningPath(topics, relations);

      const idxA = path.topicIds.indexOf('a');
      const idxB = path.topicIds.indexOf('b');
      const idxC = path.topicIds.indexOf('c');
      expect(idxA).toBeLessThan(idxB);
      expect(idxB).toBeLessThan(idxC);
    });

    it('contains and contrasts_with do NOT affect ordering', () => {
      // c contains a, c contrasts_with b
      // These should NOT create ordering constraints
      const topics: CourseTopic[] = [
        makeTopic({ id: 'a', originalOrder: 0, originalPageNumbers: [1] }),
        makeTopic({ id: 'b', originalOrder: 1, originalPageNumbers: [2] }),
        makeTopic({ id: 'c', originalOrder: 2, originalPageNumbers: [3] }),
      ];
      const relations: MacroKnowledgeRelation[] = [
        makeRelation({ id: 'r1', sourceTopicId: 'c', targetTopicId: 'a', type: 'contains' }),
        makeRelation({ id: 'r2', sourceTopicId: 'c', targetTopicId: 'b', type: 'contrasts_with' }),
      ];
      const path = deriveLearningPath(topics, relations);

      // Without ordering relations, should follow original order: a, b, c
      expect(path.topicIds).toEqual(['a', 'b', 'c']);
    });

    it('cycle handling preserves original relations', () => {
      // a -> b -> a forms a cycle
      const topics: CourseTopic[] = [
        makeTopic({ id: 'a', originalOrder: 0, originalPageNumbers: [1] }),
        makeTopic({ id: 'b', originalOrder: 1, originalPageNumbers: [2] }),
      ];
      const relations: MacroKnowledgeRelation[] = [
        makeRelation({ id: 'r1', sourceTopicId: 'a', targetTopicId: 'b', type: 'hard_prerequisite' }),
        makeRelation({ id: 'r2', sourceTopicId: 'b', targetTopicId: 'a', type: 'hard_prerequisite' }),
      ];
      const path = deriveLearningPath(topics, relations);

      // Should still produce a valid path with all topics
      expect(path.topicIds.length).toBe(2);
      expect(path.topicIds).toContain('a');
      expect(path.topicIds).toContain('b');

      // Original relations array should NOT be mutated
      expect(relations.length).toBe(2);
      expect(relations[0].id).toBe('r1');
      expect(relations[1].id).toBe('r2');

      // Should have warnings about cycle
      expect(path.warnings.some(w => w.includes('环'))).toBe(true);
    });

    it('deterministic: same input produces same output', () => {
      const topics: CourseTopic[] = [
        makeTopic({ id: 'a', originalOrder: 0, originalPageNumbers: [1] }),
        makeTopic({ id: 'b', originalOrder: 1, originalPageNumbers: [2] }),
        makeTopic({ id: 'c', originalOrder: 2, originalPageNumbers: [3] }),
      ];
      const relations: MacroKnowledgeRelation[] = [
        makeRelation({ id: 'r1', sourceTopicId: 'a', targetTopicId: 'c', type: 'hard_prerequisite' }),
        makeRelation({ id: 'r2', sourceTopicId: 'b', targetTopicId: 'c', type: 'soft_prerequisite' }),
      ];
      const path1 = deriveLearningPath(topics, relations);
      const path2 = deriveLearningPath(topics, relations);

      expect(path1.topicIds).toEqual(path2.topicIds);
      expect(path1.id).toBe(path2.id);
      expect(path1.steps).toEqual(path2.steps);
    });

    it('each step has reason and supportingRelationIds', () => {
      const topics: CourseTopic[] = [
        makeTopic({ id: 'a', originalOrder: 0, originalPageNumbers: [1] }),
        makeTopic({ id: 'b', originalOrder: 1, originalPageNumbers: [2] }),
      ];
      const relations: MacroKnowledgeRelation[] = [
        makeRelation({ id: 'r1', sourceTopicId: 'a', targetTopicId: 'b', type: 'hard_prerequisite' }),
      ];
      const path = deriveLearningPath(topics, relations);

      expect(path.steps.length).toBe(2);
      for (const step of path.steps) {
        expect(typeof step.reason).toBe('string');
        expect(step.reason.length).toBeGreaterThan(0);
        expect(Array.isArray(step.supportingRelationIds)).toBe(true);
      }

      // First step should have empty supportingRelationIds (it is the start)
      expect(path.steps[0].supportingRelationIds.length).toBe(0);

      // Second step should reference the hard_prerequisite relation
      expect(path.steps[1].supportingRelationIds).toContain('r1');
    });

    it("source is 'deterministic'", () => {
      const topics: CourseTopic[] = [makeTopic({ id: 'a' })];
      const path = deriveLearningPath(topics, []);
      expect(path.source).toBe('deterministic');
    });

    it('generatedAt is 0 (deterministic, no real timestamp)', () => {
      const topics: CourseTopic[] = [makeTopic({ id: 'a' })];
      const path = deriveLearningPath(topics, []);
      expect(path.generatedAt).toBe(0);
    });

    it('handles empty topics gracefully', () => {
      const path = deriveLearningPath([], []);
      expect(path.topicIds).toEqual([]);
      expect(path.steps).toEqual([]);
      expect(path.source).toBe('deterministic');
      expect(path.warnings.length).toBeGreaterThan(0);
    });
  });
});
