import { create } from 'zustand';
import {
  ProjectState,
  ProductStage,
  CourseDocument,
  ModelConfig,
  MinerUConfig,
  CourseGenerationMemory,
  WorkflowStage,
} from '../types';
import type { SourceDocument } from '../types';
import { saveState, clearState } from '../lib/persistence';
import { createExampleCourse } from '../lib/examples';
import { runKnowledgePipeline } from '../lib/knowledge-pipeline-v2';
import { enrichKnowledgeCards } from '../lib/card-enrichment';
import { regenerateChapterNote, runMasterNoteGeneration } from '../lib/master-note-generator';
import { assembleCourseMasterNote, isCompletedMasterNote } from '../lib/course-master-note';
import { createSourceDocument } from '../lib/markdown-parser';
import { loadDocumentSource } from '../lib/document-source';
import { runMinerUParse } from '../lib/mineru-client';
import {
  IDLE_PROGRESS,
  createStructureExtractionProgress,
  createNoteGenerationProgress,
  blockProgress,
  failProgress,
  failProgressWithStage,
  completeProgress,
  updateCurrentItem,
  updateWindowProgress,
  tickEstimatedProgress,
} from '../lib/pipeline-progress';
import {
  canNavigateToStage,
  getLatestStage,
} from '../lib/workflow-navigation';
import {
  clearStoredModelConfig,
  clearStoredMinerUConfig,
  saveStoredModelConfig,
  saveStoredMinerUConfig,
} from '../lib/model-config-storage';

const initialMemory: CourseGenerationMemory = {
  terminology: {},
  symbols: {},
  generatedTopicSummaries: {},
};

const initialState: ProjectState = {
  stage: 'upload',
  job: null,
  jobStatus: 'idle',
  document: null,
  structureExtractionStatus: 'idle',
  extractionErrors: [],
  pipelineProgress: IDLE_PROGRESS,
  staleMarker: null,
  viewMode: 'view',
  modelConfig: null,
  mineruConfig: null,
  mineruParseResult: null,
  generationMemory: initialMemory,
  // v6 新架构
  sourceDocuments: [],
  knowledgeTopics: [],
  topicRelations: [],
  teachingBlocks: [],
  teachingRelations: [],
  courseLearningPath: null,
  narrativePaths: {},
  knowledgeCards: [],
  topicNotes: [],
  topicSyntheses: [],
  chapterPlan: [],
  chapterNotes: [],
  courseMasterNote: null,
  glossary: [],
  formulaCards: [],
  unassignedBlocks: [],
  knowledgeBaseVersions: {
    source: 0,
    normalization: 0,
    topicStructure: 0,
    teachingStructure: 0,
    ordering: 0,
    cards: 0,
    notes: 0,
    embeddings: 0,
  },
  knowledgePipelineStatus: 'idle',
};

interface AppState extends ProjectState {
  setDocument: (doc: CourseDocument) => void;
  navigateToStage: (stage: ProductStage) => void;
  returnToLatestStage: () => void;
  setViewMode: (mode: 'view' | 'edit') => void;
  setModelConfig: (config: ModelConfig | null) => void;
  setMinerUConfig: (config: MinerUConfig | null) => void;
  startMinerUParse: () => Promise<void>;
  loadExampleCourse: (courseId?: string) => void;
  reset: () => void;
  setStage: (stage: ProductStage | WorkflowStage) => void;
  // v6 新架构
  setSourceDocuments: (docs: SourceDocument[]) => void;
  loadMarkdownDocument: (markdown: string, title: string) => void;
  startKnowledgePipeline: () => Promise<void>;
  regenerateKnowledgeCards: () => Promise<void>;
  startMasterNoteGeneration: () => Promise<void>;
  retryChapterNote: (chapterId: string) => Promise<void>;
  resetKnowledgeBase: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  ...initialState,

