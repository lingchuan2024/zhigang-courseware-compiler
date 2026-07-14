/**
 * 学习顺序生成 — 两层学习排序。
 *
 * 第一层：课程级主题学习顺序（CourseLearningPath）
 *   基于主题间强序关系（hard_prerequisite, derived_from, helpful_before）构建有向图，
 *   使用加权边进行稳定拓扑排序，自动检测并打破环。
 *   排序综合考虑：前置约束 > 难度（易优先）> 重要性（核心优先）> 原始文档顺序。
 *
 * 第二层：知识点级讲解块叙事顺序（TopicNarrativePath）
 *   基于讲解块间关系构建有向图，should_explain_before 作为强序约束，
 *   其余关系（defines, explains, derived_from 等）作为软提示，
 *   自动检测并打破环后进行拓扑排序。
 */

import {
  KnowledgeTopic,
  TopicRelation,
  TopicRelationType,
  CourseLearningPath,
  TopicNarrativePath,
  TeachingBlock,
  TeachingRelation,
} from '../types';
import { generateId } from './utils';

// ========== 配置 ==========

/** 关系权重 — 数值越大，约束越强（拓扑排序优先级越高，破环时越不易被移除） */
const RELATION_WEIGHTS: Record<string, number> = {
  hard_prerequisite: 5,
  derived_from: 4,
  helpful_before: 2,
};

/** 参与拓扑排序的强序关系类型集合 */
const STRONG_ORDER_RELATIONS = new Set<string>([
  'hard_prerequisite',
  'derived_from',
  'helpful_before',
]);

// ========== 内部类型 ==========

/** 加权有向边 — 用于主题级拓扑排序和环检测 */
interface WeightedEdge {
  /** 边的唯一标识 */
  id: string;
  /** 起点（前置主题） */
  from: string;
  /** 终点（后继主题） */
  to: string;
  /** 边权重（来自 RELATION_WEIGHTS） */
  weight: number;
  /** 置信度（0-1） */
  confidence: number;
  /** 关系类型（用于生成原因文本和破环策略） */
  type: TopicRelationType;
  /** 原始关系 ID（用于追溯） */
  relationId?: string;
}

// ========== 辅助函数 ==========

/**
 * 从块 ID 中解析 orderIndex。
 *
 * 块 ID 格式为 `blk_{documentId}_{orderIndex}_{contentHashShort}`，
 * 其中 orderIndex 是以 `_` 分割后的倒数第二段（contentHashShort 为十六进制，不含下划线）。
 *
 * @param blockId - 块 ID 字符串
 * @returns orderIndex 数值，解析失败返回 null
 */
function parseBlockOrderIndex(blockId: string): number | null {
  if (!blockId) return null;
  const parts = blockId.split('_');
  if (parts.length < 3) return null;
  // 倒数第二段是 orderIndex
  const candidate = parts[parts.length - 2];
  const num = parseInt(candidate, 10);
  return Number.isNaN(num) ? null : num;
}

/**
 * 从知识点的 sourceRanges 中提取原始文档顺序键。
 *
 * 遍历所有来源范围，解析 startBlockId 中编码的 orderIndex，
 * 返回最小的 orderIndex 作为排序键。如果没有来源范围，
 * 返回 Number.MAX_SAFE_INTEGER（排到最后）。
 *
 * @param topic - 知识点
 * @returns 最小的块 orderIndex，或 Number.MAX_SAFE_INTEGER
 */
function getTopicOriginalOrder(topic: KnowledgeTopic): number {
  if (!topic.sourceRanges || topic.sourceRanges.length === 0) {
    return Number.MAX_SAFE_INTEGER;
  }

  let minOrder = Number.MAX_SAFE_INTEGER;

  for (const range of topic.sourceRanges) {
    const orderIndex = parseBlockOrderIndex(range.startBlockId);
    if (orderIndex !== null && orderIndex < minOrder) {
      minOrder = orderIndex;
    }
  }

  return minOrder;
}

