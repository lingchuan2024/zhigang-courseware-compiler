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

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChapterNote,
  ChapterPlanItem,
  CourseMasterNote,
  KnowledgeCard,
  KnowledgeTopic,
  TopicSynthesis,
} from '../../types';

const mocks = vi.hoisted(() => ({
  runMasterNoteGeneration: vi.fn(),
  regenerateChapterNote: vi.fn(),
  enrichKnowledgeCards: vi.fn(),
}));

vi.mock('../../lib/master-note-generator', () => ({
  runMasterNoteGeneration: mocks.runMasterNoteGeneration,
  regenerateChapterNote: mocks.regenerateChapterNote,
}));

vi.mock('../../lib/card-enrichment', () => ({
  enrichKnowledgeCards: mocks.enrichKnowledgeCards,
}));

import { useStore } from '../useStore';

const topic: KnowledgeTopic = {
  id: 'topic-1', courseId: 'course-1', name: 'GLM', aliases: [], summary: '摘要', learningObjective: '理解 GLM',
  sourceRanges: [], childTopicIds: [], importance: 'core', difficulty: 3, knowledgeGenre: 'concept', confidence: 0.9, status: 'generated',
};

const card: KnowledgeCard = {
  id: 'card-1', courseId: 'course-1', topicId: 'topic-1', topicName: 'GLM', teachingBlockId: 'block-1', teachingType: 'formula',
  title: 'GLM 公式', conciseSummary: '摘要', detailedNote: '说明', sourceRanges: [], keywords: [], aliases: [], prerequisiteTopicIds: [],
  relatedTopicIds: [], confidence: 0.9, reviewStatus: 'generated', status: 'completed', sourceVersion: 1, cardVersion: 1,
};

const synthesis: TopicSynthesis = {
  id: 'synthesis-1', topicId: 'topic-1', framework: ['公式'], orderedCardIds: ['card-1'], sections: [], parallelGroups: [], comparisons: [], formulaChains: [],
  markdown: 'GLM 综合', cardVersions: { 'card-1': 1 }, status: 'completed',
};

const plan: ChapterPlanItem = {
  id: 'chapter-1', title: 'GLM', objective: '理解 GLM', topicIds: ['topic-1'], framework: ['公式'],
};

const chapter: ChapterNote = {
  ...plan, markdown: '## GLM\n\n章节正文', sourceCardIds: ['card-1'], status: 'completed', retryCount: 0,
};

const masterNote: CourseMasterNote = {
  id: 'master-course-1', title: '测试课程', outline: [plan], chapters: [chapter], glossary: [], formulaIndex: [],
  markdown: '# 测试课程\n\n## GLM\n\n章节正文', coverage: { totalCardIds: ['card-1'], coveredCardIds: ['card-1'], missingCardIds: [] },
  status: 'completed', generatedFromStructureVersion: 2,
};

function seed(modelConfigured: boolean) {
  useStore.setState({
    stage: 'cards',
    job: null,
    jobStatus: 'idle',
    modelConfig: modelConfigured ? { endpoint: 'https://api.example.com/v1', model: 'test', apiKey: 'key' } : null,
    sourceDocuments: [{ id: 'doc-1', courseId: 'course-1', title: '测试课程', markdown: '# 课程', blocks: [], outline: [], contentHash: 'h', createdAt: '', updatedAt: '' }],
    knowledgeTopics: [topic],
    topicRelations: [],
    courseLearningPath: { orderedTopicIds: ['topic-1'], steps: [] },
    knowledgeCards: [card],
    topicSyntheses: [],
    chapterPlan: [],
    chapterNotes: [],
    courseMasterNote: null,
    glossary: [],
    formulaCards: [],
    knowledgeBaseVersions: { source: 1, normalization: 1, topicStructure: 2, teachingStructure: 1, ordering: 1, cards: 1, notes: 0, embeddings: 0 },
    generationMemory: { terminology: {}, symbols: {}, generatedTopicSummaries: {} },
  });
}

