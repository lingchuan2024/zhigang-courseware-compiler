import type { KnowledgeNetworkEdge, KnowledgeNetworkNode } from './knowledge-network-adapter';

export interface KnowledgeNetworkPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
}

export interface KnowledgeNetworkLayout {
  positions: Map<string, KnowledgeNetworkPosition>;
  edgePaths: Map<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface KnowledgeNetworkLayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
  padding: number;
}

const DEFAULT_OPTIONS: KnowledgeNetworkLayoutOptions = {
  nodeWidth: 188,
  nodeHeight: 82,
  columnGap: 118,
  rowGap: 42,
  padding: 64,
};

const SYMMETRIC_RELATIONS = new Set(['contrast_with', 'parallel_with', 'contrasts_with']);
const MAX_RANKS_PER_ROW = 4;

function computeRanks(nodes: KnowledgeNetworkNode[], edges: KnowledgeNetworkEdge[]): Map<string, number> {
  const ids = new Set(nodes.map(node => node.id));
  const ranks = new Map(nodes.map(node => [node.id, 0]));
  const indegree = new Map(nodes.map(node => [node.id, 0]));
  const outgoing = new Map(nodes.map(node => [node.id, [] as string[]]));
  const directional = edges.filter(edge =>
    !edge.isPath &&
    !SYMMETRIC_RELATIONS.has(edge.type) &&
    ids.has(edge.sourceId) &&
    ids.has(edge.targetId) &&
    edge.sourceId !== edge.targetId
  );

  for (const edge of directional) {
    outgoing.get(edge.sourceId)!.push(edge.targetId);
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
  }

  const byOrder = new Map(nodes.map(node => [node.id, node.order]));
  const queue = nodes
    .filter(node => (indegree.get(node.id) ?? 0) === 0)
    .map(node => node.id)
    .sort((a, b) => (byOrder.get(a) ?? 0) - (byOrder.get(b) ?? 0));

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const target of outgoing.get(current) ?? []) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(current) ?? 0) + 1));
      const nextDegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextDegree);
      if (nextDegree === 0) {
        queue.push(target);
        queue.sort((a, b) => (byOrder.get(a) ?? 0) - (byOrder.get(b) ?? 0));
      }
    }
  }

  return ranks;
}

function gridPositions(
  nodes: KnowledgeNetworkNode[],
  options: KnowledgeNetworkLayoutOptions,
): Map<string, KnowledgeNetworkPosition> {
  const sorted = [...nodes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const columns = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(sorted.length * 1.35))));
  const positions = new Map<string, KnowledgeNetworkPosition>();
  sorted.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    positions.set(node.id, {
      x: options.padding + column * (options.nodeWidth + options.columnGap * 0.55),
      y: options.padding + row * (options.nodeHeight + options.rowGap),
      width: options.nodeWidth,
      height: options.nodeHeight,
      rank: 0,
    });
  });
  return positions;
}

function layeredPositions(
  nodes: KnowledgeNetworkNode[],
  ranks: Map<string, number>,
  options: KnowledgeNetworkLayoutOptions,
): Map<string, KnowledgeNetworkPosition> {
  const groups = new Map<number, KnowledgeNetworkNode[]>();
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0;
    const group = groups.get(rank) ?? [];
    group.push(node);
    groups.set(rank, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }
  const largestGroup = Math.max(...Array.from(groups.values(), group => group.length), 1);
  const fullHeight = largestGroup * options.nodeHeight + (largestGroup - 1) * options.rowGap;
  const positions = new Map<string, KnowledgeNetworkPosition>();

  for (const [rank, group] of groups) {
    const groupHeight = group.length * options.nodeHeight + (group.length - 1) * options.rowGap;
    const offsetY = (fullHeight - groupHeight) / 2;
    group.forEach((node, index) => {
      positions.set(node.id, {
        x: options.padding + rank * (options.nodeWidth + options.columnGap),
        y: options.padding + offsetY + index * (options.nodeHeight + options.rowGap),
        width: options.nodeWidth,
        height: options.nodeHeight,
        rank,
      });
    });
  }
  return positions;
}

