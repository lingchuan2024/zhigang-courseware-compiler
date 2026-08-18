import {
  ProjectState,
} from '../types';
import { replaceDocumentRetrievalRecords, saveLibraryProjectSnapshot, upsertLibraryDocument } from './library-repository';
import { buildRetrievalRecords } from './card-retrieval';

// v10 持久化模型：项目数据唯一真相源是 IndexedDB 课程库快照，
// localStorage 只保留一个轻量"工作区指针"（当前打开的课件），
// 模型/MinerU 配置仍由 model-config-storage 的独立 key 保存。

const POINTER_KEY = 'zhigang_workspace_pointer';
/** v9 及以前的全量状态 key，启动时一次性清除。 */
const LEGACY_STATE_KEY = 'zhigang_project_state';
const MIRROR_DEBOUNCE_MS = 500;

interface WorkspacePointer {
  schemaVersion: 10;
  documentId: string;
  courseId: string;
}

// 清除页面preview data URL以减小存储体积
function stripPreviews<T extends { preview?: string } | undefined>(obj: T): T {
  if (!obj) return obj;
  const result = { ...obj };
  delete result.preview;
  return result;
}

// 快照字段白名单（不含 API Key，不含大图片预览）
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
  'mineruParseResult', 'structureQuality',
];

/** 从任意快照（可能是旧 schema 存量）中只挑出当前字段，防止已删除字段回流运行时状态。 */
export function pickPersistedFields(snapshot: Record<string, unknown>): Partial<ProjectState> {
  const picked: Record<string, unknown> = {};
  for (const key of PERSISTED_KEYS) {
    if (key in snapshot) picked[key] = snapshot[key];
  }
  return picked as Partial<ProjectState>;
}

/** 记录当前工作区指针（很小，直接同步写；供刷新后定位最近打开的课件）。 */
export function writeWorkspacePointer(documentId: string, courseId: string): void {
  try {
    const pointer: WorkspacePointer = { schemaVersion: 10, documentId, courseId };
    localStorage.setItem(POINTER_KEY, JSON.stringify(pointer));
  } catch (error) {
    console.warn('Failed to write workspace pointer:', error);
  }
}

function clearWorkspacePointer(): void {
  try {
    localStorage.removeItem(POINTER_KEY);
  } catch (error) {
    console.warn('Failed to clear workspace pointer:', error);
  }
}

/** 清除 v9 及以前遗留在 localStorage 的全量项目状态（数据已镜像在 IndexedDB 课程库）。 */
export function cleanupLegacyStorage(): void {
  try {
    localStorage.removeItem(LEGACY_STATE_KEY);
  } catch (error) {
    console.warn('Failed to clean legacy storage:', error);
  }
}

async function mirrorToLibrary(state: Partial<ProjectState>): Promise<void> {
  const activeDocument = state.document;
  if (!activeDocument?.courseId) return;

  const toSave: Record<string, unknown> = {};
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
  // 运行中的任务刷新后不恢复为 running
  if (toSave.jobStatus === 'running') {
    toSave.job = null;
    toSave.jobStatus = 'idle';
  }

  const updatedAt = Date.now();
  await Promise.all([
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
  ]);
}

// ============== 防抖镜像 ==============
// 生成过程会连续触发多次保存；全量快照序列化较重，合并为最后一次状态的单次写入。

let pendingState: Partial<ProjectState> | null = null;
let mirrorTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

function scheduleMirror(state: Partial<ProjectState>): void {
  pendingState = state;
  if (mirrorTimer !== null) return;
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null;
    void flushPendingSaves();
  }, MIRROR_DEBOUNCE_MS);
}

/** 立即执行待写的镜像（也用于 beforeunload / 测试断言前）。 */
export async function flushPendingSaves(): Promise<void> {
  if (flushing) return flushing;
  const state = pendingState;
  pendingState = null;
  flushing = mirrorToLibrary(state ?? {}).finally(() => {
    flushing = null;
  });
  return flushing;
}

/** 丢弃未写入的镜像（重置时避免把旧状态写回课程库）。 */
export function cancelPendingSaves(): void {
  pendingState = null;
  if (mirrorTimer !== null) {
    clearTimeout(mirrorTimer);
    mirrorTimer = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (pendingState) void flushPendingSaves();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pendingState) void flushPendingSaves();
  });
}

/**
 * 保存工作区状态：写轻量指针 + 防抖镜像到 IndexedDB 课程库。
 * 项目数据不再进入 localStorage。
 */
export function saveState(state: Partial<ProjectState>): void {
  const activeDocument = state.document;
  if (activeDocument?.courseId) {
    writeWorkspacePointer(activeDocument.id, activeDocument.courseId);
    scheduleMirror(state);
  } else {
    clearWorkspacePointer();
  }
}

// 清除指针（课程库中的快照仍保留，可随时重新打开）
export function clearState(): void {
  cancelPendingSaves();
  clearWorkspacePointer();
}
