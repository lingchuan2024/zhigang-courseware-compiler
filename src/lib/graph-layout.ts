import { CourseTopic, MacroKnowledgeRelation } from '../types';

// ========== 布局配置 ==========

export interface GraphLayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  layerGap: number;    // 层间距（水平方向，从左到右布局）
  nodeGap: number;     // 同层节点间距（垂直方向）
  paddingX: number;
  paddingY: number;
}

const DEFAULT_OPTIONS: GraphLayoutOptions = {
  nodeWidth: 200,
  nodeHeight: 88,
  layerGap: 130,
  nodeGap: 50,
  paddingX: 80,
  paddingY: 60,
};

// ========== 布局结果 ==========

export interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
  orderInRank: number;
}

export interface EdgePath {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  controlPoints: Array<{ x: number; y: number }>;
  path: string; // SVG path d attribute
}

export interface GraphLayoutResult {
  positions: Map<string, NodePosition>;
  edgePaths: Map<string, EdgePath>;
  bounds: { x: number; y: number; width: number; height: number };
  ranks: Map<string, number>;
}

// ========== 参与排序的关系类型 ==========

const LAYOUT_RELATION_TYPES = new Set([
  'hard_prerequisite',
  'soft_prerequisite',
  'derives_to',
  'used_by',
]);

// ========== 辅助函数 ==========

function getLayoutRelations(relations: MacroKnowledgeRelation[]): MacroKnowledgeRelation[] {
  return relations.filter(r => LAYOUT_RELATION_TYPES.has(r.type));
}

function computeRanks(
  topicIds: string[],
  layoutRelations: MacroKnowledgeRelation[]
): Map<string, number> {
  const ranks = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of topicIds) {
    ranks.set(id, 0);
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const r of layoutRelations) {
    if (!adj.has(r.sourceTopicId) || !adj.has(r.targetTopicId)) continue;
    adj.get(r.sourceTopicId)!.push(r.targetTopicId);
    inDegree.set(r.targetTopicId, (inDegree.get(r.targetTopicId) || 0) + 1);
  }

  const queue: string[] = [];
  for (const id of topicIds) {
    if ((inDegree.get(id) || 0) === 0) queue.push(id);
  }

  // 稳定排序
  queue.sort((a, b) => a.localeCompare(b));

  const sorted: string[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => (ranks.get(a) || 0) - (ranks.get(b) || 0) || a.localeCompare(b));
    const current = queue.shift()!;
    sorted.push(current);

    for (const neighbor of adj.get(current) || []) {
      const newRank = Math.max(ranks.get(neighbor) || 0, (ranks.get(current) || 0) + 1);
      ranks.set(neighbor, newRank);
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  // 剩余节点（有环或孤立）按顺序分配rank
  for (const id of topicIds) {
    if (!sorted.includes(id)) {
      sorted.push(id);
    }
  }

  // 确保rank紧凑（从0开始连续）
  const rankValues = Array.from(ranks.values());
  const minRank = Math.min(...rankValues, 0);
  if (minRank > 0) {
    for (const [id, r] of ranks) {
      ranks.set(id, r - minRank);
    }
  }

  return ranks;
}

function assignOrderInRank(
  topicIds: string[],
  ranks: Map<string, number>,
  layoutRelations: MacroKnowledgeRelation[],
  topicOrderMap: Map<string, number>
): Map<string, number> {
  // 按rank分组
  const rankGroups = new Map<number, string[]>();
  for (const id of topicIds) {
    const r = ranks.get(id) || 0;
    if (!rankGroups.has(r)) rankGroups.set(r, []);
    rankGroups.get(r)!.push(id);
  }

  const orderInRank = new Map<string, number>();

  // 初始排序：按原始课件顺序
  for (const [, nodes] of rankGroups) {
    nodes.sort((a, b) => {
      const ordA = topicOrderMap.get(a) || 0;
      const ordB = topicOrderMap.get(b) || 0;
      if (ordA !== ordB) return ordA - ordB;
      return a.localeCompare(b);
    });
  }

  // 简单的重心排序减少交叉（2轮迭代）
  for (let iter = 0; iter < 2; iter++) {
    const sortedRanks = Array.from(rankGroups.keys()).sort((a, b) => a - b);
    for (const rankVal of sortedRanks) {
      if (rankVal === 0) continue;
      const nodeList = rankGroups.get(rankVal)!;
      const prevNodes = rankGroups.get(rankVal - 1);
      if (!prevNodes) continue;

      const prevOrderMap = new Map<string, number>();
      prevNodes.forEach((id, i) => prevOrderMap.set(id, i));

      nodeList.sort((a, b) => {
        // 计算a的前置节点重心
        let aSum = 0, aCount = 0;
        let bSum = 0, bCount = 0;
        for (const r of layoutRelations) {
          if (r.targetTopicId === a && prevOrderMap.has(r.sourceTopicId)) {
            aSum += prevOrderMap.get(r.sourceTopicId)!;
            aCount++;
          }
          if (r.targetTopicId === b && prevOrderMap.has(r.sourceTopicId)) {
            bSum += prevOrderMap.get(r.sourceTopicId)!;
            bCount++;
          }
        }
        const aBary = aCount > 0 ? aSum / aCount : nodeList.indexOf(a);
        const bBary = bCount > 0 ? bSum / bCount : nodeList.indexOf(b);
        if (Math.abs(aBary - bBary) > 0.001) return aBary - bBary;
        const ordA = topicOrderMap.get(a) || 0;
        const ordB = topicOrderMap.get(b) || 0;
        return ordA - ordB;
      });
    }
  }

  // 分配orderInRank
  for (const [, nodes] of rankGroups) {
    nodes.forEach((id, i) => orderInRank.set(id, i));
  }

  return orderInRank;
}