describe('master note store generation', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.runMasterNoteGeneration.mockReset();
    mocks.regenerateChapterNote.mockReset();
    mocks.enrichKnowledgeCards.mockReset();
  });

  it('blocks complete-note generation when the knowledge model is missing', async () => {
    seed(false);

    await act(async () => useStore.getState().startMasterNoteGeneration());

    expect(useStore.getState().stage).toBe('notes');
    expect(useStore.getState().jobStatus).toBe('blocked');
    expect(mocks.runMasterNoteGeneration).not.toHaveBeenCalled();
  });

  it('persists topic, plan, and chapter progress before publishing the master note', async () => {
    seed(true);
    mocks.runMasterNoteGeneration.mockImplementation(async (_config, _input, callbacks) => {
      callbacks.onTopicSynthesis?.(synthesis, 1, 1);
      expect(useStore.getState().topicSyntheses).toEqual([synthesis]);
      callbacks.onPlan?.([plan]);
      expect(useStore.getState().chapterPlan).toEqual([plan]);
      callbacks.onChapter?.(chapter, 1, 1);
      expect(useStore.getState().chapterNotes).toEqual([chapter]);
      return { topicSyntheses: [synthesis], chapterPlan: [plan], chapterNotes: [chapter], masterNote };
    });

    await act(async () => useStore.getState().startMasterNoteGeneration());

    const state = useStore.getState();
    expect(state.courseMasterNote).toEqual(masterNote);
    expect(state.jobStatus).toBe('completed');
    expect(state.job).toBeNull();
    expect(state.knowledgeBaseVersions.notes).toBe(1);
  });

  it('retries only the requested failed chapter and keeps completed chapters', async () => {
    seed(true);
    const secondPlan: ChapterPlanItem = {
      id: 'chapter-2', title: '扩展', objective: '理解扩展', topicIds: ['topic-1'], framework: ['扩展'],
    };
    const failed: ChapterNote = {
      ...secondPlan, markdown: '', sourceCardIds: [], status: 'failed', error: '旧错误', retryCount: 0,
    };
    useStore.setState({
      topicSyntheses: [synthesis],
      chapterPlan: [plan, secondPlan],
      chapterNotes: [chapter, failed],
      courseMasterNote: { ...masterNote, outline: [plan, secondPlan], chapters: [chapter, failed], status: 'partial' },
    });
    const repaired: ChapterNote = {
      ...secondPlan, markdown: '## 扩展\n\n修复后的正文', sourceCardIds: ['card-1'], status: 'completed', retryCount: 1,
    };
    mocks.regenerateChapterNote.mockResolvedValue(repaired);

    await act(async () => useStore.getState().retryChapterNote('chapter-2'));

    expect(mocks.regenerateChapterNote).toHaveBeenCalledOnce();
    expect(useStore.getState().chapterNotes).toEqual([chapter, repaired]);
    expect(useStore.getState().courseMasterNote?.markdown).toContain('修复后的正文');
    expect(useStore.getState().chapterNotes[0]).toBe(chapter);
  });

  it('keeps the existing complete note when cards are enriched and marks it partial', async () => {
    seed(true);
    useStore.setState({
      topicSyntheses: [synthesis],
      chapterPlan: [plan],
      chapterNotes: [chapter],
      courseMasterNote: masterNote,
    });
    mocks.enrichKnowledgeCards.mockResolvedValue({
      cards: [{ ...card, detailedNote: '更新后的卡片', cardVersion: 2 }],
      failedCardIds: [],
    });

    await act(async () => useStore.getState().regenerateKnowledgeCards());

    const state = useStore.getState();
    expect(state.courseMasterNote?.markdown).toBe(masterNote.markdown);
    expect(state.courseMasterNote?.status).toBe('partial');
    expect(state.topicSyntheses).toEqual([synthesis]);
    expect(state.chapterNotes).toEqual([chapter]);
  });
});
