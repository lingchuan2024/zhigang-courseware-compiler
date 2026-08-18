import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeStructureView } from '../KnowledgeStructureView';
import { useStore } from '../../store/useStore';
import type { MarkdownBlock, SourceDocument } from '../../types';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function block(id: string, orderIndex: number, content: string): MarkdownBlock {
  return {
    id, documentId: 'doc-1', type: orderIndex === 0 ? 'heading' : 'paragraph', content,
    headingPath: ['概率模型'], orderIndex, contentHash: `hash-${id}`,
  };
}

const blocks = [block('b1', 0, '# 概率模型'), block('b2', 1, '课程原文：概率模型定义'), block('b3', 2, '内部原文：概率模型案例')];
const sourceDocument: SourceDocument = {
  id: 'doc-1', courseId: 'course-1', title: '概率论课件', markdown: blocks.map(item => item.content).join('\n\n'),
  blocks, outline: [], contentHash: 'hash', createdAt: '2026-07-13', updatedAt: '2026-07-13',
};

const mountedRoots: Root[] = [];

function renderView(): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => root.render(createElement(KnowledgeStructureView, { onOpenSettings: vi.fn() })));
  return { container, root };
}

beforeEach(() => {
  act(() => useStore.setState({
    stage: 'structure',
    sourceDocuments: [sourceDocument],
    knowledgeTopics: [
      {
        id: 't1', courseId: 'course-1', name: '概率模型', aliases: [], summary: '摘要', learningObjective: '理解概率模型',
        sourceRanges: [{ documentId: 'doc-1', startBlockId: 'b1', endBlockId: 'b2' }], childTopicIds: [],
        importance: 'core', difficulty: 2, knowledgeGenre: 'concept', confidence: 0.9, status: 'generated',
      },
      {
        id: 't2', courseId: 'course-1', name: '最大似然估计', aliases: [], summary: '摘要', learningObjective: '理解最大似然',
        sourceRanges: [{ documentId: 'doc-1', startBlockId: 'b2', endBlockId: 'b3' }], childTopicIds: [],
        importance: 'important', difficulty: 3, knowledgeGenre: 'mathematical_derivation', confidence: 0.85, status: 'generated',
      },
    ],
    topicRelations: [
      { id: 'r1', sourceTopicId: 't1', targetTopicId: 't2', type: 'hard_prerequisite', reason: '先理解概率模型', confidence: 0.9 },
    ],
    teachingBlocks: [
      {
        id: 'tb1', topicId: 't1', type: 'definition', title: '概率模型定义',
        sourceRanges: [{ documentId: 'doc-1', startBlockId: 'b2', endBlockId: 'b2' }], summary: '定义', importance: 'required', confidence: 0.9,
      },
      {
        id: 'tb2', topicId: 't1', type: 'example', title: '概率模型案例',
        sourceRanges: [{ documentId: 'doc-1', startBlockId: 'b3', endBlockId: 'b3' }], summary: '案例', importance: 'supporting', confidence: 0.8,
      },
    ],
    teachingRelations: [
      { id: 'tr1', topicId: 't1', sourceBlockId: 'tb1', targetBlockId: 'tb2', type: 'example_of', reason: '案例说明定义', confidence: 0.9 },
    ],
    courseLearningPath: {
      orderedTopicIds: ['t1', 't2'],
      steps: [
        { topicId: 't1', reason: '基础', prerequisiteTopicIds: [] },
        { topicId: 't2', reason: '后续', prerequisiteTopicIds: ['t1'] },
      ],
    },
    narrativePaths: {
      t1: { topicId: 't1', orderedTeachingBlockIds: ['tb1', 'tb2'], rationale: '先定义后案例' },
    },
    knowledgePipelineStatus: 'ready',
    jobStatus: 'completed',
  }));
});

afterEach(() => {
  act(() => mountedRoots.splice(0).forEach(root => root.unmount()));
  document.body.innerHTML = '';
});

describe('KnowledgeStructureView two-layer network', () => {
  it('shows the course network and exact source for a selected topic', () => {
    const { container } = renderView();
    expect(container.querySelector('[data-testid="knowledge-network-canvas"]')).not.toBeNull();
    const topic = container.querySelector<SVGGElement>('[aria-label="概率模型"]')!;
    act(() => topic.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.textContent).toContain('课程原文：概率模型定义');
    expect(container.textContent).not.toContain('知识目录');
  });

  it('replaces the course graph with the selected topic graph and closes back to the course graph', () => {
    const { container } = renderView();
    const topic = container.querySelector<SVGGElement>('[aria-label="概率模型"]')!;
    act(() => topic.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.querySelector('[aria-label="最大似然估计"]')).toBeNull();
    const teaching = container.querySelector<SVGGElement>('[aria-label="概率模型案例"]')!;
    const definition = container.querySelector<SVGGElement>('[aria-label="概率模型定义"]')!;
    expect(teaching).not.toBeNull();
    expect(definition).not.toBeNull();
    expect(teaching.getAttribute('opacity')).toBe('1');
    expect(definition.getAttribute('opacity')).toBe('1');
    expect(container.textContent).toContain('课程原文：概率模型定义');
    act(() => teaching.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('内部原文：概率模型案例');

    expect(container.textContent).toContain('二级知识网');
    const collapse = container.querySelector<HTMLButtonElement>('button[aria-label="关闭二级知识网"]')!;
    expect(collapse).not.toBeNull();
    act(() => collapse.click());
    expect(container.querySelector('[aria-label="概率模型案例"]')).toBeNull();
    expect(container.querySelector('[aria-label="最大似然估计"]')).not.toBeNull();
    expect(container.textContent).not.toContain('推荐路径');
  });

  it('marks reparse-affected topics with a stale badge', () => {
    act(() => useStore.setState({
      staleMarker: {
        reason: 'source-reparsed',
        affectedTopicIds: ['t2'],
        affectedPackageIds: [],
        timestamp: Date.now(),
        summary: '课件已重新解析：1 个知识点的原文有变化',
      },
    }));
    const { container } = renderView();
    expect(container.textContent).toContain('重解析：1 个知识点需更新');
    const badge = container.querySelector('[aria-label="最大似然估计 需更新"]');
    expect(badge).not.toBeNull();
    // 未受影响的节点没有徽章
    expect(container.querySelector('[aria-label="概率模型 需更新"]')).toBeNull();
    act(() => useStore.setState({ staleMarker: null }));
  });

  it('continues to knowledge cards instead of treating cards as the final note', () => {
    const { container } = renderView();
    const next = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('查看知识卡片'))!;

    expect(next).not.toBeUndefined();
    act(() => next.click());

    expect(useStore.getState().stage).toBe('cards');
  });
});