/**
 * 使用 DFS 染色算法检测有向图中的所有环。
 *
 * 颜色定义：
 * - WHITE (0)：未访问
 * - GRAY (1)：在当前 DFS 路径中（正在访问）
 * - BLACK (2)：已完成访问
 *
 * 当遇到 GRAY 节点时，说明找到了一个环（回边），
 * 从当前 DFS 路径中提取环的节点序列。
 *
 * @param nodeIds - 所有节点 ID
 * @param edges - 有向边列表（仅需 from 和 to 字段）
 * @returns 找到的所有环，每个环是节点 ID 数组；无环时返回空数组
 */
function detectCycles(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>
): string[][] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    color.set(id, WHITE);
    adj.set(id, []);
  }

  for (const edge of edges) {
    if (color.has(edge.from) && color.has(edge.to) && edge.from !== edge.to) {
      adj.get(edge.from)!.push(edge.to);
    }
  }

  const cycles: string[][] = [];
  const path: string[] = [];

  function dfs(node: string): void {
    color.set(node, GRAY);
    path.push(node);

    for (const neighbor of adj.get(node) || []) {
      if (color.get(neighbor) === WHITE) {
        dfs(neighbor);
      } else if (color.get(neighbor) === GRAY) {
        // 找到回边 → 存在环，从当前路径中提取
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart);
        cycles.push([...cycle]);
      }
    }

    path.pop();
    color.set(node, BLACK);
  }

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) {
      dfs(id);
    }
  }

  return cycles;
}

/**
 * 通过移除边来打破有向图中的所有环。
 *
 * 策略：将边按 confidence * weight 升序排序（最弱的边排前面），
 * 逐条尝试移除，每次移除后检测是否还有环，直到无环为止。
 *
 * @param nodeIds - 所有节点 ID
 * @param edges - 加权有向边列表
 * @returns 移除环边后剩余的边列表
 */
function breakCycles(
  nodeIds: string[],
  edges: Array<{ from: string; to: string; weight: number; confidence: number }>
): Array<{ from: string; to: string; weight: number; confidence: number }> {
  const workingEdges = [...edges];

  // 按 confidence * weight 升序排序（最弱的边最先被移除）
  const sortedByStrength = [...workingEdges].sort(
    (a, b) => a.confidence * a.weight - b.confidence * b.weight
  );

  for (const candidate of sortedByStrength) {
    // 检测当前是否还有环
    const cycles = detectCycles(nodeIds, workingEdges);
    if (cycles.length === 0) {
      break; // 已无环
    }

    // 从工作集中移除当前候选边
    const idx = workingEdges.findIndex(
      e => e.from === candidate.from && e.to === candidate.to
    );
    if (idx >= 0) {
      workingEdges.splice(idx, 1);
    }
  }

  return workingEdges;
}

/**
 * 使用 Kahn 算法进行加权拓扑排序。
 *
 * 优先队列排序规则：入边最大权重降序，然后入边最大置信度降序，
 * 最后按节点 ID 升序保证稳定性。
 *
 * 如果检测到环（结果不完整），移除 confidence * weight 最低的边后重试，
 * 直到所有节点都被排序或无边可移除。
 *
 * @param nodeIds - 所有节点 ID
 * @param edges - 加权有向边列表
 * @returns 拓扑排序后的节点 ID 数组
 */
