import {
  CourseTopic,
  MacroKnowledgeRelation,
  MacroRelationType,
  RecommendedLearningPath,
  LearningPathStep,
} from '../types';

// ========== Priority Definitions ==========

/**
 * Relation type priority for topological ordering.
 * Higher value = stronger constraint (removed last during cycle breaking).
 * 'contains' and 'contrasts_with' do NOT participate in topological in-degree.
 */
const RELATION_PRIORITY: Record<MacroRelationType, number> = {
  hard_prerequisite: 5,
  derives_to: 4,
  soft_prerequisite: 3,
  used_by: 2,
  recommended_before: 1,
  contains: 0,
  contrasts_with: 0,
};

/** Relation types that participate in topological ordering. */
const ORDERING_TYPES: Set<MacroRelationType> = new Set([
  'hard_prerequisite',
  'derives_to',
  'soft_prerequisite',
  'used_by',
  'recommended_before',
]);

// ========== Edge Type for Cycle Detection ==========

interface PathEdge {
  id: string;
  source: string;
  target: string;
  type: MacroRelationType;
  priority: number;
  confidence: number;
}

// ========== Helpers ==========

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Reason text for a relation type.
 */
function reasonForRelationType(
  type: MacroRelationType,
  sourceTopicTitle: string | undefined
): string {
  const reasonMap: Record<MacroRelationType, string> = {
    hard_prerequisite: `必须先掌握"${sourceTopicTitle || '前置知识'}"`,
    soft_prerequisite: `建议先了解"${sourceTopicTitle || '前置知识'}"`,
    recommended_before: `推荐在学习"${sourceTopicTitle || '前置知识'}"之后`,
    derives_to: `由"${sourceTopicTitle || '前置知识'}"推导而来`,
    used_by: `"${sourceTopicTitle || '前置知识'}"的工具方法`,
    contains: '',
    contrasts_with: '',
  };
  return reasonMap[type] || '按依赖关系排序';
}

// ========== Cycle Detection ==========

/**
 * Find an edge to remove from a cycle using DFS.
 * Removal priority: lowest priority edge first, then lowest confidence, then stable ID.
 * Returns the edge to remove, or null if no cycle found.
 */
function findCycleEdge(
  topics: CourseTopic[],
  adj: Map<string, string[]>,
  edges: PathEdge[],
  removedEdgeIds: Set<string>
): PathEdge | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const t of topics) color.set(t.id, WHITE);

  const path: string[] = [];

  function dfs(node: string): PathEdge | null {
    color.set(node, GRAY);
    path.push(node);

    for (const neighbor of adj.get(node) || []) {
      if (color.get(neighbor) === WHITE) {
        const result = dfs(neighbor);
        if (result) return result;
      } else if (color.get(neighbor) === GRAY) {
        // Found cycle: neighbor is in current path
        const cycleStart = path.indexOf(neighbor);
        const cycleNodes = path.slice(cycleStart);
        cycleNodes.push(neighbor); // Close the cycle

        // Find all edges in the cycle and pick the one to remove
        let lowest: PathEdge | null = null;
        for (let i = 0; i < cycleNodes.length - 1; i++) {
          const source = cycleNodes[i];
          const target = cycleNodes[i + 1];
          const edge = edges.find(
            e =>
              !removedEdgeIds.has(e.id) &&
              e.source === source &&
              e.target === target
          );
          if (edge) {
            if (
              !lowest ||
              edge.priority < lowest.priority ||
              (edge.priority === lowest.priority &&
                edge.confidence < lowest.confidence) ||
              (edge.priority === lowest.priority &&
                edge.confidence === lowest.confidence &&
                edge.id < lowest.id)
            ) {
              lowest = edge;
            }
          }
        }
        return lowest;
      }
    }

    path.pop();
    color.set(node, BLACK);
    return null;
  }

  for (const t of topics) {
    if (color.get(t.id) === WHITE) {
      const result = dfs(t.id);
      if (result) return result;
    }
  }

  return null;
}

// ========== Main Function ==========

/**
 * Derive a recommended learning path from topics and macro relations.
 *
 * Priority: hard_prerequisite > derives_to > soft_prerequisite > used_by >
 * recommended_before > chapter continuity > original order.
 *
 * - 'contains' and 'contrasts_with' do NOT participate in topological in-degree.
 * - Cycle handling: remove lowest priority edge first, then lowest confidence,
 *   then stable ID.
 * - Cycle removal only affects path derivation - original relations are preserved.
 * - Each step has a reason and supportingRelationIds.
 * - Deterministic: same input always produces same output.
 */
