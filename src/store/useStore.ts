import { create } from 'zustand';
import {
  ProjectState,
  WorkflowStage,
  CourseDocument,
  ViewType,
  ModelConfig,
  KnowledgePackage,
  CourseGenerationMemory,
  OrderMode,
  StructureExtractionStatus,
} from '../types';
import { generateEvidences, regeneratePageEvidences } from '../lib/evidence';
import { generateLearningUnitsLocal, renameLearningUnit, updateUnitObjective, moveLearningUnit, deleteLearningUnit } from '../lib/structure';
import { generateMasterNotesLocal } from '../lib/notes';
import { saveState, loadState, clearState } from '../lib/persistence';
import {
  getOrderedTopics,
} from '../lib/knowledge-graph';
import {
  createKnowledgePackage,
  updatePackageInternalStructure,
  setPackageNote,
  markPackageFailed,
  generateLocalNoteForPackage,
} from '../lib/knowledge-package';
import {
  extractTopicContent,
  generateTopicNote,
} from '../lib/model-v2';
import { createExampleCourseV2 } from '../lib/examples';
import { exportToMarkdownV2 } from '../lib/notes-v2';
import { runFullPipeline } from '../lib/knowledge-pipeline';
import { updateMemoryWithNote as pipelineUpdateMemory } from '../lib/course-memory';
import { rebuildAnchors } from '../lib/global-anchors';

const initialMemory: CourseGenerationMemory = {
  terminology: {},
  symbols: {},
  generatedTopicSummaries: {},
};

const initialState: ProjectState = {
  stage: 'upload',
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
  currentView: 'first-study',
  modelConfig: null,
  generationMemory: initialMemory,
  globalAnchors: [],
  occurrences: [],
};

interface AppState extends ProjectState {
  initializeFromStorage: () => void;
  setDocument: (doc: CourseDocument) => void;
  updatePageText: (pageNumber: number, text: string) => void;
  regenerateEvidencesForPage: (pageNumber: number) => void;
  setStage: (stage: WorkflowStage) => void;
  confirmParse: () => Promise<void>;
  confirmStructure: () => Promise<void>;
  setLearningUnits: (units: ProjectState['learningUnits']) => void;
  renameUnit: (unitId: string, title: string) => void;
  updateUnitObj: (unitId: string, objective: string) => void;
  moveUnit: (fromIndex: number, toIndex: number) => void;
  deleteUnit: (unitId: string) => void;
  setMasterNotes: (notes: ProjectState['masterNotes']) => void;
  setCurrentView: (view: ViewType) => void;
  setModelConfig: (config: ModelConfig | null) => void;
  setOrderMode: (mode: OrderMode) => void;
  loadExampleCourse: () => void;
  regenerateKnowledgeStructure: () => Promise<void>;
  generateAllNotes: () => Promise<void>;
  regenerateNoteForTopic: (topicId: string) => Promise<void>;
  exportCurrentNotes: () => void;
  reset: () => void;
  setStructureExtractionStatus: (status: StructureExtractionStatus) => void;
}