function calculateNodePositions(
  topicIds: string[],
  ranks: Map<string, number>,
  orderInRank: Map<string, number>,
  options: GraphLayoutOptions,
  topicOrderMap: Map<string, number>
): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();

  // 统计每层节点数
  const rankCounts = new Map<number, number>();
  for (const id of topicIds) {
    const r = ranks.get(id) || 0;
    rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
  }

  const numRanks = rankCounts.size;
  const allInOneRank = numRanks <= 1;

  if (allInOneRank && topicIds.length > 1) {
    // 无前置关系时，使用网格布局（多列排列）
    const n = topicIds.length;
    // 根据节点数决定列数
    let cols: number;
    if (n <= 3) cols = n;
    else if (n <= 6) cols = 3;
    else if (n <= 12) cols = Math.min(4, Math.ceil(Math.sqrt(n * 1.2)));
    else if (n <= 30) cols = 5;
    else cols = 6;

    // 网格模式使用更紧凑的间距
    const gridHGap = Math.min(options.layerGap, 60);
    const gridVGap = Math.min(options.nodeGap, 30);
    const startX = options.paddingX;
    const startY = options.paddingY;

    // 按顺序排列
    const sorted = [...topicIds].sort((a, b) => {
      const oa = topicOrderMap.get(a) ?? 0;
      const ob = topicOrderMap.get(b) ?? 0;
      return oa - ob;
    });

    for (let i = 0; i < sorted.length; i++) {
      const id = sorted[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.set(id, {
        x: startX + col * (options.nodeWidth + gridHGap),
        y: startY + row * (options.nodeHeight + gridVGap),
        width: options.nodeWidth,
        height: options.nodeHeight,
        rank: 0,
        orderInRank: i,
      });
    }
    return positions;
  }

  // 有前置关系时使用DAG分层布局
  const maxRankCount = Math.max(...Array.from(rankCounts.values()), 1);
  const totalHeight = maxRankCount * options.nodeHeight + (maxRankCount - 1) * options.nodeGap;
  const startY = options.paddingY;

  for (const id of topicIds) {
    const rank = ranks.get(id) || 0;
    const order = orderInRank.get(id) || 0;
    const nodesInRank = rankCounts.get(rank) || 1;

    // 该层总高度
    const rankTotalHeight = nodesInRank * options.nodeHeight + (nodesInRank - 1) * options.nodeGap;
    // 垂直居中偏移
    const rankOffsetY = (totalHeight - rankTotalHeight) / 2;

    const x = options.paddingX + rank * (options.nodeWidth + options.layerGap);
    const y = startY + rankOffsetY + order * (options.nodeHeight + options.nodeGap);

    positions.set(id, {
      x,
      y,
      width: options.nodeWidth,
      height: options.nodeHeight,
      rank,
      orderInRank: order,
    });
  }

  return positions;
}

function getNodeEdgeIntersection(
  node: NodePosition,
  targetX: number,
  targetY: number
): { x: number; y: number } {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy };
  }

  const halfW = node.width / 2;
  const halfH = node.height / 2;

  // 计算与矩形边界的交点
  const t1 = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const t2 = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(t1, t2);

  return {
    x: cx + dx * t,
    y: cy + dy * t,
  };
}