function topologicalSort(
  nodeIds: string[],
  edges: Array<{ from: string; to: string; weight: number; confidence: number }>
): string[] {
  const workingEdges = [...edges];

  for (;;) {
    // 构建邻接表和入度表
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    for (const id of nodeIds) {
      adj.set(id, []);
      inDegree.set(id, 0);
    }
    for (const edge of workingEdges) {
      if (adj.has(edge.from) && adj.has(edge.to) && edge.from !== edge.to) {
        adj.get(edge.from)!.push(edge.to);
        inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
      }
    }

    // 预计算每个节点的最大入边权重和置信度（用于优先级排序）
    const maxIncoming = new Map<string, { weight: number; confidence: number }>();
    for (const id of nodeIds) {
      maxIncoming.set(id, { weight: 0, confidence: 0 });
    }
    for (const edge of workingEdges) {
      if (maxIncoming.has(edge.to) && edge.from !== edge.to) {
        const current = maxIncoming.get(edge.to)!;
        if (
          edge.weight > current.weight ||
          (edge.weight === current.weight && edge.confidence > current.confidence)
        ) {
          maxIncoming.set(edge.to, { weight: edge.weight, confidence: edge.confidence });
        }
      }
    }

    // Kahn 算法主体
    const result: string[] = [];
    const available: string[] = [];

    for (const id of nodeIds) {
      if ((inDegree.get(id) || 0) === 0) {
        available.push(id);
      }
    }

    while (available.length > 0) {
      // 优先队列：按入边权重降序 → 置信度降序 → ID 升序
      available.sort((a, b) => {
        const wa = maxIncoming.get(a)!;
        const wb = maxIncoming.get(b)!;
        if (wa.weight !== wb.weight) return wb.weight - wa.weight;
        if (wa.confidence !== wb.confidence) return wb.confidence - wa.confidence;
        return a.localeCompare(b);
      });

      const current = available.shift()!;
      result.push(current);

      for (const neighbor of adj.get(current) || []) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          available.push(neighbor);
        }
      }
    }

    // 所有节点已排序 → 完成
    if (result.length === nodeIds.length) {
      return result;
    }

    // 无边可移除 → 追加剩余节点
    if (workingEdges.length === 0) {
      const remaining = nodeIds.filter(id => !result.includes(id));
      return [...result, ...remaining];
    }

    // 检测到环：移除 confidence * weight 最低的边后重试
    let weakestIdx = 0;
    for (let i = 1; i < workingEdges.length; i++) {
      const score = workingEdges[i].confidence * workingEdges[i].weight;
      const weakestScore =
        workingEdges[weakestIdx].confidence * workingEdges[weakestIdx].weight;
      if (score < weakestScore) {
        weakestIdx = i;
      }
    }
    workingEdges.splice(weakestIdx, 1);
  }
}

// ========== 主函数 ==========

/**
 * 生成课程级主题学习路径。
 *
 * 基于主题间的强序关系（hard_prerequisite, derived_from, helpful_before）
 * 构建有向加权图，进行稳定拓扑排序。
 *
 * 排序优先级：
 * 1. 前置约束（拓扑序必须满足）
 * 2. 难度（易优先）
 * 3. 重要性（核心优先）
 * 4. 原始文档顺序（首个 sourceRange 的 block orderIndex）
 *
 * 环处理策略：
 * 1. 优先移除低置信度的 helpful_before 边
 * 2. 若仍有环，按 confidence * weight 升序逐条移除最低置信度边
 *
 * @param topics - 所有知识主题
 * @param relations - 主题间关系
 * @returns 课程学习路径（含有序主题 ID 列表和每步原因）
 */
