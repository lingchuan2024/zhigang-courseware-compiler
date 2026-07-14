import { create } from 'zustand';
import {
  ProjectState,
  ProductStage,
  BackgroundJob,
  CourseDocument,
  ViewType,
  ModelConfig,
  MinerUConfig,
  CourseGenerationMemory,
  OrderMode,
  StructureExtractionStatus,
  WorkflowStage,
} from '../types';
import type { SourceDocument } from '../types';
import { generateEvidences, regeneratePageEvidences, computeContentHash, generateStableEvidenceId } from '../lib/evidence';
import { generateLearningUnitsLocal, renameLearningUnit, updateUnitObjective, moveLearningUnit, deleteLearningUnit } from '../lib/structure';
import { saveState, loadState, clearState } from '../lib/persistence';
import {
  getOrderedTopics,
} from '../lib/knowledge-graph';
import {
  updatePackageInternalStructure,
  setPackageNote,
  markPackageFailed,
} from '../lib/knowledge-package';
import {
  extractTopicContent,
  generateTopicNote,
} from '../lib/model-v2';
import { createExampleCourseV2 } from '../lib/examples';
import { exportToMarkdownV2 } from '../lib/notes-v2';
import { runFullPipeline } from '../lib/knowledge-pipeline';
import { runKnowledgePipeline } from '../lib/knowledge-pipeline-v2';
import { regenerateChapterNote, runMasterNoteGeneration } from '../lib/master-note-generator';
import { assembleCourseMasterNote, isCompletedMasterNote } from '../lib/course-master-note';
import { createSourceDocument } from '../lib/markdown-parser';
import { loadDocumentSource } from '../lib/document-source';
import { runMinerUParse } from '../lib/mineru-client';
import { updateMemoryWithNote as pipelineUpdateMemory } from '../lib/course-memory';
import { rebuildAnchors } from '../lib/global-anchors';
import {
  IDLE_PROGRESS,
  createStructureExtractionProgress,
  createNoteGenerationProgress,
  deriveStructureProgress,
  blockProgress,
  failProgress,
  failProgressWithStage,
  completeProgress,
  updateCurrentItem,
  updateWindowProgress,
  tickEstimatedProgress,
} from '../lib/pipeline-progress';
import {
  createEvidenceEditStaleMarker,
  createStructureEditStaleMarker,
  createTopicEditStaleMarker,
  canNavigateToStage,
  getLatestStage,
} from '../lib/workflow-navigation';
import {
  clearStoredModelConfig,
  clearStoredMinerUConfig,
  loadStoredModelConfig,
  loadStoredMinerUConfig,
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
  evidences: [],
  learningUnits: [],
  masterNotes: [],
  topics: [],
  macroRelations: [],
  knowledgePackages: [],
  orderMode: 'original',
  structureWarnings: [],
  structureSource: 'local',
  learningPath: null,
  structureExtractionStatus: 'idle',
  extractionErrors: [],
  pipelineProgress: IDLE_PROGRESS,
  staleMarker: null,
  qualityReport: null,
  courseSections: [],
  currentView: 'first-study',
  viewMode: 'view',
  modelConfig: null,
  mineruConfig: null,
  mineruParseResult: null,
  generationMemory: initialMemory,
  globalAnchors: [],
  occurrences: [],
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
  initializeFromStorage: () => void;
  setDocument: (doc: CourseDocument) => void;
  updatePageText: (pageNumber: number, text: string) => void;
  regenerateEvidencesForPage: (pageNumber: number) => void;
  updateEvidence: (evidenceId: string, content: string) => void;
  deleteEvidence: (evidenceId: string) => void;
  splitEvidence: (evidenceId: string, splitContent: string) => void;
  mergeEvidences: (evidenceId1: string, evidenceId2: string) => void;
  navigateToStage: (stage: ProductStage) => void;
  returnToLatestStage: () => void;
  setViewMode: (mode: 'view' | 'edit') => void;
  markEvidenceStale: () => void;
  markStructureStale: (topicIds: string[]) => void;
  markTopicStale: (topicId: string) => void;
  clearStale: () => void;
  startKnowledgeExtraction: () => Promise<void>;
  startNoteGeneration: () => Promise<void>;
  setLearningUnits: (units: ProjectState['learningUnits']) => void;
  renameUnit: (unitId: string, title: string) => void;
  updateUnitObj: (unitId: string, objective: string) => void;
  moveUnit: (fromIndex: number, toIndex: number) => void;
  deleteUnit: (unitId: string) => void;
  setMasterNotes: (notes: ProjectState['masterNotes']) => void;
  setCurrentView: (view: ViewType) => void;
  setModelConfig: (config: ModelConfig | null) => void;
  setMinerUConfig: (config: MinerUConfig | null) => void;
  startMinerUParse: () => Promise<void>;
  setOrderMode: (mode: OrderMode) => void;
  loadExampleCourse: () => void;
  regenerateKnowledgeStructure: () => Promise<void>;
  generateAllNotes: () => Promise<void>;
  regenerateNoteForTopic: (topicId: string) => Promise<void>;
  exportCurrentNotes: () => void;
  reset: () => void;
  setStructureExtractionStatus: (status: StructureExtractionStatus) => void;
  // Legacy compat
  setStage: (stage: ProductStage | WorkflowStage) => void;
  confirmParse: () => Promise<void>;
  confirmStructure: () => Promise<void>;
  // v6 新架构
  setSourceDocuments: (docs: SourceDocument[]) => void;
  loadMarkdownDocument: (markdown: string, title: string) => void;
  startKnowledgePipeline: () => Promise<void>;
  startMasterNoteGeneration: () => Promise<void>;
  retryChapterNote: (chapterId: string) => Promise<void>;
  resetKnowledgeBase: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  ...initialState,

  initializeFromStorage: () => {
    const saved = loadState();
    const storedModelConfig = loadStoredModelConfig();
    const storedMinerUConfig = loadStoredMinerUConfig();
    if (saved) {
      set({
        ...initialState,
        ...saved,
        modelConfig: storedModelConfig,
        mineruConfig: storedMinerUConfig,
      });
    } else {
      set({ modelConfig: storedModelConfig, mineruConfig: storedMinerUConfig });
    }
  },

  setDocument: (doc) => {
    const evidences = generateEvidences(doc.pages, doc.id);
    set({
      document: doc,
      stage: 'document',
      job: null,
      jobStatus: 'completed',
      evidences,
      learningUnits: [],
      masterNotes: [],
      topics: [],
      macroRelations: [],
      knowledgePackages: [],
      orderMode: 'original',
      structureWarnings: [],
      structureSource: 'local',
      learningPath: null,
      structureExtractionStatus: 'idle',
      extractionErrors: [],
      generationMemory: initialMemory,
      globalAnchors: [],
      occurrences: [],
      staleMarker: null,
      qualityReport: null,
      courseSections: [],
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

  updatePageText: (pageNumber, text) => {
    const { document } = get();
    if (!document) return;
    const updatedPages = document.pages.map(p =>
      p.pageNumber === pageNumber ? { ...p, text, warning: text.trim() ? undefined : '本页无文本内容' } : p
    );
    set({ document: { ...document, pages: updatedPages } });
    get().markEvidenceStale();
  },

  regenerateEvidencesForPage: (pageNumber) => {
    const { document, evidences, knowledgePackages } = get();
    if (!document) return;
    const docId = document.id;
    const newEvidences = regeneratePageEvidences(document.pages, pageNumber, evidences, docId);

    const affectedEvidenceIds = new Set(
      evidences.filter(e => e.pageNumber === pageNumber).map(e => e.id)
    );
    const updatedPackages = knowledgePackages.map(kp => {
      const hasAffected = kp.source.evidenceIds.some(id => affectedEvidenceIds.has(id));
      if (!hasAffected) return kp;
      return {
        ...kp,
        internalStructure: { ...kp.internalStructure, status: 'stale' as const },
        topic: { ...kp.topic, noteStatus: 'stale' as const },
        versions: { ...kp.versions, sourceVersion: kp.versions.sourceVersion + 1 },
      };
    });

    set({
      evidences: newEvidences,
      knowledgePackages: updatedPackages,
      staleMarker: createEvidenceEditStaleMarker(get().topics, updatedPackages),
    });
    saveState(get());
  },

  updateEvidence: (evidenceId, content) => {
    const { evidences, knowledgePackages } = get();
    const evidence = evidences.find(e => e.id === evidenceId);
    if (!evidence) return;

    const newHash = computeContentHash(
      evidence.documentId, evidence.pageNumber, evidence.blockIndex, evidence.type, content
    );
    const updatedEvidence = { ...evidence, content, contentHash: newHash };
    const newEvidences = evidences.map(e => e.id === evidenceId ? updatedEvidence : e);

    const updatedPackages = knowledgePackages.map(kp => {
      const hasAffected = kp.source.evidenceIds.includes(evidenceId);
      if (!hasAffected) return kp;
      return {
        ...kp,
        internalStructure: { ...kp.internalStructure, status: 'stale' as const },
        topic: { ...kp.topic, noteStatus: 'stale' as const },
      };
    });

    set({
      evidences: newEvidences,
      knowledgePackages: updatedPackages,
      staleMarker: createEvidenceEditStaleMarker(get().topics, updatedPackages),
    });
    saveState(get());
  },

  deleteEvidence: (evidenceId) => {
    const { evidences, knowledgePackages } = get();
    const newEvidences = evidences.filter(e => e.id !== evidenceId);

    const updatedPackages = knowledgePackages.map(kp => {
      const hasAffected = kp.source.evidenceIds.includes(evidenceId);
      if (!hasAffected) return kp;
      return {
        ...kp,
        internalStructure: { ...kp.internalStructure, status: 'stale' as const },
        topic: { ...kp.topic, noteStatus: 'stale' as const },
      };
    });

    set({
      evidences: newEvidences,
      knowledgePackages: updatedPackages,
      staleMarker: createEvidenceEditStaleMarker(get().topics, updatedPackages),
    });
    saveState(get());
  },

  splitEvidence: (evidenceId, splitContent) => {
    const { evidences, knowledgePackages } = get();
    const evidence = evidences.find(e => e.id === evidenceId);
    if (!evidence) return;

    const originalContent = evidence.content;
    const splitIndex = originalContent.indexOf(splitContent);
    if (splitIndex < 0) return;

    const firstContent = originalContent.substring(0, splitIndex).trim();
    const secondContent = splitContent.trim();
    if (!firstContent || !secondContent) return;

    const firstHash = computeContentHash(
      evidence.documentId, evidence.pageNumber, evidence.blockIndex, evidence.type, firstContent
    );
    const secondBlockIndex = evidence.blockIndex + 1000;
    const secondHash = computeContentHash(
      evidence.documentId, evidence.pageNumber, secondBlockIndex, evidence.type, secondContent
    );
    const secondId = generateStableEvidenceId(
      evidence.documentId, evidence.pageNumber, secondBlockIndex, secondHash
    );

    const firstEvidence = { ...evidence, content: firstContent, contentHash: firstHash };
    const secondEvidence = { ...evidence, id: secondId, content: secondContent, contentHash: secondHash, blockIndex: secondBlockIndex };

    const newEvidences = evidences.flatMap(e => {
      if (e.id === evidenceId) return [firstEvidence, secondEvidence];
      return [e];
    });

    const updatedPackages = knowledgePackages.map(kp => {
      const hasAffected = kp.source.evidenceIds.includes(evidenceId);
      if (!hasAffected) return kp;
      return {
        ...kp,
        internalStructure: { ...kp.internalStructure, status: 'stale' as const },
        topic: { ...kp.topic, noteStatus: 'stale' as const },
      };
    });

    set({
      evidences: newEvidences,
      knowledgePackages: updatedPackages,
      staleMarker: createEvidenceEditStaleMarker(get().topics, updatedPackages),
    });
    saveState(get());
  },

  mergeEvidences: (evidenceId1, evidenceId2) => {
    const { evidences, knowledgePackages } = get();
    const ev1 = evidences.find(e => e.id === evidenceId1);
    const ev2 = evidences.find(e => e.id === evidenceId2);
    if (!ev1 || !ev2) return;
    if (ev1.pageNumber !== ev2.pageNumber) return;

    const mergedContent = `${ev1.content}\n${ev2.content}`;
    const mergedHash = computeContentHash(
      ev1.documentId, ev1.pageNumber, ev1.blockIndex, ev1.type, mergedContent
    );
    const mergedEvidence = { ...ev1, content: mergedContent, contentHash: mergedHash };

    const newEvidences = evidences
      .filter(e => e.id !== evidenceId2)
      .map(e => e.id === evidenceId1 ? mergedEvidence : e);

    const affectedIds = new Set([evidenceId1, evidenceId2]);
    const updatedPackages = knowledgePackages.map(kp => {
      const hasAffected = kp.source.evidenceIds.some(id => affectedIds.has(id));
      if (!hasAffected) return kp;
      return {
        ...kp,
        internalStructure: { ...kp.internalStructure, status: 'stale' as const },
        topic: { ...kp.topic, noteStatus: 'stale' as const },
      };
    });

    set({
      evidences: newEvidences,
      knowledgePackages: updatedPackages,
      staleMarker: createEvidenceEditStaleMarker(get().topics, updatedPackages),
    });
    saveState(get());
  },

  // ============== 四步导航 ==============

  navigateToStage: (targetStage) => {
    const state = get();
    const result = canNavigateToStage(targetStage, state.stage, {
      document: state.document,
      evidences: state.evidences,
      topics: state.topics,
      knowledgePackages: state.knowledgePackages,
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
      evidences: state.evidences,
      topics: state.topics,
      knowledgePackages: state.knowledgePackages,
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

  markEvidenceStale: () => {
    const { topics, knowledgePackages } = get();
    const staleMarker = createEvidenceEditStaleMarker(topics, knowledgePackages);
    set({ staleMarker });
    saveState(get());
  },

  markStructureStale: (topicIds) => {
    const { knowledgePackages } = get();
    const staleMarker = createStructureEditStaleMarker(topicIds, knowledgePackages);
    set({ staleMarker });
    saveState(get());
  },

  markTopicStale: (topicId) => {
    const { knowledgePackages } = get();
    const staleMarker = createTopicEditStaleMarker(topicId, knowledgePackages);
    set({ staleMarker });
    saveState(get());
  },

  clearStale: () => {
    set({ staleMarker: null });
    saveState(get());
  },

  // ============== 知识结构提取 ==============

  startKnowledgeExtraction: async () => {
    const { evidences, modelConfig, document } = get();
    set({
      stage: 'structure',
      job: 'extracting-topics',
      jobStatus: 'running',
      structureExtractionStatus: 'extracting-topics',
      extractionErrors: [],
      pipelineProgress: createStructureExtractionProgress(),
    });

    if (!modelConfig?.apiKey) {
      set({
        job: null,
        jobStatus: 'blocked',
        structureExtractionStatus: 'model-required',
        structureWarnings: ['未配置AI模型，无法提取知识点。请先在设置中配置模型。'],
        extractionErrors: ['未配置AI模型'],
        pipelineProgress: blockProgress(get().pipelineProgress, '需要配置 AI 模型'),
      });
      saveState(get());
      return;
    }

    // 估算进度计时器 — 每 800ms 缓慢递增
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

    startProgressTimer();

    try {
      const totalPages = document?.pages.length || 0;
      const result = await runFullPipeline(evidences, modelConfig, {
        onStatusChange: (status) => {
          set({
            structureExtractionStatus: status,
            pipelineProgress: deriveStructureProgress(status, get().pipelineProgress),
            job: statusToJob(status),
          });
        },
        onWindowProgress: (current, total) => {
          set({ pipelineProgress: updateWindowProgress(get().pipelineProgress, current, total) });
        },
        onQualityReport: (report) => {
          set({ qualityReport: report });
        },
        totalPages,
      });

      stopProgressTimer();

      if (result.status === 'model-required') {
        set({
          job: null,
          jobStatus: 'blocked',
          structureExtractionStatus: 'model-required',
          structureWarnings: result.warnings,
          extractionErrors: result.errors,
          qualityReport: result.qualityReport,
          pipelineProgress: blockProgress(get().pipelineProgress, '需要配置 AI 模型'),
        });
        saveState(get());
        return;
      }

      if (result.status === 'failed' || result.topics.length === 0) {
        set({
          job: null,
          jobStatus: 'failed',
          structureExtractionStatus: 'failed',
          structureWarnings: result.warnings,
          extractionErrors: result.errors.length > 0 ? result.errors : ['AI知识点提取失败，请检查模型配置后重试'],
          qualityReport: result.qualityReport,
          pipelineProgress: failProgressWithStage(
            get().pipelineProgress,
            result.failedStage
              ? `AI知识点提取失败 — ${result.failedStage}${result.failedWindowIndex !== undefined ? `（窗口 ${result.failedWindowIndex + 1}）` : ''}`
              : 'AI知识点提取失败',
            result.failedStage || 'unknown',
            result.failedWindowIndex,
          ),
        });
        saveState(get());
        return;
      }

      // 成功
      const learningUnits = generateLearningUnitsLocal(evidences);
      const docId = document?.id || 'unknown';
      const { anchors, occurrences } = rebuildAnchors(result.packages, docId);

      set({
        stage: 'structure',
        job: null,
        jobStatus: 'completed',
        topics: result.topics,
        macroRelations: result.relations,
        knowledgePackages: result.packages,
        learningUnits,
        orderMode: result.source === 'ai' ? 'ai-recommended' : 'original',
        structureWarnings: result.warnings,
        structureSource: result.source,
        structureExtractionStatus: 'ready',
        extractionErrors: [],
        learningPath: result.learningPath,
        globalAnchors: anchors,
        occurrences,
        qualityReport: result.qualityReport,
        staleMarker: null,
        pipelineProgress: completeProgress(get().pipelineProgress),
      });
      saveState(get());
    } catch (error) {
      stopProgressTimer();
      console.error('Pipeline failed:', error);
      set({
        job: null,
        jobStatus: 'failed',
        structureExtractionStatus: 'failed',
        structureWarnings: ['结构生成过程出错'],
        extractionErrors: [error instanceof Error ? error.message : '未知错误'],
        pipelineProgress: failProgress(get().pipelineProgress, 'AI知识点提取失败'),
      });
      saveState(get());
    }
  },

  // Legacy compat
  confirmParse: async () => {
    return get().startKnowledgeExtraction();
  },

  confirmStructure: async () => {
    await get().startNoteGeneration();
  },

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
      const courseId = get().document?.id ?? `course_${Date.now()}`;
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
      const parsed = createSourceDocument(output.markdown, document.id, document.title);
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

  startMasterNoteGeneration: async () => {
    const state = get();
    const {
      modelConfig,
      sourceDocuments,
      knowledgeTopics,
      topicRelations,
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

  setLearningUnits: (units) => {
    set({ learningUnits: units });
    saveState(get());
  },

  renameUnit: (unitId, title) => {
    const { learningUnits } = get();
    set({ learningUnits: renameLearningUnit(learningUnits, unitId, title) });
    saveState(get());
  },

  updateUnitObj: (unitId, objective) => {
    const { learningUnits } = get();
    set({ learningUnits: updateUnitObjective(learningUnits, unitId, objective) });
    saveState(get());
  },

  moveUnit: (fromIndex, toIndex) => {
    const { learningUnits } = get();
    set({ learningUnits: moveLearningUnit(learningUnits, fromIndex, toIndex) });
    saveState(get());
  },

  deleteUnit: (unitId) => {
    const { learningUnits } = get();
    set({ learningUnits: deleteLearningUnit(learningUnits, unitId) });
    saveState(get());
  },

  setMasterNotes: (notes) => {
    set({ masterNotes: notes });
    saveState(get());
  },

  setCurrentView: (view) => {
    set({ currentView: view });
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

  setOrderMode: (mode) => {
    set({ orderMode: mode });
    saveState(get());
  },

  loadExampleCourse: () => {
    const { document, topics, knowledgePackages } = createExampleCourseV2();
    const evidences = generateEvidences(document.pages, document.id);
    const learningUnits = generateLearningUnitsLocal(evidences);
    const docId = document.id;
    const { anchors, occurrences } = rebuildAnchors(knowledgePackages, docId);

    set({
      document,
      evidences,
      topics,
      macroRelations: [],
      knowledgePackages,
      learningUnits,
      stage: 'structure',
      job: null,
      jobStatus: 'completed',
      orderMode: 'ai-recommended',
      structureWarnings: [],
      structureSource: 'ai',
      structureExtractionStatus: 'ready',
      extractionErrors: [],
      learningPath: null,
      generationMemory: initialMemory,
      globalAnchors: anchors,
      occurrences,
      staleMarker: null,
      qualityReport: null,
      courseSections: [],
      viewMode: 'view',
      pipelineProgress: IDLE_PROGRESS,
    });
    saveState(get());
  },

  regenerateKnowledgeStructure: async () => {
    return get().startKnowledgeExtraction();
  },

  // ============== 笔记生成 ==============

  startNoteGeneration: async () => {
    const { topics, knowledgePackages, modelConfig, orderMode } = get();

    if (!modelConfig?.apiKey) {
      set({
        stage: 'notes',
        job: null,
        jobStatus: 'blocked',
        structureExtractionStatus: 'model-required',
        structureWarnings: ['未配置AI模型，无法生成笔记。'],
        extractionErrors: ['未配置AI模型'],
      });
      saveState(get());
      return;
    }

    const orderedTopics = getOrderedTopics(topics, orderMode);

    set({
      stage: 'notes',
      job: 'generating-topic-notes',
      jobStatus: 'running',
      pipelineProgress: createNoteGenerationProgress(orderedTopics.length),
    });

    try {
      const generationMemory = { ...get().generationMemory };
      let updatedPackages = [...knowledgePackages];

      for (let i = 0; i < orderedTopics.length; i++) {
        const topic = orderedTopics[i];
        const pkgIndex = updatedPackages.findIndex(kp => kp.topic.id === topic.id);
        if (pkgIndex < 0) continue;

        const pkg = updatedPackages[pkgIndex];

        set({
          pipelineProgress: updateCurrentItem(get().pipelineProgress, i + 1, orderedTopics.length, topic.title),
        });

        try {
          const internalResult = await extractTopicContent(modelConfig, pkg, topics);
          updatedPackages = [...updatedPackages];
          updatedPackages[pkgIndex] = updatePackageInternalStructure(pkg, internalResult.items, internalResult.relations);

          set({ knowledgePackages: updatedPackages });

          const noteResult = await generateTopicNote(modelConfig, updatedPackages[pkgIndex], generationMemory, orderedTopics);
          if (noteResult.note) {
            updatedPackages = [...updatedPackages];
            updatedPackages[pkgIndex] = setPackageNote(updatedPackages[pkgIndex], noteResult.note, modelConfig.model);
            set({ knowledgePackages: updatedPackages });
            Object.assign(generationMemory, pipelineUpdateMemory(generationMemory, topic.id, noteResult.note, topic.evidenceIds));
          }
        } catch (err) {
          console.error(`Note generation failed for ${topic.title}:`, err);
          updatedPackages = [...updatedPackages];
          updatedPackages[pkgIndex] = markPackageFailed(updatedPackages[pkgIndex], err instanceof Error ? err.message : 'Unknown error');
          set({ knowledgePackages: updatedPackages });
        }
      }

      set({
        job: null,
        jobStatus: 'completed',
        pipelineProgress: completeProgress(get().pipelineProgress),
        generationMemory,
      });
      saveState(get());
    } catch (error) {
      console.error('Note generation failed:', error);
      set({
        job: null,
        jobStatus: 'failed',
        pipelineProgress: failProgress(get().pipelineProgress, '笔记生成失败'),
      });
      saveState(get());
    }
  },

  generateAllNotes: async () => {
    return get().startNoteGeneration();
  },

  regenerateNoteForTopic: async (topicId) => {
    const { knowledgePackages, modelConfig, generationMemory, topics, orderMode } = get();
    if (!modelConfig?.apiKey) return;

    const pkgIndex = knowledgePackages.findIndex(kp => kp.topic.id === topicId);
    if (pkgIndex < 0) return;

    const pkg = knowledgePackages[pkgIndex];
    const topic = pkg.topic;
    const orderedTopics = getOrderedTopics(topics, orderMode);

    set({
      knowledgePackages: knowledgePackages.map((kp, i) =>
        i === pkgIndex ? { ...kp, topic: { ...kp.topic, noteStatus: 'generating' as const } } : kp
      ),
    });

    try {
      const internalResult = await extractTopicContent(modelConfig, pkg, topics);
      const updatedPkg = updatePackageInternalStructure(pkg, internalResult.items, internalResult.relations);
      const noteResult = await generateTopicNote(modelConfig, updatedPkg, generationMemory, orderedTopics);
      if (!noteResult.note) throw new Error('Note generation returned null');
      const finalPkg = setPackageNote(updatedPkg, noteResult.note, modelConfig.model);

      const newMemory = pipelineUpdateMemory(generationMemory, topic.id, noteResult.note, topic.evidenceIds);

      set({
        knowledgePackages: knowledgePackages.map((kp, i) => i === pkgIndex ? finalPkg : kp),
        generationMemory: newMemory,
      });
      saveState(get());
    } catch (err) {
      console.error(`Note regeneration failed for ${topic.title}:`, err);
      set({
        knowledgePackages: knowledgePackages.map((kp, i) =>
          i === pkgIndex ? markPackageFailed(kp, err instanceof Error ? err.message : 'Unknown error') : kp
        ),
      });
      saveState(get());
    }
  },

  exportCurrentNotes: () => {
    const { knowledgePackages, document: courseDoc, orderMode, topics, evidences, currentView } = get();
    const markdown = exportToMarkdownV2(knowledgePackages, topics, evidences, currentView, orderMode, courseDoc?.title || '课件笔记');
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${courseDoc?.title || '课件笔记'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  },

  reset: () => {
    clearState();
    set({ ...initialState });
  },

  setStage: (stage) => {
    // Legacy compat - map old stages to new stages
    const mapped = migrateLegacyStage(stage);
    set({ stage: mapped, viewMode: 'view' });
    saveState(get());
  },

  setStructureExtractionStatus: (status) => {
    set({ structureExtractionStatus: status });
  },
}));

// ============== 辅助函数 ==============

function statusToJob(status: StructureExtractionStatus): BackgroundJob {
  switch (status) {
    case 'extracting-topics': return 'extracting-topics';
    case 'repairing-topics':
    case 'quality-repairing': return 'repairing-topics';
    case 'extracting-relations': return 'extracting-relations';
    case 'extracting-internal-structures':
    case 'quality-checking': return 'building-internal-structure';
    default: return null;
  }
}

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
