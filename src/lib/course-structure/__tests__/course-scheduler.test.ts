import { describe, expect, it } from 'vitest';
import type { LearningTopic, OrderConstraint } from '../types';
import { compileCourseOrder } from '../course-scheduler';

const topic = (
  id: string,
  difficulty: 1 | 2 | 3 | 4 | 5,
  importance: LearningTopic['importance'] = 'important',
): LearningTopic => ({
  id,
  stableKey: id,
  courseId: 'c',
  name: id,
  aliases: [],
  learningObjective: `掌握 ${id}`,
  scope: id,
  genre: 'concept',
  difficulty,
  importance,
  evidenceIds: [`e-${id}`],
  sourceSectionIds: ['s1'],
  confidence: 0.9,
  status: 'verified',
});

const hard = (
  id: string,
  before: string,
  after: string,
  source: OrderConstraint['source'] = 'explicit',
  confidence = 0.9,
): OrderConstraint => ({
  id,
  beforeTopicId: before,
  afterTopicId: after,
  strength: 'hard',
  reason: `${before} before ${after}`,
  evidenceIds: source === 'inferred' ? [] : ['e'],
  source,
  confidence,
});

const soft = (
  id: string,
  before: string,
  after: string,
  confidence = 0.9,
): OrderConstraint => ({
  id,
  beforeTopicId: before,
  afterTopicId: after,
  strength: 'soft',
  reason: `${before} before ${after}`,
  evidenceIds: [],
  source: 'inferred',
  confidence,
});

describe('course scheduler', () => {
  it('satisfies hard constraints before pedagogical preferences', () => {
    expect(compileCourseOrder(
      [topic('advanced', 5, 'core'), topic('basic', 1)],
      [hard('r1', 'basic', 'advanced')],
      new Map([['s1', 0]]),
    ).orderedTopicIds).toEqual(['basic', 'advanced']);
  });

  it('uses acyclic soft prerequisites as real ordering constraints', () => {
    const result = compileCourseOrder(
      [topic('advanced', 1, 'core'), topic('basic', 5, 'supplementary')],
      [soft('r1', 'basic', 'advanced')],
      new Map([['s1', 0]]),
    );

    expect(result.orderedTopicIds).toEqual(['basic', 'advanced']);
    expect(result.removedConstraintIds).toEqual([]);
  });

  it('drops the weaker conflicting soft prerequisite and keeps the stronger direction', () => {
    const result = compileCourseOrder(
      [topic('a', 1), topic('b', 1)],
      [soft('strong', 'a', 'b', 0.95), soft('weak', 'b', 'a', 0.35)],
      new Map([['s1', 0]]),
    );

    expect(result.orderedTopicIds).toEqual(['a', 'b']);
    expect(result.removedConstraintIds).toEqual(['weak']);
  });

  it('removes the weakest inferred edge in a cycle', () => {
    const result = compileCourseOrder(
      [topic('a', 1), topic('b', 2)],
      [hard('r1', 'a', 'b'), hard('r2', 'b', 'a', 'inferred', 0.2)],
      new Map([['s1', 0]]),
    );
    expect(result.orderedTopicIds).toEqual(['a', 'b']);
    expect(result.removedConstraintIds).toEqual(['r2']);
  });

  it('does not remove a weaker inferred edge outside the cycle', () => {
    const unrelated = hard('unrelated', 'c', 'd', 'inferred', 0.1);
    const result = compileCourseOrder(
      [topic('a', 1), topic('b', 2), topic('c', 1), topic('d', 2)],
      [hard('r1', 'a', 'b'), hard('r2', 'b', 'a', 'inferred', 0.2), unrelated],
      new Map([['s1', 0]]),
    );
    expect(result.removedConstraintIds).toEqual(['r2']);
  });

  it('degrades instead of deleting a corrected cycle', () => {
    const result = compileCourseOrder(
      [topic('a', 1), topic('b', 2)],
      [hard('r1', 'a', 'b', 'corrected'), hard('r2', 'b', 'a', 'corrected')],
      new Map([['s1', 0]]),
    );
    expect(result.status).toBe('degraded');
    expect(result.issues[0].code).toBe('HARD_ORDER_CYCLE');
    expect(new Set(result.orderedTopicIds)).toEqual(new Set(['a', 'b']));
  });

  it('reports constraints that point outside the topic catalog', () => {
    const result = compileCourseOrder(
      [topic('a', 1)],
      [hard('bad', 'missing', 'a')],
      new Map([['s1', 0]]),
    );
    expect(result.issues[0].code).toBe('UNKNOWN_TOPIC');
  });
});