function calculateEdgePaths(
  relations: MacroKnowledgeRelation[],
  positions: Map<string, NodePosition>
): Map<string, EdgePath> {
  const edgePaths = new Map<string, EdgePath>();

  // 对同端点的边做偏移处理
  const edgeKeyCount = new Map<string, number>();

  for (const r of relations) {
    const source = positions.get(r.sourceTopicId);
    const target = positions.get(r.targetTopicId);
    if (!source || !target) continue;

    const sourceCx = source.x + source.width / 2;
    const sourceCy = source.y + source.height / 2;
    const targetCx = target.x + target.width / 2;
    const targetCy = target.y + target.height / 2;

    // 边偏移（多条同方向边）
    const edgeKey = `${r.sourceTopicId}->${r.targetTopicId}`;
    const edgeIndex = edgeKeyCount.get(edgeKey) || 0;
    edgeKeyCount.set(edgeKey, edgeIndex + 1);
    const offset = edgeIndex * 8;

    // 计算起点和终点（节点边界交点）
    const sourcePoint = getNodeEdgeIntersection(source, targetCx, targetCy + offset);
    const targetPoint = getNodeEdgeIntersection(target, sourceCx, sourceCy + offset);

    // 贝塞尔曲线控制点
    const dx = targetPoint.x - sourcePoint.x;
    const controlOffset = Math.max(Math.abs(dx) * 0.4, 40);
    const cp1x = sourcePoint.x + controlOffset;
    const cp1y = sourcePoint.y + offset;
    const cp2x = targetPoint.x - controlOffset;
    const cp2y = targetPoint.y + offset;

    const path = `M ${sourcePoint.x} ${sourcePoint.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${targetPoint.x} ${targetPoint.y}`;

    edgePaths.set(r.id, {
      sourceX: sourcePoint.x,
      sourceY: sourcePoint.y,
      targetX: targetPoint.x,
      targetY: targetPoint.y,
      controlPoints: [
        { x: cp1x, y: cp1y },
        { x: cp2x, y: cp2y },
      ],
      path,
    });
  }

  return edgePaths;
}

function calculateBounds(
  positions: Map<string, NodePosition>,
  options: GraphLayoutOptions
): { x: number; y: number; width: number; height: number } {
  if (positions.size === 0) {
    return { x: 0, y: 0, width: 800, height: 500 };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + pos.width);
    maxY = Math.max(maxY, pos.y + pos.height);
  }

  return {
    x: minX - options.paddingX / 2,
    y: minY - options.paddingY / 2,
    width: maxX - minX + options.paddingX,
    height: maxY - minY + options.paddingY,
  };
}

// ========== 主布局函数 ==========

export function layoutKnowledgeGraph(
  topics: CourseTopic[],
  relations: MacroKnowledgeRelation[],
  orderMode: 'original' | 'ai-recommended' = 'original',
  partialOptions?: Partial<GraphLayoutOptions>
): GraphLayoutResult {
  const options: GraphLayoutOptions = { ...DEFAULT_OPTIONS, ...partialOptions };
  const topicIds = topics.map(t => t.id);

  // 确定节点顺序映射
  const topicOrderMap = new Map<string, number>();
  const sorted = [...topics].sort((a, b) => {
    if (orderMode === 'ai-recommended') {
      return a.recommendedOrder - b.recommendedOrder;
    }
    return a.originalOrder - b.originalOrder;
  });
  sorted.forEach((t, i) => topicOrderMap.set(t.id, i));

  // 1. 计算rank（分层）
  const layoutRelations = getLayoutRelations(relations);
  const ranks = computeRanks(topicIds, layoutRelations);

  // 2. 同层排序（减少交叉）
  const orderInRank = assignOrderInRank(topicIds, ranks, layoutRelations, topicOrderMap);

  // 3. 计算节点坐标
  const positions = calculateNodePositions(topicIds, ranks, orderInRank, options, topicOrderMap);

  // 4. 计算边路径
  const edgePaths = calculateEdgePaths(relations, positions);

  // 5. 计算bounds
  const bounds = calculateBounds(positions, options);

  return { positions, edgePaths, bounds, ranks };
}

// ========== 视口适配计算 ==========

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fitViewport(
  bounds: { x: number; y: number; width: number; height: number },
  containerWidth: number,
  containerHeight: number,
  padding: number = 40
): Viewport {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return { ...bounds };
  }

  const scaleX = (containerWidth - padding * 2) / bounds.width;
  const scaleY = (containerHeight - padding * 2) / bounds.height;
  const scale = Math.min(scaleX, scaleY, 1.2); // 最大放大1.2倍

  const viewWidth = containerWidth / scale;
  const viewHeight = containerHeight / scale;

  return {
    x: bounds.x + (bounds.width - viewWidth) / 2,
    y: bounds.y + (bounds.height - viewHeight) / 2,
    width: viewWidth,
    height: viewHeight,
  };
}
