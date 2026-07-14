import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeNetworkCanvas } from '../knowledge-network/KnowledgeNetworkCanvas';
import type { KnowledgeNetworkModel } from '../../lib/knowledge-network-adapter';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const model: KnowledgeNetworkModel = {
  nodes: [
    { id: 't1', label: '概率模型', description: '描述', kind: 'topic', category: 'concept', importance: 'core', confidence: 0.9, sourceRanges: [], order: 0, sequence: 1 },
    { id: 't2', label: '最大似然估计', description: '描述', kind: 'topic', category: 'concept', importance: 'important', confidence: 0.8, sourceRanges: [], order: 1, sequence: 2 },
  ],
  edges: [
    { id: 'r1', sourceId: 't1', targetId: 't2', type: 'hard_prerequisite', label: '硬前置', reason: '', confidence: 0.9, isPath: false },
  ],
  pathEdges: [],
  warnings: [],
};

function renderCanvas(
  onSelect = vi.fn(),
  graph: KnowledgeNetworkModel = model,
  onCollapseExpandedGroup?: ReturnType<typeof vi.fn>,
): { container: HTMLElement; onSelect: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(KnowledgeNetworkCanvas, {
    model: graph,
    selectedId: null,
    onSelect,
    search: '',
    onCollapseExpandedGroup,
  })));
  return { container, onSelect };
}

describe('KnowledgeNetworkCanvas', () => {
  it('selects a graph node and renders its traversal number', () => {
    const rendered = renderCanvas();
    const node = rendered.container.querySelector<SVGGElement>('[aria-label="概率模型"]')!;

    act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(rendered.onSelect).toHaveBeenCalledWith('t1');
    expect(node.textContent).toContain('1');
  });

  it('supports keyboard node selection', () => {
    const rendered = renderCanvas();
    const node = rendered.container.querySelector<SVGGElement>('[aria-label="最大似然估计"]')!;

    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));

    expect(rendered.onSelect).toHaveBeenCalledWith('t2');
  });

  it('renders the internal network as a distinct dismissible region', () => {
    const onCollapse = vi.fn();
    const expanded: KnowledgeNetworkModel = {
      ...model,
      nodes: [
        ...model.nodes,
        { id: 'b1', label: 'GLM 公式', description: '公式结构', kind: 'teaching', category: 'formula', importance: 'required', confidence: 0.9, sourceRanges: [], order: 2, sequence: 1 },
      ],
      edges: [
        ...model.edges,
        { id: 'bridge', sourceId: 't2', targetId: 'b1', type: 'contains_internal', label: '内部知识', reason: '', confidence: 1, isPath: false },
      ],
      focusNodeIds: ['b1'],
      expandedGroup: {
        topicId: 't2',
        label: '最大似然估计 · 内部知识网',
        nodeIds: ['b1'],
      },
    };

    const rendered = renderCanvas(vi.fn(), expanded, onCollapse);

    expect(rendered.container.querySelector('[data-testid="expanded-network-group"]')).not.toBeNull();
    expect(rendered.container.querySelector('[data-node="t1"]')?.getAttribute('data-network-layer')).toBe('course');
    expect(rendered.container.querySelector('[data-node="b1"]')?.getAttribute('data-network-layer')).toBe('internal');

    const close = rendered.container.querySelector<SVGGElement>('[aria-label="收起内部知识网"]')!;
    act(() => close.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
