import type {
  CourseStructureIssue,
  LearningTopic,
  OrderConstraint,
} from './types';

export interface CourseScheduleResult {
  orderedTopicIds: string[];
  removedConstraintIds: string[];
  status: 'ready' | 'degraded';
  issues: CourseStructureIssue[];
  explanations: Record<string, string>;
}

const IMPORTANCE_RANK: Record<LearningTopic['importance'], number> = {
  core: 0,
  important: 1,
  supplementary: 2,
};

function sectionOrder(
  topic: LearningTopic,
  sectionOrderById: ReadonlyMap<string, number>,
): number {
  return Math.min(
    ...topic.sourceSectionIds.map(id => sectionOrderById.get(id) ?? Number.POSITIVE_INFINITY),
  );
}

function hasCycle(topicIds: string[], constraints: OrderConstraint[]): boolean {
  const indegree = new Map(topicIds.map(id => [id, 0]));
  const outgoing = new Map(topicIds.map(id => [id, [] as string[]]));
  constraints.forEach(constraint => {
    indegree.set(constraint.afterTopicId, (indegree.get(constraint.afterTopicId) ?? 0) + 1);
    outgoing.get(constraint.beforeTopicId)?.push(constraint.afterTopicId);
  });

  const queue = topicIds.filter(id => indegree.get(id) === 0);
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited += 1;
    for (const next of outgoing.get(current) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }
  return visited !== topicIds.length;
}

function edgeBelongsToCycle(edge: OrderConstraint, constraints: OrderConstraint[]): boolean {
  const outgoing = new Map<string, string[]>();
  constraints.forEach(constraint => {
    const targets = outgoing.get(constraint.beforeTopicId) ?? [];
    targets.push(constraint.afterTopicId);
    outgoing.set(constraint.beforeTopicId, targets);
  });
  const pending = [edge.afterTopicId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === edge.beforeTopicId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

export function compileCourseOrder(
  topics: LearningTopic[],
  constraints: OrderConstraint[],
  sectionOrderById: ReadonlyMap<string, number>,
): CourseScheduleResult {
  const topicById = new Map(topics.map(topic => [topic.id, topic]));
  const issues: CourseStructureIssue[] = [];
  const explanations: Record<string, string> = {};

  const valid = constraints.filter(constraint => {
    const endpointsExist = topicById.has(constraint.beforeTopicId)
      && topicById.has(constraint.afterTopicId)
      && constraint.beforeTopicId !== constraint.afterTopicId;
    if (!endpointsExist) {
      issues.push({
        code: 'UNKNOWN_TOPIC',
        severity: 'warning',
        message: `顺序约束 ${constraint.id} 引用了不存在或相同的主题`,
      });
    }
    return endpointsExist;
  });

  let hard = valid.filter(constraint => constraint.strength === 'hard');
  const soft = valid.filter(constraint => constraint.strength === 'soft');
  const removedConstraintIds: string[] = [];
  while (hasCycle(topics.map(topic => topic.id), hard)) {
    const removable = hard
      .filter(constraint => constraint.source === 'inferred' && edgeBelongsToCycle(constraint, hard))
      .sort((left, right) => left.confidence - right.confidence || left.id.localeCompare(right.id))[0];
    if (!removable) {
      issues.push({
        code: 'HARD_ORDER_CYCLE',
        severity: 'error',
        message: '硬性学习顺序存在不可自动删除的环',
      });
      return {
        orderedTopicIds: [...topics].sort((a, b) => a.stableKey.localeCompare(b.stableKey)).map(topic => topic.id),
        removedConstraintIds,
        status: 'degraded',
        issues,
        explanations,
      };
    }
    removedConstraintIds.push(removable.id);
    hard = hard.filter(constraint => constraint.id !== removable.id);
  }

  const indegree = new Map(topics.map(topic => [topic.id, 0]));
  const outgoing = new Map(topics.map(topic => [topic.id, [] as OrderConstraint[]]));
  hard.forEach(constraint => {
    indegree.set(constraint.afterTopicId, (indegree.get(constraint.afterTopicId) ?? 0) + 1);
    outgoing.get(constraint.beforeTopicId)?.push(constraint);
  });

  const orderedTopicIds: string[] = [];
  const scheduled = new Set<string>();
  while (orderedTopicIds.length < topics.length) {
    const candidates = topics.filter(topic => !scheduled.has(topic.id) && indegree.get(topic.id) === 0);
    candidates.sort((left, right) => {
      const leftSoft = soft.filter(edge => edge.afterTopicId === left.id && scheduled.has(edge.beforeTopicId)).length;
      const rightSoft = soft.filter(edge => edge.afterTopicId === right.id && scheduled.has(edge.beforeTopicId)).length;
      return rightSoft - leftSoft
        || IMPORTANCE_RANK[left.importance] - IMPORTANCE_RANK[right.importance]
        || left.difficulty - right.difficulty
        || sectionOrder(left, sectionOrderById) - sectionOrder(right, sectionOrderById)
        || left.stableKey.localeCompare(right.stableKey);
    });

    const next = candidates[0];
    if (!next) break;
    orderedTopicIds.push(next.id);
    scheduled.add(next.id);
    const incomingReasons = valid
      .filter(edge => edge.afterTopicId === next.id && scheduled.has(edge.beforeTopicId))
      .map(edge => edge.reason);
    if (incomingReasons.length > 0) explanations[next.id] = incomingReasons.join('；');
    for (const edge of outgoing.get(next.id) ?? []) {
      indegree.set(edge.afterTopicId, (indegree.get(edge.afterTopicId) ?? 0) - 1);
    }
  }

  return {
    orderedTopicIds,
    removedConstraintIds,
    status: 'ready',
    issues,
    explanations,
  };
}
