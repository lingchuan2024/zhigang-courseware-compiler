import {
  ProjectState,
  SCHEMA_VERSION,
  KnowledgePackage,
  EvidenceAtom,
  MacroKnowledgeRelation,
} from '../types';
import { convertV1ToV2 } from './notes-v2';
import { computeContentHash } from './evidence';

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

    // v2 持久化字段（不包含API Key，不包含大图片预览）
    const persisted: (keyof ProjectState)[] = [
      'stage', 'document', 'evidences', 'topics', 'macroRelations',
      'knowledgePackages', 'orderMode', 'currentView', 'generationMemory',
      'globalAnchors', 'occurrences', 'structureWarnings', 'structureSource',
      'learningPath',
      // v1兼容字段
      'learningUnits', 'masterNotes',
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

    // 刷新时如果停留在 generating，应恢复到 structure-review
    if (toSave.stage === 'generating') {
      toSave.stage = 'structure-review';
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
  const stage = (oldState.stage as ProjectState['stage']) || 'upload';
  const document = oldState.document as ProjectState['document'] || null;
  const evidences = (oldState.evidences as ProjectState['evidences']) || [];
  const learningUnits = (oldState.learningUnits as ProjectState['learningUnits']) || [];
  const masterNotes = (oldState.masterNotes as ProjectState['masterNotes']) || [];

  // 如果有v1数据，转换为v2
  if (learningUnits.length > 0 && evidences.length > 0) {
    try {
      const { topics, relations, packages } = convertV1ToV2(learningUnits, masterNotes, evidences);
      return {
        stage: stage === 'generating' ? 'structure-review' : (stage === 'notes' ? 'notes' : 'structure-review'),
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
    stage: document ? 'parse-review' : 'upload',
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
      // v2 → v3 迁移
      result = migrateV2toV3(parsed);
    } else {
      result = parsed as Partial<ProjectState>;
    }

    // 状态恢复校验
    if (result.stage === 'generating') {
      result.stage = 'structure-review';
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
