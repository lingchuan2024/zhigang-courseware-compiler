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

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnowledgeCardsView } from '../KnowledgeCardsView';
import { useStore } from '../../store/useStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  useStore.setState({
    stage: 'cards',
    jobStatus: 'completed',
    sourceDocuments: [{
      id: 'doc-1', courseId: 'course-1', title: '机器学习', markdown: '# GLM\n\nGLM 原文公式',
      blocks: [
        { id: 'b1', documentId: 'doc-1', type: 'heading', content: '# GLM', headingPath: ['GLM'], orderIndex: 0, contentHash: 'h1' },
        { id: 'b2', documentId: 'doc-1', type: 'paragraph', content: 'GLM 原文公式', headingPath: ['GLM'], orderIndex: 1, contentHash: 'h2' },
      ],
      outline: [], contentHash: 'h', createdAt: '', updatedAt: '',
    }],
    knowledgeTopics: [{
      id: 'topic-1', courseId: 'course-1', name: '广义线性模型', aliases: ['GLM'], summary: '统一模型族', learningObjective: '理解 GLM',
      sourceRanges: [{ documentId: 'doc-1', startBlockId: 'b1', endBlockId: 'b2' }], childTopicIds: [], importance: 'core', difficulty: 3,
      knowledgeGenre: 'concept', confidence: 0.9, status: 'generated',
    }],
    courseLearningPath: { orderedTopicIds: ['topic-1'], steps: [] },
    knowledgeCards: [
      {
        id: 'card-1', courseId: 'course-1', topicId: 'topic-1', topicName: '广义线性模型', teachingBlockId: 'tb-1', teachingType: 'formula-system',
        title: 'GLM 公式', conciseSummary: '公式摘要', detailedNote: '公式详细说明', sourceRanges: [{ documentId: 'doc-1', startBlockId: 'b2', endBlockId: 'b2' }],
        keyPoints: ['随机成分', '系统成分', '连接函数'], applicableConditions: ['响应变量属于指数分布族'],
        examples: ['逻辑回归'], selfCheckQuestions: ['GLM 的三部分是什么？'],
        keywords: ['GLM'], aliases: [], prerequisiteTopicIds: [], relatedTopicIds: [], confidence: 0.9, reviewStatus: 'generated', status: 'completed',
        sourceVersion: 1, cardVersion: 1,
      },
      {
        id: 'card-2', courseId: 'course-1', topicId: 'topic-1', topicName: '广义线性模型', teachingBlockId: 'tb-2', teachingType: 'knowledge-family',
        title: '广义线性族', conciseSummary: '分布族摘要', detailedNote: '分布族详细说明', sourceRanges: [{ documentId: 'doc-1', startBlockId: 'b2', endBlockId: 'b2' }],
        keywords: ['分布族'], aliases: [], prerequisiteTopicIds: [], relatedTopicIds: [], confidence: 0.88, reviewStatus: 'generated', status: 'completed',
        sourceVersion: 1, cardVersion: 1,
      },
    ],
  });
});

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  document.body.innerHTML = '';
});

describe('KnowledgeCardsView', () => {
  it('groups cards by first-layer topic and shows the selected card source', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(createElement(KnowledgeCardsView)));

    expect(container.textContent).toContain('广义线性模型');
    expect(container.textContent).toContain('GLM 公式');
    expect(container.textContent).toContain('关键要点');
    expect(container.textContent).toContain('随机成分');
    expect(container.textContent).toContain('理解检查');
    const second = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('广义线性族'))!;
    act(() => second.click());

    expect(container.textContent).toContain('分布族详细说明');
    expect(container.textContent).toContain('GLM 原文公式');
  });

  it('repairs legacy fenced markdown and LaTeX delimiters when rendering a card', () => {
    const cards = useStore.getState().knowledgeCards;
    useStore.setState({
      knowledgeCards: cards.map((card, index) => index === 0 ? {
        ...card,
        detailedNote: '```markdown\n## 公式说明\n\n\\[\ng(\\mu)=x^\\top\\beta\n\\]\n```',
      } : card),
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(createElement(KnowledgeCardsView)));

    expect(container.querySelector('pre')).toBeNull();
    expect(Array.from(container.querySelectorAll('h2')).some(heading => heading.textContent === '公式说明')).toBe(true);
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('does not append a structured section when the card body already contains it', () => {
    const cards = useStore.getState().knowledgeCards;
    useStore.setState({
      knowledgeCards: cards.map((card, index) => index === 0 ? {
        ...card,
        detailedNote: '## 关键要点\n\n正文已经组织了关键要点。',
      } : card),
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(createElement(KnowledgeCardsView)));

    const matchingHeadings = Array.from(container.querySelectorAll('h2'))
      .filter(heading => heading.textContent === '关键要点');
    expect(matchingHeadings).toHaveLength(1);
  });

  it('offers complete-note generation as the next distinct stage', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(createElement(KnowledgeCardsView)));

    expect(container.textContent).toContain('重新深化卡片');

    const next = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('生成完整笔记'))!;
    act(() => next.click());

    expect(useStore.getState().stage).toBe('notes');
  });

  it('lets migrated projects without cards return to an existing partial complete note', () => {
    useStore.setState({
      knowledgeCards: [],
      courseMasterNote: {
        id: 'master-1', title: '机器学习', outline: [], chapters: [], glossary: [], formulaIndex: [], markdown: '# 已有完整笔记',
        coverage: { totalCardIds: [], coveredCardIds: [], missingCardIds: [] }, status: 'partial', generatedFromStructureVersion: 1,
      },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(createElement(KnowledgeCardsView)));

    const existingNote = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('查看已有完整笔记'))!;
    act(() => existingNote.click());
    expect(useStore.getState().stage).toBe('notes');
  });

  it('renders legacy example knowledge packages as compatibility cards', () => {
    useStore.setState({
      sourceDocuments: [], knowledgeTopics: [], knowledgeCards: [], topicSyntheses: [], chapterPlan: [], chapterNotes: [], courseMasterNote: null,
    });
    act(() => useStore.getState().loadExampleCourse());
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(createElement(KnowledgeCardsView)));

    expect(container.textContent).toContain('知识卡片');
    expect(container.textContent).toContain('概率模型基本概念');
    expect(container.textContent).not.toContain('暂无知识卡片');
  });
});
