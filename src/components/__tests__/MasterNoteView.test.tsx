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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MasterNoteView } from '../MasterNoteView';
import { useStore } from '../../store/useStore';
import type { ChapterNote, ChapterPlanItem, CourseMasterNote, KnowledgeCard, KnowledgeTopic } from '../../types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const topic: KnowledgeTopic = {
  id: 't1', courseId: 'course-1', name: 'GLM', aliases: ['广义线性模型'], summary: '统一一类模型',
  learningObjective: '理解 GLM 公式与指数族', sourceRanges: [], childTopicIds: [], importance: 'core', difficulty: 3,
  knowledgeGenre: 'concept', confidence: 0.94, status: 'generated',
};
const card: KnowledgeCard = {
  id: 'card-1', courseId: 'course-1', topicId: 't1', topicName: 'GLM', teachingBlockId: 'tb-1', teachingType: 'formula-system',
  title: 'GLM 公式', conciseSummary: '公式摘要', detailedNote: '公式说明', sourceRanges: [], keywords: [], aliases: [],
  prerequisiteTopicIds: [], relatedTopicIds: [], confidence: 0.9, reviewStatus: 'generated', status: 'completed', sourceVersion: 1, cardVersion: 1,
};
const plan: ChapterPlanItem = {
  id: 'chapter-1', title: '广义线性模型', objective: '建立总体框架', topicIds: ['t1'], framework: ['指数族', '链接函数'],
};
const completedChapter: ChapterNote = {
  ...plan, markdown: '## 广义线性模型\n\n完整章节正文。', sourceCardIds: ['card-1'], status: 'completed', retryCount: 0,
};

function seed() {
  useStore.setState({
    stage: 'notes', job: null, jobStatus: 'idle', modelConfig: { endpoint: 'https://example.com', model: 'test', apiKey: 'key' },
    sourceDocuments: [{ id: 'doc-1', courseId: 'course-1', title: '机器学习', markdown: '# GLM', outline: [], blocks: [], contentHash: 'h', createdAt: '', updatedAt: '' }],
    knowledgeTopics: [topic], knowledgeCards: [card], courseLearningPath: { orderedTopicIds: ['t1'], steps: [] },
    topicRelations: [], teachingBlocks: [], teachingRelations: [], narrativePaths: {}, topicSyntheses: [], chapterPlan: [], chapterNotes: [],
    courseMasterNote: null, glossary: [], formulaCards: [], pipelineProgress: { operation: null, status: 'idle', steps: [], estimatedProgress: 0, isEstimated: false },
    knowledgeBaseVersions: { source: 1, normalization: 1, topicStructure: 2, teachingStructure: 1, ordering: 1, cards: 1, notes: 0, embeddings: 0 },
  });
}

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(MasterNoteView, { onOpenSettings: vi.fn() })));
  return container;
}

beforeEach(() => {
  localStorage.clear();
  seed();
});

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  document.body.innerHTML = '';
});

