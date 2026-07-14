import { describe, expect, it } from 'vitest';
import type { KnowledgeNetworkEdge, KnowledgeNetworkNode } from '../knowledge-network-adapter';
import { layoutKnowledgeNetwork } from '../knowledge-network-layout';

function node(id: string, order: number): KnowledgeNetworkNode {
  return {
    id,
    label: id,
    description: '',
    kind: 'topic',
    category: 'concept',
    importance: 'important',
    confidence: 0.9,
    sourceRanges: [],
    order,
  };
}

function edge(id: string, sourceId: string, targetId: string): KnowledgeNetworkEdge {
  return {
    id,
    sourceId,
    targetId,
    type: 'hard_prerequisite',
    label: '硬前置',
    reason: '',
    confidence: 0.9,
    isPath: false,
  };
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

describe('layoutKnowledgeNetwork', () => {
  it('returns finite non-overlapping positions for every node', () => {
    const nodes = Array.from({ length: 8 }, (_, index) => node(`n${index}`, index));
    const edges = [edge('e1', 'n0', 'n3'), edge('e2', 'n1', 'n3'), edge('e3', 'n3', 'n5')];
    const result = layoutKnowledgeNetwork(nodes, edges);
    const positions = nodes.map(item => result.positions.get(item.id)!);

    expect(positions.every(position => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        expect(overlaps(positions[i], positions[j])).toBe(false);
      }
    }
  });

  it('places prerequisite sources to the left of their targets', () => {
    const result = layoutKnowledgeNetwork(
      [node('prerequisite', 0), node('dependent', 1)],
      [edge('e1', 'prerequisite', 'dependent')],
    );

    const source = result.positions.get('prerequisite')!;
    const target = result.positions.get('dependent')!;
    expect(source.x + source.width).toBeLessThan(target.x);
    expect(result.edgePaths.get('e1')).toContain('M ');
  });

  it('wraps a long prerequisite chain into readable rows instead of one tiny horizontal line', () => {
    const nodes = Array.from({ length: 9 }, (_, index) => node(`chain-${index}`, index));
    const edges = nodes.slice(0, -1).map((item, index) => (
      edge(`chain-edge-${index}`, item.id, nodes[index + 1].id)
    ));

    const result = layoutKnowledgeNetwork(nodes, edges);
    const positions = nodes.map(item => result.positions.get(item.id)!);

    expect(new Set(positions.map(position => position.y)).size).toBeGreaterThan(1);
    expect(result.bounds.width).toBeLessThan(1500);
    expect(result.bounds.height).toBeGreaterThan(350);
  });
});