export const useStore = create<AppState>((set, get) => ({
  ...initialState,

  initializeFromStorage: () => {
    const saved = loadState();
    if (saved) {
      set({
        ...initialState,
        ...saved,
        modelConfig: null,
      });
    }
  },

  setDocument: (doc) => {
    const evidences = generateEvidences(doc.pages, doc.id);
    set({
      document: doc,
      stage: 'parse-review',
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
  },

  regenerateEvidencesForPage: (pageNumber) => {
    const { document, evidences, knowledgePackages } = get();
    if (!document) return;
    const docId = document.id;
    const newEvidences = regeneratePageEvidences(document.pages, pageNumber, evidences, docId);

    // 标记受影响的 KnowledgePackage 为 stale
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

    set({ evidences: newEvidences, knowledgePackages: updatedPackages });
    saveState(get());
  },

  setStage: (stage) => {
    set({ stage });
    saveState(get());
  },

  confirmParse: async () => {
    const { evidences, modelConfig, document } = get();
    set({ stage: 'generating', structureExtractionStatus: 'extracting-topics', extractionErrors: [] });

    // 没有模型配置 → model-required
    if (!modelConfig?.apiKey) {
      set({
        structureExtractionStatus: 'model-required',
        structureWarnings: ['未配置AI模型，无法提取知识点。请先在设置中配置模型。'],
        extractionErrors: ['未配置AI模型'],
      });
      return;
    }

    try {
      const result = await runFullPipeline(evidences, modelConfig, {
        onStatusChange: (status) => {
          set({ structureExtractionStatus: status });
        },
      });

      // 处理 model-required 状态
      if (result.status === 'model-required') {
        set({
          structureExtractionStatus: 'model-required',
          structureWarnings: result.warnings,
          extractionErrors: result.errors,
        });
        return;
      }

      // 处理 failed 状态
      if (result.status === 'failed' || result.topics.length === 0) {
        set({
          structureExtractionStatus: 'failed',
          structureWarnings: result.warnings,
          extractionErrors: result.errors.length > 0 ? result.errors : ['AI知识点提取失败，请检查模型配置后重试'],
        });
        return;
      }

      // 成功
      const learningUnits = generateLearningUnitsLocal(evidences);
      const docId = document?.id || 'unknown';
      const { anchors, occurrences } = rebuildAnchors(result.packages, docId);

      set({
        topics: result.topics,
        macroRelations: result.relations,
        knowledgePackages: result.packages,
        learningUnits,
        stage: 'structure-review',
        orderMode: result.source === 'ai' ? 'ai-recommended' : 'original',
        structureWarnings: result.warnings,
        structureSource: result.source,
        structureExtractionStatus: 'ready',
        extractionErrors: [],
        learningPath: result.learningPath,
        globalAnchors: anchors,
        occurrences,
      });
      saveState(get());
    } catch (error) {
      console.error('Pipeline failed:', error);
      set({
        structureExtractionStatus: 'failed',
        structureWarnings: ['结构生成过程出错'],
        extractionErrors: [error instanceof Error ? error.message : '未知错误'],
      });
    }
  },

  confirmStructure: async () => {
    await get().generateAllNotes();
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
    set({ modelConfig: config });
  },

  setOrderMode: (mode) => {
    set({ orderMode: mode });
    saveState(get());
  },

  regenerateKnowledgeStructure: async () => {
    const { evidences, modelConfig, document } = get();
    set({ stage: 'generating', structureExtractionStatus: 'extracting-topics', extractionErrors: [] });

    if (!modelConfig?.apiKey) {
      set({
        structureExtractionStatus: 'model-required',
        structureWarnings: ['未配置AI模型，无法提取知识点。'],
        extractionErrors: ['未配置AI模型'],
      });
      return;
    }

    try {
      const result = await runFullPipeline(evidences, modelConfig, {
        onStatusChange: (status) => {
          set({ structureExtractionStatus: status });
        },
      });

      if (result.status === 'model-required') {
        set({
          structureExtractionStatus: 'model-required',
          structureWarnings: result.warnings,
          extractionErrors: result.errors,
        });
        return;
      }

      if (result.status === 'failed' || result.topics.length === 0) {
        set({
          structureExtractionStatus: 'failed',
          structureWarnings: result.warnings,
          extractionErrors: result.errors.length > 0 ? result.errors : ['AI知识点提取失败，请重试'],
        });
        return;
      }

      const learningUnits = generateLearningUnitsLocal(evidences);
      const docId = document?.id || 'unknown';
      const { anchors, occurrences } = rebuildAnchors(result.packages, docId);

      set({
        topics: result.topics,
        macroRelations: result.relations,
        knowledgePackages: result.packages,
        learningUnits,
        stage: 'structure-review',
        orderMode: result.source === 'ai' ? 'ai-recommended' : 'original',
        structureWarnings: result.warnings,
        structureSource: result.source,
        structureExtractionStatus: 'ready',
        extractionErrors: [],
        learningPath: result.learningPath,
        globalAnchors: anchors,
        occurrences,
      });
      saveState(get());
    } catch (error) {
      console.error('Regeneration failed:', error);
      set({
        structureExtractionStatus: 'failed',
        structureWarnings: ['重新分析失败'],
        extractionErrors: [error instanceof Error ? error.message : '未知错误'],
      });
    }
  },

  generateAllNotes: async () => {
    const { knowledgePackages, topics, macroRelations, evidences, modelConfig, orderMode, document: courseDoc } = get();
    set({ stage: 'generating' });

    const orderedTopics = getOrderedTopics(topics, orderMode);
    const courseName = courseDoc?.title || '课件';
    let memory = { ...initialMemory };
    let previousSummary: string | undefined;

    // Build initial package map
    const packageMap = new Map<string, KnowledgePackage>();
    for (const topic of orderedTopics) {
      let kp = knowledgePackages.find(p => p.topic.id === topic.id);
      if (!kp) {
        kp = createKnowledgePackage(topic, macroRelations, evidences);
      }
      kp = { ...kp, topic: { ...kp.topic, noteStatus: 'generating' } };
      packageMap.set(topic.id, kp);
    }

    // === Phase 1: All internal-structure extractions (batch for cache hit) ===
    if (modelConfig?.apiKey) {
      for (const topic of orderedTopics) {
        const kp = packageMap.get(topic.id)!;
        try {
          const contentResult = await extractTopicContent(modelConfig, kp, orderedTopics);
          if (contentResult.items.length > 0) {
            const updatedKp = updatePackageInternalStructure(kp, contentResult.items, contentResult.relations);
            packageMap.set(topic.id, updatedKp);
          }
        } catch (e) {
          console.warn(`Content extraction failed for ${topic.title}:`, e);
        }
        // Incremental update
        set({
          knowledgePackages: [
            ...get().knowledgePackages.filter(p => p.topic.id !== topic.id),
            packageMap.get(topic.id)!,
          ],
        });
      }
    }

    // === Phase 2: All note-generation (batch for cache hit) ===
    const updatedPackages: KnowledgePackage[] = [];
    for (const topic of orderedTopics) {
      let kp = packageMap.get(topic.id)!;

      try {
        if (modelConfig?.apiKey) {
          const noteResult = await generateTopicNote(
            modelConfig, kp, memory, orderedTopics, previousSummary, courseName
          );
          if (noteResult.note) {
            kp = setPackageNote(kp, noteResult.note, modelConfig.model);
            memory = pipelineUpdateMemory(memory, kp.topic.id, noteResult.note, kp.source.evidenceIds);
            previousSummary = noteResult.note.shortSummary;
          } else {
            const localNote = generateLocalNoteForPackage(kp);
            kp = setPackageNote(kp, localNote);
            memory = pipelineUpdateMemory(memory, kp.topic.id, localNote, kp.source.evidenceIds);
            previousSummary = localNote.shortSummary;
          }
        } else {
          const localNote = generateLocalNoteForPackage(kp);
          kp = setPackageNote(kp, localNote);
          memory = pipelineUpdateMemory(memory, kp.topic.id, localNote, kp.source.evidenceIds);
          previousSummary = localNote.shortSummary;
        }
      } catch (error) {
        console.error(`Note generation failed for ${topic.title}:`, error);
        kp = markPackageFailed(kp, error instanceof Error ? error.message : '未知错误');
      }

      packageMap.set(topic.id, kp);
      updatedPackages.push(kp);

      // Incremental update
      set({
        knowledgePackages: [
          ...get().knowledgePackages.filter(p => p.topic.id !== topic.id),
          kp,
        ],
      });
    }

    // 生成v1兼容的masterNotes（用于旧组件降级）
    const v1Notes = generateMasterNotesLocal(
      get().learningUnits.length > 0 ? get().learningUnits : generateLearningUnitsLocal(evidences),
      evidences
    );

    set({
      knowledgePackages: updatedPackages,
      masterNotes: v1Notes,
      generationMemory: memory,
      stage: 'notes',
    });
    saveState(get());
  },

  regenerateNoteForTopic: async (topicId: string) => {
    const { knowledgePackages, topics, modelConfig, orderMode, generationMemory, document: courseDoc } = get();
    const orderedTopics = getOrderedTopics(topics, orderMode);
    const courseName = courseDoc?.title || '课件';
    const kpIndex = knowledgePackages.findIndex(p => p.topic.id === topicId);
    if (kpIndex === -1) return;

    let kp = knowledgePackages[kpIndex];
    kp = { ...kp, topic: { ...kp.topic, noteStatus: 'generating' } };

    // 找到前置知识点的摘要
    const topicIndex = orderedTopics.findIndex(t => t.id === topicId);
    let previousSummary: string | undefined;
    if (topicIndex > 0) {
      const prevTopic = orderedTopics[topicIndex - 1];
      previousSummary = generationMemory.generatedTopicSummaries[prevTopic.id];
    }

    try {
      if (modelConfig?.apiKey) {
        const noteResult = await generateTopicNote(modelConfig, kp, generationMemory, orderedTopics, previousSummary, courseName);
        if (noteResult.note) {
          kp = setPackageNote(kp, noteResult.note, modelConfig.model);
        } else {
          kp = setPackageNote(kp, generateLocalNoteForPackage(kp));
        }
      } else {
        kp = setPackageNote(kp, generateLocalNoteForPackage(kp));
      }
    } catch (error) {
      kp = markPackageFailed(kp, error instanceof Error ? error.message : '生成失败');
    }

    const newPackages = [...knowledgePackages];
    newPackages[kpIndex] = kp;
    set({ knowledgePackages: newPackages });
    saveState(get());
  },

  exportCurrentNotes: () => {
    const { knowledgePackages, topics, evidences, currentView, orderMode, document: courseDoc } = get();
    const md = exportToMarkdownV2(
      knowledgePackages,
      topics,
      evidences,
      currentView,
      orderMode,
      courseDoc?.title || '课件笔记'
    );
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${courseDoc?.title || 'notes'}-${currentView}-${orderMode}.md`;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  loadExampleCourse: () => {
    const example = createExampleCourseV2();
    set({
      ...example,
      stage: 'structure-review',
      currentView: 'first-study',
      orderMode: 'original',
      structureSource: 'local',
      structureExtractionStatus: 'ready',
      extractionErrors: [],
      structureWarnings: example.structureWarnings || ['示例课程使用本地规则生成知识结构'],
      modelConfig: null,
      generationMemory: initialMemory,
    });
    saveState(get());
  },

  setStructureExtractionStatus: (status) => {
    set({ structureExtractionStatus: status });
  },

  reset: () => {
    clearState();
    set({ ...initialState });
  },
}));