  setDocument: (doc) => {
    set({
      document: doc,
      stage: 'document',
      job: null,
      jobStatus: 'completed',
      structureExtractionStatus: 'idle',
      extractionErrors: [],
      staleMarker: null,
      viewMode: 'view',
      sourceDocuments: doc.fileType === 'markdown' ? get().sourceDocuments : [],
      mineruParseResult: doc.fileType === 'markdown' ? get().mineruParseResult : null,
      knowledgeTopics: [],
      topicRelations: [],
      teachingBlocks: [],
      teachingRelations: [],
      courseLearningPath: null,
      narrativePaths: {},
      knowledgeCards: [],
      topicNotes: [],
      topicSyntheses: [],
      chapterPlan: [],
      chapterNotes: [],
      courseMasterNote: null,
      knowledgePipelineStatus: 'idle',
    });
    saveState(get());
  },

  // ============== 四步导航 ==============

  navigateToStage: (targetStage) => {
    const state = get();
    const result = canNavigateToStage(targetStage, state.stage, {
      document: state.document,
      structureExtractionStatus: state.structureExtractionStatus,
      jobStatus: state.jobStatus,
      staleMarker: state.staleMarker,
      sourceDocuments: state.sourceDocuments,
      knowledgeTopics: state.knowledgeTopics,
      topicNotes: state.topicNotes,
      knowledgeCards: state.knowledgeCards,
      topicSyntheses: state.topicSyntheses,
      chapterPlan: state.chapterPlan,
      chapterNotes: state.chapterNotes,
      courseMasterNote: state.courseMasterNote,
      knowledgeBaseVersions: state.knowledgeBaseVersions,
      mineruParseResult: state.mineruParseResult,
    });

    if (!result.allowed) return;

    set({
      stage: targetStage,
      viewMode: result.mode,
      job: null,
      jobStatus: 'idle',
    });
    saveState(get());
  },

  returnToLatestStage: () => {
    const state = get();
    const latest = getLatestStage({
      document: state.document,
      structureExtractionStatus: state.structureExtractionStatus,
      jobStatus: state.jobStatus,
      staleMarker: state.staleMarker,
      sourceDocuments: state.sourceDocuments,
      knowledgeTopics: state.knowledgeTopics,
      topicNotes: state.topicNotes,
      knowledgeCards: state.knowledgeCards,
      topicSyntheses: state.topicSyntheses,
      chapterPlan: state.chapterPlan,
      chapterNotes: state.chapterNotes,
      courseMasterNote: state.courseMasterNote,
      knowledgeBaseVersions: state.knowledgeBaseVersions,
      mineruParseResult: state.mineruParseResult,
    });
    set({ stage: latest, viewMode: 'view', job: null, jobStatus: 'idle' });
    saveState(get());
  },

  setViewMode: (mode) => {
    set({ viewMode: mode });
  },

  // Legacy compat
  // ========== v6 新架构 Actions ==========

  setSourceDocuments: (docs) => {
    const first = docs[0];
    set({
      sourceDocuments: docs,
      mineruParseResult: first ? {
        status: 'completed', progress: 100, markdown: first.markdown,
        assets: [], sourceFileName: first.title, completedAt: Date.now(),
      } : null,
    });
    saveState(get());
  },

  loadMarkdownDocument: (markdown, title) => {
    // 从 Markdown 文本创建 SourceDocument
    Promise.resolve().then(() => {
      const courseId = get().document?.courseId ?? get().document?.id ?? `course_${Date.now()}`;
      const doc = createSourceDocument(markdown, courseId, title);
      const docs = [...get().sourceDocuments, doc];
      set({
        sourceDocuments: docs,
        stage: 'mineru',
        mineruParseResult: {
          status: 'completed', progress: 100, markdown, assets: [],
          sourceFileName: title, completedAt: Date.now(),
        },
      });
      saveState(get());
    });
  },

