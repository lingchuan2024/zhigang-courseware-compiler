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
    expect(teaching).not.toBeNull();
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

  it('uses the same two-layer network for migrated legacy course data', () => {
    act(() => useStore.setState({
      sourceDocuments: [],
      knowledgeTopics: [],
      topicRelations: [],
      teachingBlocks: [],
      teachingRelations: [],
      courseLearningPath: null,
      narrativePaths: {},
      document: {
        id: 'legacy-doc', title: '旧版概率论课件', fileName: 'legacy.pdf', fileType: 'pdf', uploadedAt: 0,
        pages: [{ pageNumber: 1, text: '课程原文：旧版概率模型定义' }],
      },
      evidences: [{
        id: 'ev1', documentId: 'legacy-doc', pageNumber: 1, blockIndex: 0, type: 'definition',
        content: '课程原文：旧版概率模型定义', confidence: 0.95, contentHash: 'legacy-hash',
      }],
      topics: [{
        id: 'legacy-topic', title: '旧版概率模型', aliases: [], type: 'concept', learningGoal: '理解概率模型',
        evidenceIds: ['ev1'], originalPageNumbers: [1], importance: 'core', confidence: 0.9,
        originalOrder: 0, recommendedOrder: 0, noteStatus: 'pending',
      }],
      macroRelations: [],
      knowledgePackages: [{
        id: 'legacy-package',
        topic: {
          id: 'legacy-topic', title: '旧版概率模型', aliases: [], type: 'concept', learningGoal: '理解概率模型',
          evidenceIds: ['ev1'], originalPageNumbers: [1], importance: 'core', confidence: 0.9,
          originalOrder: 0, recommendedOrder: 0, noteStatus: 'pending',
        },
        source: {
          evidenceIds: ['ev1'], combinedOriginalText: '课程原文：旧版概率模型定义',
          evidence: [{ evidenceId: 'ev1', pageNumber: 1, type: 'definition', originalText: '课程原文：旧版概率模型定义' }],
        },
        internalStructure: {
          items: [{
            id: 'legacy-item', topicId: 'legacy-topic', type: 'definition', title: '内部定义',
            content: 'AI 摘要不得替代原文', evidenceIds: ['ev1'], originalPageNumbers: [1],
            originalOrder: 0, recommendedOrder: 0, confidence: 0.9,
          }],
          relations: [], orderedItemIds: ['legacy-item'], source: 'ai', warnings: [], status: 'ready',
        },
        macroRelations: [],
        versions: { sourceVersion: 1, structureVersion: 1, noteVersion: 0, promptVersion: 'test' },
      }],
      learningPath: null,
      structureExtractionStatus: 'ready',
      knowledgePipelineStatus: 'idle',
      jobStatus: 'completed',
    }));

    const { container } = renderView();
    expect(container.querySelector('[data-testid="knowledge-network-canvas"]')).not.toBeNull();
    const topic = container.querySelector<SVGGElement>('[aria-label="旧版概率模型"]')!;
    expect(topic).not.toBeNull();
    act(() => topic.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('课程原文：旧版概率模型定义');

    expect(container.querySelector('[aria-label="内部定义"]')).not.toBeNull();
  });

  it('continues to knowledge cards instead of treating cards as the final note', () => {
    const { container } = renderView();
    const next = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('查看知识卡片'))!;

    expect(next).not.toBeUndefined();
    act(() => next.click());

    expect(useStore.getState().stage).toBe('cards');
  });
});