function wrappedLayeredPositions(
  nodes: KnowledgeNetworkNode[],
  ranks: Map<string, number>,
  options: KnowledgeNetworkLayoutOptions,
): Map<string, KnowledgeNetworkPosition> {
  const groups = new Map<number, KnowledgeNetworkNode[]>();
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0;
    groups.set(rank, [...(groups.get(rank) ?? []), node]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  const maxRank = Math.max(...groups.keys());
  const bandCount = Math.floor(maxRank / MAX_RANKS_PER_ROW) + 1;
  const bandHeights = Array.from({ length: bandCount }, (_, band) => {
    let largestGroup = 1;
    for (let offset = 0; offset < MAX_RANKS_PER_ROW; offset++) {
      largestGroup = Math.max(largestGroup, groups.get(band * MAX_RANKS_PER_ROW + offset)?.length ?? 0);
    }
    return largestGroup * options.nodeHeight + (largestGroup - 1) * options.rowGap;
  });
  const bandY: number[] = [];
  let currentY = options.padding;
  for (const height of bandHeights) {
    bandY.push(currentY);
    currentY += height + options.rowGap * 1.8;
  }

  const columnGap = Math.min(options.columnGap, 72);
  const positions = new Map<string, KnowledgeNetworkPosition>();
  for (const [rank, group] of groups) {
    const band = Math.floor(rank / MAX_RANKS_PER_ROW);
    const offset = rank % MAX_RANKS_PER_ROW;
    const column = band % 2 === 0 ? offset : MAX_RANKS_PER_ROW - 1 - offset;
    const groupHeight = group.length * options.nodeHeight + (group.length - 1) * options.rowGap;
    const offsetY = (bandHeights[band] - groupHeight) / 2;
    group.forEach((node, index) => {
      positions.set(node.id, {
        x: options.padding + column * (options.nodeWidth + columnGap),
        y: bandY[band] + offsetY + index * (options.nodeHeight + options.rowGap),
        width: options.nodeWidth,
        height: options.nodeHeight,
        rank,
      });
    });
  }
  return positions;
}

function nodeBoundaryPoint(
  source: KnowledgeNetworkPosition,
  target: KnowledgeNetworkPosition,
): { x: number; y: number } {
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const scale = Math.min(
    dx === 0 ? Infinity : source.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : source.height / 2 / Math.abs(dy),
  );
  return { x: sourceCenter.x + dx * scale, y: sourceCenter.y + dy * scale };
}

function edgePath(source: KnowledgeNetworkPosition, target: KnowledgeNetworkPosition): string {
  const start = nodeBoundaryPoint(source, target);
  const end = nodeBoundaryPoint(target, source);
  if (Math.abs(end.x - start.x) < 80) {
    const bend = Math.max(52, Math.abs(end.y - start.y) * 0.35);
    return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x + bend} ${end.y}, ${end.x} ${end.y}`;
  }
  const middleX = (start.x + end.x) / 2;
  return `M ${start.x} ${start.y} C ${middleX} ${start.y}, ${middleX} ${end.y}, ${end.x} ${end.y}`;
}

export function routeKnowledgeNetworkEdges(
  edges: KnowledgeNetworkEdge[],
  positions: Map<string, KnowledgeNetworkPosition>,
): Map<string, string> {
  const edgePaths = new Map<string, string>();
  for (const edge of edges) {
    const source = positions.get(edge.sourceId);
    const target = positions.get(edge.targetId);
    if (source && target) edgePaths.set(edge.id, edgePath(source, target));
  }
  return edgePaths;
}

export function layoutKnowledgeNetwork(
  nodes: KnowledgeNetworkNode[],
  edges: KnowledgeNetworkEdge[],
  partialOptions: Partial<KnowledgeNetworkLayoutOptions> = {},
): KnowledgeNetworkLayout {
  const options = { ...DEFAULT_OPTIONS, ...partialOptions };
  if (nodes.length === 0) {
    return {
      positions: new Map(),
      edgePaths: new Map(),
      bounds: { x: 0, y: 0, width: 800, height: 520 },
    };
  }

  const ranks = computeRanks(nodes, edges);
  const hasMultipleRanks = new Set(ranks.values()).size > 1;
  const maxRank = Math.max(...ranks.values());
  const positions = hasMultipleRanks
    ? maxRank >= MAX_RANKS_PER_ROW
      ? wrappedLayeredPositions(nodes, ranks, options)
      : layeredPositions(nodes, ranks, options)
    : gridPositions(nodes, options);
  const edgePaths = routeKnowledgeNetworkEdges(edges, positions);

  const values = Array.from(positions.values());
  const minX = Math.min(...values.map(position => position.x));
  const minY = Math.min(...values.map(position => position.y));
  const maxX = Math.max(...values.map(position => position.x + position.width));
  const maxY = Math.max(...values.map(position => position.y + position.height));
  return {
    positions,
    edgePaths,
    bounds: {
      x: minX - options.padding,
      y: minY - options.padding,
      width: maxX - minX + options.padding * 2,
      height: maxY - minY + options.padding * 2,
    },
  };
}