  startMinerUParse: async () => {
    const { document, mineruConfig } = get();
    if (!document) return;

    if (document.fileType === 'markdown' && get().sourceDocuments.length > 0) {
      set({ stage: 'mineru' });
      saveState(get());
      return;
    }

    const fail = (error: string) => {
      set({
        stage: 'mineru',
        mineruParseResult: {
          status: 'failed', progress: 0, assets: [],
          sourceFileName: document.fileName, error,
        },
      });
      saveState(get());
    };

    if (!mineruConfig?.apiKey) {
      fail('请先配置 MinerU API');
      return;
    }
    if (!document.sourceKey) {
      fail('找不到原始课件文件，请重新上传');
      return;
    }

    set({
      stage: 'mineru',
      mineruParseResult: {
        status: 'uploading', progress: 3, assets: [], sourceFileName: document.fileName,
      },
    });
    saveState(get());

    try {
      const source = await loadDocumentSource(document.sourceKey);
      if (!source) throw new Error('找不到原始课件文件，请重新上传');
      const file = new File([source], document.fileName, {
        type: document.fileType === 'pptx'
          ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          : 'application/pdf',
      });
      const output = await runMinerUParse(file, mineruConfig, {
        onStatus: (status, progress) => set({
          mineruParseResult: { ...get().mineruParseResult!, status, progress },
        }),
      });
      const parsed = createSourceDocument(output.markdown, document.courseId ?? document.id, document.title);
      set({
        sourceDocuments: [parsed],
        mineruParseResult: {
          batchId: output.batchId,
          status: 'completed', progress: 100, markdown: output.markdown,
          assets: output.assets, sourceFileName: document.fileName, completedAt: Date.now(),
        },
        knowledgeTopics: [], topicRelations: [], teachingBlocks: [], teachingRelations: [],
        courseLearningPath: null, narrativePaths: {}, knowledgeCards: [], topicNotes: [],
        topicSyntheses: [], chapterPlan: [], chapterNotes: [], courseMasterNote: null,
        knowledgePipelineStatus: 'idle',
      });
      saveState(get());
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  },

  startKnowledgePipeline: async () => {
    const { sourceDocuments, modelConfig } = get();

    if (!modelConfig?.apiKey) {
      set({
        knowledgePipelineStatus: 'model-required',
        pipelineProgress: {
          ...IDLE_PROGRESS,
          operation: 'extract-structure',
          status: 'blocked',
          message: '请先配置 AI 模型',
        },
      });
      return;
    }

    if (sourceDocuments.length === 0) {
      return;
    }

    // 启动进度计时器
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    const startProgressTimer = () => {
      if (progressTimer) clearInterval(progressTimer);
      progressTimer = setInterval(() => {
        const current = get().pipelineProgress;
        if (current.status === 'running') {
          set({ pipelineProgress: tickEstimatedProgress(current) });
        }
      }, 800);
    };
    const stopProgressTimer = () => {
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
    };

    set({
      stage: 'structure',
      knowledgePipelineStatus: 'normalizing',
      job: 'extracting-topics',
      jobStatus: 'running',
      pipelineProgress: {
        ...createStructureExtractionProgress(),
        status: 'running',
        estimatedProgress: 2,
        isEstimated: true,
      },
    });
    startProgressTimer();

    try {
      const markdownTexts = sourceDocuments.map(doc => ({
        markdown: doc.markdown,
        title: doc.title,
      }));
      const courseId = sourceDocuments[0]?.courseId ?? `course_${Date.now()}`;

      const result = await runKnowledgePipeline(modelConfig, markdownTexts, courseId, {
        onStatusChange: (status) => {
          set({ knowledgePipelineStatus: status });
        },
        onWindowProgress: (current, total) => {
          const p = get().pipelineProgress;
          set({ pipelineProgress: updateWindowProgress(p, current, total) });
        },
        onTopicProgress: (current, total) => {
          set({
            pipelineProgress: updateCurrentItem(
              get().pipelineProgress,
              current,
              total,
              `提取讲解结构 ${current}/${total}`,
            ),
          });
        },
        onNoteProgress: (current, total) => {
          set({
            pipelineProgress: updateCurrentItem(
              get().pipelineProgress,
              current,
              total,
              `生成笔记 ${current}/${total}`,
            ),
          });
        },
      });

      stopProgressTimer();

      set({
        knowledgePipelineStatus: result.status,
        sourceDocuments: result.sourceDocuments,
        knowledgeTopics: result.topics,
        topicRelations: result.topicRelations,
        teachingBlocks: result.teachingBlocks,
        teachingRelations: result.teachingRelations,
        courseLearningPath: result.courseLearningPath,
        narrativePaths: result.narrativePaths,
        knowledgeCards: result.knowledgeCards,
        topicNotes: result.topicNotes,
        topicSyntheses: [],
        chapterPlan: [],
        chapterNotes: [],
        courseMasterNote: null,
        glossary: result.glossary,
        formulaCards: result.formulaCards,
        unassignedBlocks: result.unassignedBlocks,
        knowledgeBaseVersions: result.versions,
        jobStatus: result.status === 'ready' ? 'completed' : 'failed',
        pipelineProgress: result.status === 'ready'
          ? completeProgress(get().pipelineProgress)
          : failProgress(get().pipelineProgress, result.errors.join('; ')),
      });
      saveState(get());
    } catch (e) {
      stopProgressTimer();
      const msg = e instanceof Error ? e.message : String(e);
      set({
        knowledgePipelineStatus: 'failed',
        jobStatus: 'failed',
        pipelineProgress: failProgressWithStage(
          get().pipelineProgress,
          msg,
          'unknown',
        ),
      });
      saveState(get());
    }
  },

  regenerateKnowledgeCards: async () => {
    const state = get();
    if (!state.modelConfig?.apiKey || state.knowledgeCards.length === 0) return;

    set({
      job: 'enriching-knowledge-cards',
      jobStatus: 'running',
      knowledgeCards: state.knowledgeCards.map(card => ({ ...card, status: 'generating' as const })),
      pipelineProgress: {
        operation: 'extract-structure',
        status: 'running',
        steps: [{ id: 'card-enrichment', label: '深化知识卡片', status: 'running' }],
        currentItem: 0,
        totalItems: state.knowledgeCards.length,
        message: '正在根据二级知识网和课件原文深化知识卡片',
        estimatedProgress: 5,
        isEstimated: false,
      },
    });

    try {
      const result = await enrichKnowledgeCards(
        state.modelConfig,
        state.knowledgeCards,
        state.knowledgeTopics,
        state.teachingBlocks,
        state.teachingRelations,
        state.sourceDocuments.flatMap(document => document.blocks),
        (current, total) => set({
          pipelineProgress: {
            ...get().pipelineProgress,
            currentItem: current,
            totalItems: total,
            currentItemTitle: state.knowledgeCards[current - 1]?.title ?? `卡片 ${current}/${total}`,
            message: `已深化 ${current}/${total} 张知识卡片`,
            estimatedProgress: Math.max(5, Math.round(current / Math.max(1, total) * 95)),
          },
        }),
      );
      const allFailed = result.cards.length > 0 && result.failedCardIds.length === result.cards.length;
      set({
        knowledgeCards: result.cards,
        // 保留旧笔记供用户查看，只把母笔记标为需要根据新卡片重新生成。
        courseMasterNote: state.courseMasterNote
          ? {
              ...state.courseMasterNote,
              status: 'partial',
              error: '知识卡片已更新；当前完整笔记仍保留，但建议重新生成。',
            }
          : null,
        knowledgeBaseVersions: {
          ...get().knowledgeBaseVersions,
          cards: get().knowledgeBaseVersions.cards + 1,
        },
        job: null,
        jobStatus: allFailed ? 'failed' : 'completed',
        pipelineProgress: allFailed
          ? failProgress(get().pipelineProgress, '所有知识卡片深化均失败，已保留基础卡片')
          : completeProgress(get().pipelineProgress),
      });
      saveState(get());
    } catch (error) {
      set({
        knowledgeCards: state.knowledgeCards,
        job: null,
        jobStatus: 'failed',
        pipelineProgress: failProgress(
          get().pipelineProgress,
          error instanceof Error ? error.message : String(error),
        ),
      });
      saveState(get());
    }
  },

  startMasterNoteGeneration: async () => {
    const state = get();
    const {
      modelConfig,
      sourceDocuments,
      knowledgeTopics,
      topicRelations,
      teachingRelations,
      narrativePaths,
      courseLearningPath,
      knowledgeCards,
      glossary,
      formulaCards,
      generationMemory,
      knowledgeBaseVersions,
    } = state;

    if (!modelConfig?.apiKey) {
      set({
        stage: 'notes',
        job: null,
        jobStatus: 'blocked',
        pipelineProgress: blockProgress(
          createNoteGenerationProgress(knowledgeTopics.length),
          '请先配置知识生成模型，再生成完整笔记。',
        ),
      });
      saveState(get());
      return;
    }

    if (knowledgeTopics.length === 0 || knowledgeCards.length === 0) {
      set({
        stage: 'notes',
        job: null,
        jobStatus: 'failed',
        pipelineProgress: failProgress(
          createNoteGenerationProgress(knowledgeTopics.length),
          '缺少知识结构或知识卡片，无法生成完整笔记。',
        ),
      });
      saveState(get());
      return;
    }

    const courseId = sourceDocuments[0]?.courseId ?? knowledgeTopics[0].courseId;
    const title = sourceDocuments[0]?.title ?? get().document?.title ?? '课程完整笔记';
    const orderedTopicIds = courseLearningPath?.orderedTopicIds ?? knowledgeTopics.map(topic => topic.id);

    set({
      stage: 'notes',
      job: 'generating-topic-syntheses',
      jobStatus: 'running',
      topicSyntheses: [],
      chapterPlan: [],
      chapterNotes: [],
      courseMasterNote: null,
      pipelineProgress: {
        operation: 'generate-notes',
        status: 'running',
        steps: [
          { id: 'topic-synthesis', label: '综合知识卡片', status: 'running' },
          { id: 'chapter-plan', label: '规划课程框架', status: 'pending' },
          { id: 'chapter-generation', label: '逐章生成笔记', status: 'pending' },
          { id: 'master-assembly', label: '组装完整笔记', status: 'pending' },
        ],
        estimatedProgress: 3,
        isEstimated: true,
        message: '正在综合知识卡片',
      },
    });

    try {
      const result = await runMasterNoteGeneration(modelConfig, {
        courseId,
        title,
        topics: knowledgeTopics,
        topicRelations,
        orderedTopicIds,
        knowledgeCards,
        glossary,
        formulaIndex: formulaCards,
        terminology: generationMemory.terminology,
        symbols: generationMemory.symbols,
        structureVersion: knowledgeBaseVersions.topicStructure,
        teachingRelations,
        narrativePaths,
      }, {
        onTopicSynthesis: (synthesis, current, total) => {
          const existing = get().topicSyntheses.filter(item => item.topicId !== synthesis.topicId);
          set({
            job: 'generating-topic-syntheses',
            topicSyntheses: [...existing, synthesis],
            pipelineProgress: {
              ...get().pipelineProgress,
              currentItem: current,
              totalItems: total,
              currentItemTitle: `综合知识 ${current}/${total}`,
              message: `正在综合第 ${current}/${total} 个一级知识`,
            },
          });
          saveState(get());
        },
        onPlan: (plan) => {
          set({
            job: 'planning-chapters',
            chapterPlan: plan,
            pipelineProgress: {
              ...get().pipelineProgress,
              steps: get().pipelineProgress.steps.map(step =>
                step.id === 'topic-synthesis' ? { ...step, status: 'completed' as const }
                  : step.id === 'chapter-plan' ? { ...step, status: 'completed' as const }
                    : step.id === 'chapter-generation' ? { ...step, status: 'running' as const }
                      : step,
              ),
              message: `课程框架已完成，共 ${plan.length} 章`,
            },
          });
          saveState(get());
        },
        onChapter: (chapter, current, total) => {
          const existing = get().chapterNotes.filter(item => item.id !== chapter.id);
          set({
            job: 'generating-chapter-notes',
            chapterNotes: [...existing, chapter],
            pipelineProgress: {
              ...get().pipelineProgress,
              currentItem: current,
              totalItems: total,
              currentItemTitle: chapter.title,
              message: `正在生成第 ${current}/${total} 章：${chapter.title}`,
            },
          });
          saveState(get());
        },
      });

      const completed = isCompletedMasterNote(result.masterNote, knowledgeBaseVersions.topicStructure);
      const failedCompletely = result.masterNote.status === 'failed';
      set({
        topicSyntheses: result.topicSyntheses,
        chapterPlan: result.chapterPlan,
        chapterNotes: result.chapterNotes,
        courseMasterNote: result.masterNote,
        job: null,
        jobStatus: failedCompletely ? 'failed' : 'completed',
        knowledgeBaseVersions: {
          ...get().knowledgeBaseVersions,
          notes: get().knowledgeBaseVersions.notes + (completed || result.masterNote.status === 'partial' ? 1 : 0),
        },
        pipelineProgress: failedCompletely
          ? failProgress(get().pipelineProgress, result.masterNote.error ?? '完整笔记生成失败')
          : completeProgress(get().pipelineProgress),
      });
      saveState(get());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        job: null,
        jobStatus: 'failed',
        pipelineProgress: failProgress(get().pipelineProgress, message),
      });
      saveState(get());
    }
  },

  retryChapterNote: async (chapterId) => {
    const state = get();
    const plan = state.chapterPlan.find(chapter => chapter.id === chapterId);
    const existing = state.chapterNotes.find(chapter => chapter.id === chapterId);
    if (!plan || !existing || !state.modelConfig?.apiKey) return;

    const planIndex = state.chapterPlan.findIndex(chapter => chapter.id === chapterId);
    const previousPlan = planIndex > 0 ? state.chapterPlan[planIndex - 1] : null;
    const previousChapter = previousPlan
      ? state.chapterNotes.find(chapter => chapter.id === previousPlan.id)
      : null;
    const relevantSyntheses = state.topicSyntheses.filter(synthesis => plan.topicIds.includes(synthesis.topicId));

    set({
      job: 'generating-chapter-notes',
      jobStatus: 'running',
      chapterNotes: state.chapterNotes.map(chapter =>
        chapter.id === chapterId ? { ...chapter, status: 'generating' as const, error: undefined } : chapter,
      ),
      pipelineProgress: {
        operation: 'generate-notes',
        status: 'running',
        steps: [{ id: 'chapter-generation', label: `重新生成：${plan.title}`, status: 'running' }],
        currentItem: 1,
        totalItems: 1,
        currentItemTitle: plan.title,
        message: `正在重新生成：${plan.title}`,
        estimatedProgress: 15,
        isEstimated: true,
      },
    });

    const repaired = await regenerateChapterNote(state.modelConfig, {
      plan,
      syntheses: relevantSyntheses,
      knowledgeCards: state.knowledgeCards,
      previousChapterSummary: previousChapter?.markdown.slice(0, 800) ?? '',
      terminology: state.generationMemory.terminology,
      symbols: state.generationMemory.symbols,
      previousRetryCount: existing.retryCount,
    });
    const updatedChapters = state.chapterNotes.map(chapter => chapter.id === chapterId ? repaired : chapter);
    const title = state.sourceDocuments[0]?.title ?? state.document?.title ?? '课程完整笔记';
    const courseId = state.sourceDocuments[0]?.courseId ?? state.knowledgeTopics[0]?.courseId ?? 'course';
    const masterNote = assembleCourseMasterNote({
      courseId,
      title,
      outline: state.chapterPlan,
      chapterNotes: updatedChapters,
      knowledgeCards: state.knowledgeCards,
      glossary: state.glossary,
      formulaIndex: state.formulaCards,
      structureVersion: state.knowledgeBaseVersions.topicStructure,
    });
    set({
      chapterNotes: updatedChapters,
      courseMasterNote: masterNote,
      job: null,
      jobStatus: masterNote.status === 'failed' ? 'failed' : 'completed',
      pipelineProgress: masterNote.status === 'failed'
        ? failProgress(get().pipelineProgress, repaired.error ?? '章节重新生成失败')
        : completeProgress(get().pipelineProgress),
    });
    saveState(get());
  },

  setModelConfig: (config) => {
    if (config) {
      saveStoredModelConfig(config);
    } else {
      clearStoredModelConfig();
    }
    set({ modelConfig: config });
  },

  setMinerUConfig: (config) => {
    if (config) saveStoredMinerUConfig(config);
    else clearStoredMinerUConfig();
    set({ mineruConfig: config });
  },

  reset: () => {
    clearState();
    set({ ...initialState });
  },

  resetKnowledgeBase: () => {
    set({
      sourceDocuments: [],
      knowledgeTopics: [],
      topicRelations: [],
      teachingBlocks: [],
      teachingRelations: [],
      courseLearningPath: null,
      narrativePaths: {},
      knowledgeCards: [],
      topicNotes: [],
      topicSyntheses: [],
      chapterPlan: [],
      chapterNotes: [],
      courseMasterNote: null,
      glossary: [],
      formulaCards: [],
      unassignedBlocks: [],
      knowledgePipelineStatus: 'idle',
      knowledgeBaseVersions: {
        source: 0,
        normalization: 0,
        topicStructure: 0,
        teachingStructure: 0,
        ordering: 0,
        cards: 0,
        notes: 0,
        embeddings: 0,
      },
    });
    saveState(get());
  },

  loadExampleCourse: (courseId?: string) => {
    const example = createExampleCourse(courseId);

    set({
      document: example.document,
      sourceDocuments: example.sourceDocuments,
      knowledgeTopics: example.knowledgeTopics,
      topicRelations: example.topicRelations,
      teachingBlocks: example.teachingBlocks,
      teachingRelations: example.teachingRelations,
      courseLearningPath: example.courseLearningPath,
      narrativePaths: example.narrativePaths,
      knowledgeCards: example.knowledgeCards,
      topicNotes: [],
      topicSyntheses: [],
      chapterPlan: example.courseMasterNote.outline,
      chapterNotes: example.courseMasterNote.chapters,
      courseMasterNote: example.courseMasterNote,
      glossary: example.glossary,
      formulaCards: example.formulaCards,
      unassignedBlocks: [],
      knowledgeBaseVersions: {
        source: example.sourceDocuments.length,
        normalization: example.sourceDocuments.length,
        topicStructure: example.structureVersion,
        teachingStructure: example.teachingBlocks.length,
        ordering: 1,
        cards: example.knowledgeCards.length,
        notes: example.courseMasterNote.chapters.length,
        embeddings: 0,
      },
      stage: 'structure',
      job: null,
      jobStatus: 'completed',
      structureExtractionStatus: 'ready',
      knowledgePipelineStatus: 'ready',
      extractionErrors: [],
      generationMemory: initialMemory,
      staleMarker: null,
      viewMode: 'view',
      pipelineProgress: completeProgress(IDLE_PROGRESS),
      mineruParseResult: {
        status: 'completed',
        progress: 100,
        markdown: example.sourceDocuments[0].markdown,
        assets: [],
        sourceFileName: example.document.fileName,
        completedAt: Date.now(),
      },
    });
    saveState(get());
  },

  setStage: (stage) => {
    // Legacy compat - map old stages to new stages
    const mapped = migrateLegacyStage(stage);
    set({ stage: mapped, viewMode: 'view' });
    saveState(get());
  },

}));

// ============== 辅助函数 ==============


function migrateLegacyStage(stage: ProductStage | WorkflowStage): ProductStage {
  switch (stage) {
    case 'upload': return 'upload';
    case 'parse-review': return 'document';
    case 'extracting-structure': return 'structure';
    case 'structure-review': return 'structure';
    case 'generating-notes': return 'notes';
    case 'notes': return 'notes';
    default: return stage as ProductStage;
  }
}