export function generateCourseLearningPath(
  topics: KnowledgeTopic[],
  relations: TopicRelation[]
): CourseLearningPath {
  // 边界情况：无主题
  if (topics.length === 0) {
    return { orderedTopicIds: [], steps: [] };
  }

  const topicMap = new Map(topics.map(t => [t.id, t]));
  const topicIds = topics.map(t => t.id);
  const topicIdSet = new Set(topicIds);

  // 1. 构建加权有向图（仅使用 STRONG_ORDER_RELATIONS）
  let edges: WeightedEdge[] = relations
    .filter(
      r =>
        STRONG_ORDER_RELATIONS.has(r.type) &&
        topicIdSet.has(r.sourceTopicId) &&
        topicIdSet.has(r.targetTopicId) &&
        r.sourceTopicId !== r.targetTopicId
    )
    .map(r => ({
      id: generateId('edge'),
      from: r.sourceTopicId,
      to: r.targetTopicId,
      weight: RELATION_WEIGHTS[r.type] || 1,
      confidence: r.confidence,
      type: r.type,
      relationId: r.id,
    }));

  // 2. 检测环并处理
  const cycles = detectCycles(topicIds, edges);

  if (cycles.length > 0) {
    // 策略 1：优先移除低置信度的 helpful_before 边
    const helpfulBeforeEdges = edges
      .filter(e => e.type === 'helpful_before')
      .sort((a, b) => a.confidence - b.confidence);

    for (const edge of helpfulBeforeEdges) {
      const currentCycles = detectCycles(topicIds, edges);
      if (currentCycles.length === 0) break;

      edges = edges.filter(e => e.id !== edge.id);
    }

    // 策略 2：若仍有环，使用 breakCycles 移除最低 confidence*weight 边
    const remainingCycles = detectCycles(topicIds, edges);
    if (remainingCycles.length > 0) {
      const simpleEdges = edges.map(e => ({
        from: e.from,
        to: e.to,
        weight: e.weight,
        confidence: e.confidence,
      }));
      const remainingSimpleEdges = breakCycles(topicIds, simpleEdges);

      // 将简化边匹配回原始 WeightedEdge（保留 type 和 relationId）
      const remainingPairs = new Set(
        remainingSimpleEdges.map(e => `${e.from}->${e.to}`)
      );
      edges = edges.filter(e => remainingPairs.has(`${e.from}->${e.to}`));
    }
  }

  // 3. 构建邻接表和入度表（去重平行边）
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const t of topics) {
    adj.set(t.id, []);
    inDegree.set(t.id, 0);
  }
  const seenPairs = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    adj.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }

  // 4. 预计算排序键
  const importanceOrder: Record<string, number> = {
    core: 0,
    important: 1,
    supplementary: 2,
  };
  const originalOrderMap = new Map(
    topics.map(t => [t.id, getTopicOriginalOrder(t)])
  );

  // 5. 稳定拓扑排序（Kahn 算法 + 多级优先级）
  const result: string[] = [];
  const available: string[] = [];

  for (const t of topics) {
    if ((inDegree.get(t.id) || 0) === 0) {
      available.push(t.id);
    }
  }

  /**
   * 对可用节点排序：难度升序 → 重要性升序 → 原始顺序升序 → ID 稳定性
   */
  const sortAvailable = (arr: string[]) => {
    arr.sort((a, b) => {
      const ta = topicMap.get(a)!;
      const tb = topicMap.get(b)!;

      // 1. 难度升序（易优先）
      if (ta.difficulty !== tb.difficulty) {
        return ta.difficulty - tb.difficulty;
      }

      // 2. 重要性（核心优先）
      const impA = importanceOrder[ta.importance] ?? 1;
      const impB = importanceOrder[tb.importance] ?? 1;
      if (impA !== impB) {
        return impA - impB;
      }

      // 3. 原始文档顺序
      const ordA = originalOrderMap.get(a) ?? Number.MAX_SAFE_INTEGER;
      const ordB = originalOrderMap.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (ordA !== ordB) {
        return ordA - ordB;
      }

      // 4. ID 稳定性
      return a.localeCompare(b);
    });
  };

  while (available.length > 0) {
    sortAvailable(available);
    const current = available.shift()!;
    result.push(current);

    for (const neighbor of adj.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        available.push(neighbor);
      }
    }
  }

  // 追加未被前置关系连接的残余节点
  if (result.length < topics.length) {
    const remaining = topics
      .filter(t => !result.includes(t.id))
      .sort((a, b) => {
        const ordA = originalOrderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const ordB = originalOrderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return ordA - ordB;
      });
    result.push(...remaining.map(t => t.id));
  }

  // 6. 生成步骤（原因 + 前置主题 ID）
  const steps = result.map((topicId, position) => {
    const topic = topicMap.get(topicId);

    // 收集前置主题 ID：所有指向当前主题的边，且源主题在当前主题之前
    const prerequisiteTopicIds = edges
      .filter(e => e.to === topicId && result.indexOf(e.from) < position)
      .map(e => e.from);

    // 生成原因文本
    let reason: string;
    if (position === 0) {
      reason = '起始知识点，无需前置';
    } else if (prerequisiteTopicIds.length > 0) {
      // 找到权重最高的前置关系作为主要原因
      const supportingEdges = edges
        .filter(e => e.to === topicId && result.indexOf(e.from) < position)
        .sort((a, b) => b.weight - a.weight || b.confidence - a.confidence);
      const topEdge = supportingEdges[0];
      const sourceTopic = topicMap.get(topEdge.from);
      const sourceName = sourceTopic?.name || '前置知识';

      if (topEdge.type === 'hard_prerequisite') {
        reason = `必须先掌握"${sourceName}"`;
      } else if (topEdge.type === 'derived_from') {
        reason = `由"${sourceName}"推导而来`;
      } else {
        reason = `建议先学习"${sourceName}"`;
      }
    } else {
      // 无前置关系，按难度和重要性排序
      if (topic) {
        reason = `按难度（${topic.difficulty}）和重要性（${topic.importance}）排序`;
      } else {
        reason = '按默认顺序排列';
      }
    }

    return {
      topicId,
      reason,
      prerequisiteTopicIds,
    };
  });

  return {
    orderedTopicIds: result,
    steps,
  };
}