export function deriveLearningPath(
  topics: CourseTopic[],
  relations: MacroKnowledgeRelation[]
): RecommendedLearningPath {
  const warnings: string[] = [];
  const topicIds = new Set(topics.map(t => t.id));
  const topicMap = new Map(topics.map(t => [t.id, t]));

  if (topics.length === 0) {
    return {
      id: 'path_empty',
      topicIds: [],
      steps: [],
      source: 'deterministic',
      warnings: ['无主题可排序'],
      version: 1,
      generatedAt: 0,
    };
  }

  // Filter valid ordering relations (exclude contains and contrasts_with)
  const orderingRelations = relations.filter(
    r =>
      ORDERING_TYPES.has(r.type) &&
      topicIds.has(r.sourceTopicId) &&
      topicIds.has(r.targetTopicId) &&
      r.sourceTopicId !== r.targetTopicId
  );

  // Build edge list
  const edges: PathEdge[] = orderingRelations.map(r => ({
    id: r.id,
    source: r.sourceTopicId,
    target: r.targetTopicId,
    type: r.type,
    priority: RELATION_PRIORITY[r.type],
    confidence: r.confidence,
  }));

  // Remove cycles iteratively
  const removedEdgeIds = new Set<string>();

  for (let round = 0; round < 20; round++) {
    // Build adjacency from remaining edges
    const adj = new Map<string, string[]>();
    for (const t of topics) adj.set(t.id, []);

    for (const edge of edges) {
      if (removedEdgeIds.has(edge.id)) continue;
      adj.get(edge.source)!.push(edge.target);
    }

    const cycleEdge = findCycleEdge(topics, adj, edges, removedEdgeIds);
    if (!cycleEdge) break;

    removedEdgeIds.add(cycleEdge.id);
    warnings.push(
      `检测到学习路径环，已移除关系 ${cycleEdge.id}（类型: ${cycleEdge.type}）`
    );
  }

  // Build final DAG from remaining edges
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const seenEdges = new Set<string>();

  for (const t of topics) {
    inDegree.set(t.id, 0);
    adj.set(t.id, []);
  }

  for (const edge of edges) {
    if (removedEdgeIds.has(edge.id)) continue;
    const key = `${edge.source}->${edge.target}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);

    adj.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  // Topological sort with deterministic tie-breaking
  const firstPageMap = new Map(
    topics.map(t => [t.id, t.originalPageNumbers[0] || 9999])
  );
  const originalOrderMap = new Map(topics.map(t => [t.id, t.originalOrder]));

  const result: string[] = [];
  const queue: string[] = [];

  for (const t of topics) {
    if ((inDegree.get(t.id) || 0) === 0) queue.push(t.id);
  }

  const sortQueue = (q: string[]) => {
    q.sort((a, b) => {
      const pageA = firstPageMap.get(a) || 9999;
      const pageB = firstPageMap.get(b) || 9999;
      if (pageA !== pageB) return pageA - pageB;
      const ordA = originalOrderMap.get(a) || 0;
      const ordB = originalOrderMap.get(b) || 0;
      if (ordA !== ordB) return ordA - ordB;
      return a.localeCompare(b);
    });
  };

  while (queue.length > 0) {
    sortQueue(queue);
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of adj.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  // Remaining nodes - append by original order
  if (result.length < topics.length) {
    const remaining = topics
      .filter(t => !result.includes(t.id))
      .sort(
        (a, b) =>
          (originalOrderMap.get(a.id) || 0) - (originalOrderMap.get(b.id) || 0)
      );
    result.push(...remaining.map(t => t.id));
    warnings.push(
      `${remaining.length}个节点未被前置关系连接，已按课件原始顺序追加`
    );
  }

  // Build steps with reasons and supportingRelationIds
  const steps: LearningPathStep[] = result.map((topicId, position) => {
    // Find supporting relations: relations where source is before this topic
    const supportingRelations = orderingRelations.filter(
      r =>
        !removedEdgeIds.has(r.id) &&
        r.targetTopicId === topicId &&
        result.indexOf(r.sourceTopicId) < position
    );

    const supportingRelationIds = supportingRelations.map(r => r.id);

    let reason: string;
    if (position === 0) {
      reason = '起始知识点';
    } else if (supportingRelations.length > 0) {
      // Use the highest priority supporting relation for the reason
      const topRel = supportingRelations.sort(
        (a, b) =>
          RELATION_PRIORITY[b.type] - RELATION_PRIORITY[a.type] ||
          b.confidence - a.confidence
      )[0];
      const sourceTopic = topicMap.get(topRel.sourceTopicId);
      reason = reasonForRelationType(topRel.type, sourceTopic?.title);
    } else {
      reason = '按课件原始顺序';
    }

    return {
      topicId,
      position,
      reason,
      supportingRelationIds,
    };
  });

  // Deterministic ID based on topic order
  const hashInput = result.join(',');
  const pathId = `path_${hashString(hashInput).toString(36).substring(0, 8)}`;

  return {
    id: pathId,
    topicIds: result,
    steps,
    source: 'deterministic',
    warnings,
    version: 1,
    generatedAt: 0, // Deterministic: no real timestamp
  };
}
