import {
  ProjectState,
  SCHEMA_VERSION,
  KnowledgePackage,
  EvidenceAtom,
  MacroKnowledgeRelation,
  ProductStage,
  BackgroundJob,
  JobStatus,
} from '../types';
import { convertV1ToV2 } from './notes-v2';
import { computeContentHash } from './evidence';
import { replaceDocumentRetrievalRecords, saveLibraryProjectSnapshot, upsertLibraryDocument } from './library-repository';
import { buildRetrievalRecords } from './card-retrieval';

const STORAGE_KEY = 'zhigang_project_state';

// 清除页面preview data URL以减小存储体积
function stripPreviews<T extends { preview?: string } | undefined>(obj: T): T {
  if (!obj) return obj;
  const result = { ...obj };
  delete result.preview;
  return result;
}

// 保存状态到localStorage
export function saveState(state: Partial<ProjectState>): void {
  try {
    const toSave: Record<string, unknown> = {
      schemaVersion: SCHEMA_VERSION,
    };

    // v5 持久化字段（不包含API Key，不包含大图片预览）
    const persisted: (keyof ProjectState)[] = [
      'stage', 'job', 'jobStatus',
      'document', 'evidences', 'topics', 'macroRelations',
      'knowledgePackages', 'orderMode', 'currentView', 'generationMemory',
      'globalAnchors', 'occurrences', 'structureWarnings', 'structureSource',
      'learningPath', 'pipelineProgress',
      'staleMarker', 'qualityReport', 'courseSections',
      // v1兼容字段
      'learningUnits', 'masterNotes',
      // v6 新架构字段
      'sourceDocuments', 'knowledgeTopics', 'topicRelations',
      'teachingBlocks', 'teachingRelations', 'courseLearningPath',
      'narrativePaths', 'knowledgeCards', 'topicNotes',
      'topicSyntheses', 'chapterPlan', 'chapterNotes', 'courseMasterNote',
      'glossary', 'formulaCards', 'unassignedBlocks',
      'knowledgeBaseVersions', 'knowledgePipelineStatus',
      'mineruParseResult',
    ];

    for (const key of persisted) {
      if (key in state) {
        if (key === 'document' && state.document) {
          toSave[key] = {
            ...state.document,
            pages: state.document.pages.map(p => stripPreviews(p)),
          };
        } else {
          toSave[key] = state[key];
        }
      }
    }

    // v5: stage 已经是 ProductStage，不需要转换
    // 如果 job 是 running，保存时降级为 idle（刷新后不恢复 running 状态）
    if (toSave.jobStatus === 'running') {
      toSave.job = null;
      toSave.jobStatus = 'idle';
    }

    const activeDocument = state.document;
    if (activeDocument?.courseId) {
      const updatedAt = Date.now();
      void Promise.all([
        upsertLibraryDocument({
          id: activeDocument.id,
          courseId: activeDocument.courseId,
          title: activeDocument.title,
          fileName: activeDocument.fileName,
          fileType: activeDocument.fileType ?? 'markdown',
          pageCount: activeDocument.pages.length,
          stage: state.stage ?? 'upload',
          status: state.jobStatus === 'failed'
            ? 'failed'
            : state.jobStatus === 'running'
              ? 'processing'
              : state.stage === 'cards' || state.stage === 'notes'
                ? 'ready'
                : 'new',
          uploadedAt: activeDocument.uploadedAt,
          updatedAt,
          cardCount: state.knowledgeCards?.length ?? 0,
        }),
        saveLibraryProjectSnapshot(
          activeDocument.courseId,
          activeDocument.id,
          toSave as Partial<ProjectState>,
        ),
        replaceDocumentRetrievalRecords(
          activeDocument.id,
          buildRetrievalRecords(state.knowledgeCards ?? [], activeDocument.id, activeDocument.courseId),
        ),
      ]).catch(error => console.warn('Unable to mirror project into course library:', error));
    }

    const serialized = JSON.stringify(toSave);
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch (e) {
      // localStorage满了，尝试压缩knowledgePackages中的长文本
      console.warn('Storage full, attempting compact save:', e);
      const compact = JSON.parse(serialized);
      if (compact.knowledgePackages) {
        compact.knowledgePackages = (compact.knowledgePackages as KnowledgePackage[]).map(kp => ({
          ...kp,
          source: {
            ...kp.source,
            combinedOriginalText: kp.source.combinedOriginalText.substring(0, 20000),
          },
        }));
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
    }
  } catch (error) {
    console.warn('Failed to save state:', error);
  }
}

// v1->v2迁移
function migrateV1(oldState: Record<string, unknown>): Partial<ProjectState> {
  const stage = (oldState.stage as string) || 'upload';
  const document = oldState.document as ProjectState['document'] || null;
  const evidences = (oldState.evidences as ProjectState['evidences']) || [];
  const learningUnits = (oldState.learningUnits as ProjectState['learningUnits']) || [];
  const masterNotes = (oldState.masterNotes as ProjectState['masterNotes']) || [];

  // 如果有v1数据，转换为v2
  if (learningUnits.length > 0 && evidences.length > 0) {
    try {
      const { topics, relations, packages } = convertV1ToV2(learningUnits, masterNotes, evidences);
      // v1 'generating' → 根据数据推导
      let newStage: ProductStage = 'structure';
      if (stage === 'notes') {
        newStage = 'notes';
      }
      return {
        stage: newStage,
        job: null,
        jobStatus: 'completed',
        document,
        evidences,
        topics,
        macroRelations: relations,
        knowledgePackages: packages,
        orderMode: 'original',
        structureWarnings: [],
        structureSource: 'local',
        currentView: 'first-study',
        learningUnits,
        masterNotes,
        generationMemory: { terminology: {}, symbols: {}, generatedTopicSummaries: {} },
        globalAnchors: [],
        occurrences: [],
        modelConfig: null,
      };
    } catch (e) {
      console.warn('V1 migration failed:', e);
    }
  }

  return {
    stage: document ? 'document' : 'upload',
    job: null,
    jobStatus: document ? 'completed' : 'idle',
    document,
    evidences,
    topics: [],
    macroRelations: [],
    knowledgePackages: [],
    orderMode: 'original',
    structureWarnings: [],
    structureSource: 'local',
    currentView: 'first-study',
    learningUnits: learningUnits || [],
    masterNotes: masterNotes || [],
    generationMemory: { terminology: {}, symbols: {}, generatedTopicSummaries: {} },
    globalAnchors: [],
    occurrences: [],
    modelConfig: null,
  };
}

// v2→v3迁移：关系类型、证据身份、内部结构字段
function migrateV2toV3(oldState: Record<string, unknown>): Partial<ProjectState> {
  const result = { ...oldState } as Record<string, unknown>;

  // 迁移关系类型
  if (Array.isArray(result.macroRelations)) {
    result.macroRelations = (result.macroRelations as MacroKnowledgeRelation[]).map(r => {
      const oldType = r.type as string;
      if (oldType === 'part_of') {
        // 旧 part_of: A → B 迁移为 contains: B → A
        return { ...r, type: 'contains' as const, sourceTopicId: r.targetTopicId, targetTopicId: r.sourceTopicId };
      }
      if (oldType === 'derived_from') return { ...r, type: 'derives_to' as const };
      if (oldType === 'uses') return { ...r, type: 'used_by' as const };
      return r;
    });
  }

  // 迁移证据：补充 documentId, blockIndex, contentHash
  if (Array.isArray(result.evidences)) {
    const docId = (result.document as { id?: string })?.id || 'migrated-doc';
    result.evidences = (result.evidences as EvidenceAtom[]).map((e, idx) => {
      if (e.contentHash && e.documentId) return e; // 已有v3字段
      const blockIndex = e.blockIndex ?? idx;
      const contentHash = e.contentHash || computeContentHash(docId, e.pageNumber, blockIndex, e.type, e.content);
      return {
        ...e,
        documentId: e.documentId || docId,
        blockIndex,
        contentHash,
      };
    });
  }

  // 迁移 KnowledgePackage 内部结构
  if (Array.isArray(result.knowledgePackages)) {
    result.knowledgePackages = (result.knowledgePackages as KnowledgePackage[]).map(kp => {
      const isOld = !kp.internalStructure.source;
      if (!isOld) return kp;
      return {
        ...kp,
        internalStructure: {
          ...kp.internalStructure,
          source: 'local' as const,
          warnings: [],
          status: 'ready' as const,
        },
      };
    });
  }

  // v3 新增字段
  if (!result.learningPath) result.learningPath = null;
  if (!result.structureWarnings) result.structureWarnings = [];
  if (!result.structureSource) result.structureSource = 'local';

  return result as Partial<ProjectState>;
}

// v3→v4迁移：新增 staleMarker, qualityReport, courseSections
function migrateV3toV4(oldState: Record<string, unknown>): Partial<ProjectState> {
  const result = { ...oldState } as Record<string, unknown>;
  if (result.staleMarker === undefined) result.staleMarker = null;
  if (result.qualityReport === undefined) result.qualityReport = null;
  if (result.courseSections === undefined) result.courseSections = [];
  return result as Partial<ProjectState>;
}

// v4→v5迁移：旧六步 WorkflowStage → 新四步 ProductStage + BackgroundJob + JobStatus
function migrateV4toV5(oldState: Record<string, unknown>): Partial<ProjectState> {
  const result = { ...oldState } as Record<string, unknown>;

  const oldStage = (result.stage as string) || 'upload';
  const topics = (result.topics as Array<{ id: string }>) || [];
  const knowledgePackages = (result.knowledgePackages as Array<{
    topic?: { noteStatus?: string };
    note?: unknown;
  }>) || [];
  const structureExtractionStatus = (result.structureExtractionStatus as string) || 'idle';

  let newStage: ProductStage = 'upload';
  let newJob: BackgroundJob = null;
  let newJobStatus: JobStatus = 'idle';

  // 旧 stage → 新 stage 映射
  const stageMap: Record<string, { stage: ProductStage; job: BackgroundJob; jobStatus: JobStatus }> = {
    'upload':              { stage: 'upload',    job: null,                     jobStatus: 'idle' },
    'parse-review':        { stage: 'document',  job: null,                     jobStatus: 'completed' },
    'extracting-structure':{ stage: 'structure', job: 'extracting-topics',      jobStatus: 'running' },
    'structure-review':    { stage: 'structure', job: null,                     jobStatus: 'completed' },
    'generating-notes':    { stage: 'notes',     job: 'generating-topic-notes', jobStatus: 'running' },
    'notes':               { stage: 'notes',     job: null,                     jobStatus: 'completed' },
  };

  if (stageMap[oldStage]) {
    const mapped = stageMap[oldStage];
    newStage = mapped.stage;
    newJob = mapped.job;
    newJobStatus = mapped.jobStatus;
  } else if (oldStage === 'generating') {
    // 更旧的 'generating' 状态：根据数据推导
    const isExtracting = ['extracting-topics', 'repairing-topics', 'extracting-relations',
                          'extracting-internal-structures', 'quality-checking', 'quality-repairing']
                          .includes(structureExtractionStatus);
    const hasGeneratingNotes = knowledgePackages.some(kp => kp.topic?.noteStatus === 'generating');
    const hasCompletedNotes = knowledgePackages.some(kp => kp.note !== undefined && kp.note !== null);

    if (isExtracting && topics.length === 0) {
      newStage = 'structure';
      newJob = 'extracting-topics';
      newJobStatus = 'running';
    } else if (hasGeneratingNotes) {
      newStage = 'notes';
      newJob = 'generating-topic-notes';
      newJobStatus = 'running';
    } else if (hasCompletedNotes) {
      newStage = 'notes';
      newJob = null;
      newJobStatus = 'completed';
    } else if (topics.length > 0) {
      newStage = 'structure';
      newJob = null;
      newJobStatus = 'completed';
    } else {
      newStage = 'document';
      newJob = null;
      newJobStatus = 'completed';
    }
  }

  // running 状态在刷新后降级（不能恢复 running）
  if (newJobStatus === 'running') {
    newJob = null;
    newJobStatus = 'idle';
  }

  result.stage = newStage;
  result.job = newJob;
  result.jobStatus = newJobStatus;

  return result as Partial<ProjectState>;
}

// v5→v6迁移：新增 v6 新架构字段（空初始化）
function migrateV5toV6(oldState: Record<string, unknown>): Partial<ProjectState> {
  const result = { ...oldState } as Record<string, unknown>;

  // v6 新字段默认值
  if (!result.sourceDocuments) result.sourceDocuments = [];
  if (!result.knowledgeTopics) result.knowledgeTopics = [];
  if (!result.topicRelations) result.topicRelations = [];
  if (!result.teachingBlocks) result.teachingBlocks = [];
  if (!result.teachingRelations) result.teachingRelations = [];
  if (result.courseLearningPath === undefined) result.courseLearningPath = null;
  if (!result.narrativePaths) result.narrativePaths = {};
  if (!result.knowledgeCards) result.knowledgeCards = [];
  if (!result.topicNotes) result.topicNotes = [];
  if (!result.glossary) result.glossary = [];
  if (!result.formulaCards) result.formulaCards = [];
  if (!result.unassignedBlocks) result.unassignedBlocks = [];
  if (!result.knowledgeBaseVersions) {
    result.knowledgeBaseVersions = {
      source: 0, normalization: 0, topicStructure: 0,
      teachingStructure: 0, ordering: 0, cards: 0, notes: 0, embeddings: 0,
    };
  }
  if (!result.knowledgePipelineStatus) result.knowledgePipelineStatus = 'idle';

  return result as Partial<ProjectState>;
}

// v6→v7迁移：增加可见的 MinerU 解析阶段。
function migrateV6toV7(oldState: Record<string, unknown>): Partial<ProjectState> {
  const result = { ...oldState } as Partial<ProjectState>;
  const source = result.sourceDocuments?.[0];
  result.mineruParseResult = source ? {
    status: 'completed',
    progress: 100,
    markdown: source.markdown,
    assets: [],
    sourceFileName: source.title,
    completedAt: Date.now(),
  } : null;
  if (source && result.stage === 'document') result.stage = 'mineru';
  return result;
}

// v7→v8：把逐知识点笔记降级为知识卡片阶段，并初始化完整笔记管线。
function migrateV7toV8(oldState: Record<string, unknown>): Partial<ProjectState> {
  const result = { ...oldState } as Record<string, unknown>;
  if (!result.topicSyntheses) result.topicSyntheses = [];
  if (!result.chapterPlan) result.chapterPlan = [];
  if (!result.chapterNotes) result.chapterNotes = [];
  if (result.courseMasterNote === undefined) result.courseMasterNote = null;

  const hasMarkdownArchitecture =
    Array.isArray(result.sourceDocuments) && result.sourceDocuments.length > 0 ||
    Array.isArray(result.knowledgeCards) && result.knowledgeCards.length > 0;
  if (result.stage === 'notes' && hasMarkdownArchitecture && !result.courseMasterNote) {
    result.stage = 'cards';
  }
  return result as Partial<ProjectState>;
}

// 从localStorage加载状态
export function loadState(): Partial<ProjectState> | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;

    const parsed = JSON.parse(saved) as Record<string, unknown>;
    const version = (parsed.schemaVersion as number) || 1;

    let result: Partial<ProjectState>;

    if (version < 2) {
      result = migrateV1(parsed);
    } else if (version < 3) {
      result = migrateV2toV3(parsed);
    } else if (version < 4) {
      result = migrateV3toV4(parsed);
    } else if (version < 5) {
      result = migrateV4toV5(parsed);
    } else if (version < 6) {
      result = migrateV5toV6(parsed);
    } else if (version < 7) {
      result = migrateV6toV7(parsed);
    } else {
      result = parsed as Partial<ProjectState>;
    }

    if (version < 8) {
      result = migrateV7toV8(result as Record<string, unknown>);
    }

    // 兜底：如果 stage 仍然是旧 WorkflowStage，强制迁移
    const stageStr = result.stage as string;
    if (stageStr && !['upload', 'document', 'mineru', 'structure', 'cards', 'notes'].includes(stageStr)) {
      const v5Result = migrateV4toV5({ ...parsed, stage: stageStr });
      result.stage = v5Result.stage;
      result.job = v5Result.job;
      result.jobStatus = v5Result.jobStatus;
    }

    // running 状态在刷新后不恢复
    if (result.jobStatus === 'running') {
      result.job = null;
      result.jobStatus = 'idle';
    }

    // 默认值
    if (!result.topics) result.topics = [];
    if (!result.macroRelations) result.macroRelations = [];
    if (!result.knowledgePackages) result.knowledgePackages = [];
    if (!result.orderMode) result.orderMode = 'original';
    if (!result.structureWarnings) result.structureWarnings = [];
    if (!result.structureSource) result.structureSource = 'local';
    if (!result.generationMemory) {
      result.generationMemory = { terminology: {}, symbols: {}, generatedTopicSummaries: {} };
    }
    if (!result.globalAnchors) result.globalAnchors = [];
    if (!result.occurrences) result.occurrences = [];
    if (!result.learningUnits) result.learningUnits = [];
    if (!result.masterNotes) result.masterNotes = [];
    if (result.learningPath === undefined) result.learningPath = null;
    if (result.staleMarker === undefined) result.staleMarker = null;
    if (result.qualityReport === undefined) result.qualityReport = null;
    if (result.courseSections === undefined) result.courseSections = [];
    if (result.job === undefined) result.job = null;
    if (result.jobStatus === undefined) result.jobStatus = 'idle';
    // v6 默认值
    if (!result.sourceDocuments) result.sourceDocuments = [];
    if (!result.knowledgeTopics) result.knowledgeTopics = [];
    if (!result.topicRelations) result.topicRelations = [];
    if (!result.teachingBlocks) result.teachingBlocks = [];
    if (!result.teachingRelations) result.teachingRelations = [];
    if (result.courseLearningPath === undefined) result.courseLearningPath = null;
    if (!result.narrativePaths) result.narrativePaths = {};
    if (!result.knowledgeCards) result.knowledgeCards = [];
    if (!result.topicNotes) result.topicNotes = [];
    if (!result.topicSyntheses) result.topicSyntheses = [];
    if (!result.chapterPlan) result.chapterPlan = [];
    if (!result.chapterNotes) result.chapterNotes = [];
    if (result.courseMasterNote === undefined) result.courseMasterNote = null;
    if (!result.glossary) result.glossary = [];
    if (!result.formulaCards) result.formulaCards = [];
    if (!result.unassignedBlocks) result.unassignedBlocks = [];
    if (!result.knowledgeBaseVersions) {
      result.knowledgeBaseVersions = {
        source: 0, normalization: 0, topicStructure: 0,
        teachingStructure: 0, ordering: 0, cards: 0, notes: 0, embeddings: 0,
      };
    }
    if (!result.knowledgePipelineStatus) result.knowledgePipelineStatus = 'idle';
    if (result.mineruParseResult === undefined) result.mineruParseResult = null;

    return result;
  } catch (error) {
    console.warn('Failed to load state:', error);
    return null;
  }
}

// 清除状态
export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear state:', error);
  }
}

// 重置项目
export function resetProject(): void {
  clearState();
}