/**
 * 生成所有知识点的讲解块叙事路径。
 *
 * 对每个知识点，基于其讲解块间关系构建有向图：
 * - should_explain_before 作为强序约束（高权重）
 * - defines, explains, derived_from, example_of, supports,
 *   contrasts_with, qualifies 作为软提示（低权重）
 *
 * 检测并打破环后进行拓扑排序。如果某知识点没有任何讲解关系，
 * 保持讲解块的原始顺序（AI 提取时的顺序）。
 *
 * @param topics - 所有知识主题
 * @param teachingBlocks - 所有讲解块
 * @param teachingRelations - 所有讲解块间关系
 * @returns topicId -> TopicNarrativePath 的映射
 */
export function generateNarrativePaths(
  topics: KnowledgeTopic[],
  teachingBlocks: TeachingBlock[],
  teachingRelations: TeachingRelation[]
): Record<string, TopicNarrativePath> {
  const result: Record<string, TopicNarrativePath> = {};

  /** 软提示关系的权重映射 */
  const SOFT_HINT_WEIGHTS: Record<string, number> = {
    should_explain_before: 5,
    defines: 3,
    derived_from: 3,
    explains: 2,
    example_of: 1,
    supports: 1,
    contrasts_with: 1,
    qualifies: 1,
  };

  /** 强序关系集合（用于生成 rationale） */
  const STRONG_RELATION_TYPES = new Set(['should_explain_before']);

  for (const topic of topics) {
    // 获取属于当前主题的讲解块
    const blocks = teachingBlocks.filter(b => b.topicId === topic.id);

    if (blocks.length === 0) {
      continue;
    }

    // 获取属于当前主题的有效讲解关系
    const blockIdSet = new Set(blocks.map(b => b.id));
    const topicRelations = teachingRelations.filter(
      r =>
        r.topicId === topic.id &&
        blockIdSet.has(r.sourceBlockId) &&
        blockIdSet.has(r.targetBlockId) &&
        r.sourceBlockId !== r.targetBlockId
    );

    // 无讲解关系 → 保持原始顺序
    if (topicRelations.length === 0) {
      result[topic.id] = {
        topicId: topic.id,
        orderedTeachingBlockIds: blocks.map(b => b.id),
        rationale: '无讲解关系，保持 AI 原始叙事顺序',
      };
      continue;
    }

    // 构建加权边
    const nodeIds = blocks.map(b => b.id);
    const edges: Array<{
      from: string;
      to: string;
      weight: number;
      confidence: number;
    }> = topicRelations.map(rel => ({
      from: rel.sourceBlockId,
      to: rel.targetBlockId,
      weight: SOFT_HINT_WEIGHTS[rel.type] || 1,
      confidence: rel.confidence,
    }));

    // 检测并打破环
    const cycles = detectCycles(nodeIds, edges);
    let workingEdges = edges;
    if (cycles.length > 0) {
      workingEdges = breakCycles(nodeIds, edges);
    }

    // 拓扑排序
    const orderedIds = topologicalSort(nodeIds, workingEdges);

    // 补充可能缺失的块（拓扑排序残余）
    const orderedSet = new Set(orderedIds);
    const missingBlocks = blocks
      .filter(b => !orderedSet.has(b.id))
      .map(b => b.id);
    const finalOrder = [...orderedIds, ...missingBlocks];

    // 生成 rationale
    const hasStrongRelations = topicRelations.some(r =>
      STRONG_RELATION_TYPES.has(r.type)
    );

    let rationale: string;
    if (hasStrongRelations) {
      rationale = '按讲解关系拓扑排序（should_explain_before 强序约束 + 软提示）';
    } else {
      rationale = '按软提示关系（defines, explains, derived_from 等）排序';
    }

    result[topic.id] = {
      topicId: topic.id,
      orderedTeachingBlockIds: finalOrder,
      rationale,
    };
  }

  return result;
}
