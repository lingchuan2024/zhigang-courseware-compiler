import {
  ProjectState,
  ProductStage,
} from '../types';
import { replaceDocumentRetrievalRecords, saveLibraryProjectSnapshot, upsertLibraryDocument } from './library-repository';
import { buildRetrievalRecords } from './card-retrieval';

const STORAGE_KEY = 'zhigang_project_state';

// v9：只持久化 v6 Markdown 架构字段。v8 及更早的 localStorage 数据
// 含 v1/v2-5 遗留结构，加载时直接丢弃（无存量用户，不做迁移）。

// 清除页面preview data URL以减小存储体积
function stripPreviews<T extends { preview?: string } | undefined>(obj: T): T {
  if (!obj) return obj;
  const result = { ...obj };
  delete result.preview;
  return result;
}

// v6 持久化字段（不包含API Key，不包含大图片预览）
const PERSISTED_KEYS: (keyof ProjectState)[] = [
  'stage', 'job', 'jobStatus',
  'document',
  'pipelineProgress',
  'staleMarker',
  'structureExtractionStatus', 'extractionErrors',
  'sourceDocuments', 'knowledgeTopics', 'topicRelations',
  'teachingBlocks', 'teachingRelations', 'courseLearningPath',
  'narrativePaths', 'knowledgeCards', 'topicNotes',
  'topicSyntheses', 'chapterPlan', 'chapterNotes', 'courseMasterNote',
  'glossary', 'formulaCards', 'unassignedBlocks',
  'knowledgeBaseVersions', 'knowledgePipelineStatus',
  'mineruParseResult',
];

// 保存状态到localStorage
export function saveState(state: Partial<ProjectState>): void {
  try {
    const toSave: Record<string, unknown> = {
      schemaVersion: 9,
    };

    for (const key of PERSISTED_KEYS) {
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

    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (error) {
    console.warn('Failed to save state:', error);
  }
}

function applyDefaults(result: Partial<ProjectState>): Partial<ProjectState> {
  if (result.job === undefined) result.job = null;
  if (result.jobStatus === undefined) result.jobStatus = 'idle';
  if (result.staleMarker === undefined) result.staleMarker = null;
  if (result.structureExtractionStatus === undefined) result.structureExtractionStatus = 'idle';
  if (!result.extractionErrors) result.extractionErrors = [];
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
}

// 从localStorage加载状态
export function loadState(): Partial<ProjectState> | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;

    const parsed = JSON.parse(saved) as Record<string, unknown> & { schemaVersion?: number };
    // v9 之前的持久化数据包含已删除的 v1/v2-5 结构，直接丢弃。
    if ((parsed.schemaVersion as number | undefined) !== 9) {
      return null;
    }

    const stage = parsed.stage as ProductStage | undefined;
    if (stage && !['upload', 'document', 'mineru', 'structure', 'cards', 'notes'].includes(stage)) {
      return null;
    }

    // 只接受白名单字段，未知遗留字段一律忽略
    const result: Record<string, unknown> = {};
    for (const key of PERSISTED_KEYS) {
      if (key in parsed) result[key] = parsed[key];
    }

    // running 状态在刷新后不恢复
    if (result.jobStatus === 'running') {
      result.job = null;
      result.jobStatus = 'idle';
    }

    return applyDefaults(result as Partial<ProjectState>);
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