describe('MasterNoteView complete-note stage', () => {
  it('keeps the active reading shell translucent while note content stays opaque', () => {
    const master: CourseMasterNote = {
      id: 'master-1', title: '机器学习', outline: [plan], chapters: [completedChapter], glossary: [], formulaIndex: [],
      markdown: '# 机器学习\n\n## 广义线性模型\n\n完整章节正文。',
      coverage: { totalCardIds: ['card-1'], coveredCardIds: ['card-1'], missingCardIds: [] }, status: 'completed', generatedFromStructureVersion: 2,
    };
    useStore.setState({ chapterPlan: [plan], chapterNotes: [completedChapter], courseMasterNote: master });

    const container = render();
    const readingRoot = container.firstElementChild as HTMLElement;
    const header = readingRoot.querySelector<HTMLElement>(':scope > header')!;
    const directory = readingRoot.querySelector<HTMLElement>('aside')!;
    const noteSurfaces = readingRoot.querySelectorAll<HTMLElement>('main article section');

    expect(readingRoot.className).toContain('bg-space-950/[0.82]');
    expect(header.className).toContain('bg-space-900/[0.97]');
    expect(directory.className).toContain('bg-space-900/[0.96]');
    expect(noteSurfaces.length).toBeGreaterThan(0);
    noteSurfaces.forEach(surface => expect(surface.className).toContain('bg-space-850'));
  });

  it('shows a concrete proposed framework before generation and starts generation explicitly', () => {
    const start = vi.fn();
    useStore.setState({ startMasterNoteGeneration: start });
    const container = render();

    expect(container.textContent).toContain('完整笔记');
    expect(container.textContent).toContain('课程框架');
    expect(container.textContent).toContain('指数族');
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('生成完整笔记'))!;
    act(() => button.click());
    expect(start).toHaveBeenCalledOnce();
  });

  it('shows the concrete blocking reason when note generation rejects incomplete cards', () => {
    useStore.setState({
      jobStatus: 'blocked',
      pipelineProgress: {
        operation: 'generate-notes', status: 'blocked', steps: [], estimatedProgress: 0, isEstimated: false,
        message: '知识卡片内容不完整：1/1 张未通过正文与原文证据检查。请先重新深化知识卡片。',
      },
    });

    const container = render();
    expect(container.textContent).toContain('知识卡片内容不完整：1/1');
    expect(container.textContent).toContain('返回深化知识卡片');
  });

  it('keeps successful chapters visible and retries only a failed chapter', () => {
    const failed: ChapterNote = {
      ...plan, id: 'chapter-2', title: '模型族比较', markdown: '', sourceCardIds: [], status: 'failed', error: '模型返回为空', retryCount: 0,
    };
    const retry = vi.fn();
    const master: CourseMasterNote = {
      id: 'master-1', title: '机器学习', outline: [plan, failed], chapters: [completedChapter, failed], glossary: [], formulaIndex: [],
      markdown: '# 机器学习\n\n## 广义线性模型\n\n完整章节正文。',
      coverage: { totalCardIds: ['card-1'], coveredCardIds: ['card-1'], missingCardIds: [] }, status: 'partial', generatedFromStructureVersion: 2,
    };
    useStore.setState({ chapterPlan: [plan, failed], chapterNotes: [completedChapter, failed], courseMasterNote: master, retryChapterNote: retry });
    const container = render();

    expect(container.textContent).toContain('完整章节正文');
    const failedChapter = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('模型族比较'))!;
    act(() => failedChapter.click());
    expect(container.textContent).toContain('模型返回为空');
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('重试本章'))!;
    act(() => button.click());
    expect(retry).toHaveBeenCalledWith('chapter-2');
  });

  it('offers one-click continuation when a partial note has unfinished chapters', () => {
    const failed: ChapterNote = {
      ...plan, id: 'chapter-2', title: '模型族比较', markdown: '', sourceCardIds: [], status: 'failed', error: 'signal timed out', retryCount: 0,
    };
    const start = vi.fn();
    const master: CourseMasterNote = {
      id: 'master-1', title: '机器学习', outline: [plan, failed], chapters: [completedChapter, failed], glossary: [], formulaIndex: [],
      markdown: '# 机器学习\n\n## 广义线性模型\n\n完整章节正文。',
      coverage: { totalCardIds: ['card-1'], coveredCardIds: ['card-1'], missingCardIds: [] }, status: 'partial', generatedFromStructureVersion: 2,
    };
    useStore.setState({
      chapterPlan: [plan, failed], chapterNotes: [completedChapter, failed], courseMasterNote: master,
      startMasterNoteGeneration: start,
    });

    const container = render();
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('续跑未完成章节'))!;
    act(() => button.click());

    expect(start).toHaveBeenCalledOnce();
  });

  it('shows every completed chapter in one document and uses the directory as anchor navigation', () => {
    const secondPlan: ChapterPlanItem = {
      id: 'chapter-2', title: '模型族比较', objective: '比较模型族', topicIds: ['t1'], framework: ['共同目标', '差异维度'],
    };
    const secondChapter: ChapterNote = {
      ...secondPlan, markdown: '## 模型族比较\n\n第二章连续正文。', sourceCardIds: ['card-1'], status: 'completed', retryCount: 0,
    };
    const master: CourseMasterNote = {
      id: 'master-1', title: '机器学习', outline: [plan, secondPlan], chapters: [completedChapter, secondChapter], glossary: [], formulaIndex: [],
      markdown: '# 机器学习\n\n## 课程概述\n\n课程总览。\n\n## 广义线性模型\n\n完整章节正文。\n\n## 模型族比较\n\n第二章连续正文。',
      coverage: { totalCardIds: ['card-1'], coveredCardIds: ['card-1'], missingCardIds: [] }, status: 'completed', generatedFromStructureVersion: 2,
    };
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    useStore.setState({ chapterPlan: [plan, secondPlan], chapterNotes: [completedChapter, secondChapter], courseMasterNote: master });

    const container = render();

    expect(container.textContent).toContain('完整章节正文');
    expect(container.textContent).toContain('第二章连续正文');
    const directoryButton = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('模型族比较'))!;
    act(() => directoryButton.click());
    expect(scrollIntoView).toHaveBeenCalled();
    expect(container.textContent).toContain('完整章节正文');
    expect(container.textContent).toContain('第二章连续正文');
  });

  it('does not treat whitespace-only markdown as a generated complete note', () => {
    useStore.setState({
      courseMasterNote: {
        id: 'master-1', title: '机器学习', outline: [plan], chapters: [{ ...completedChapter, markdown: '   ' }], glossary: [], formulaIndex: [],
        markdown: '   ', coverage: { totalCardIds: ['card-1'], coveredCardIds: [], missingCardIds: ['card-1'] }, status: 'completed', generatedFromStructureVersion: 2,
      },
    });
    const container = render();
    expect(container.textContent).toContain('尚未生成完整笔记');
    expect(container.textContent).not.toContain('已完成 1/1 章');
  });
});
