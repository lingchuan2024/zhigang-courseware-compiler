const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveState, loadState, clearState } from '../persistence';
import {
  SCHEMA_VERSION,
  ProjectState,
  ProductStage,
  BackgroundJob,
  JobStatus,
  KnowledgePackage,
  TopicNoteStatus,
} from '../../types';
import { makeTopic, makeKnowledgePackage, makeNote } from './helpers';

// persistence.ts 内部使用的 localStorage 键
const STORAGE_KEY = 'zhigang_project_state';

// ============== 辅助函数 ==============

/**
 * 直接把原始状态写入 localStorage（绕过 saveState 的逻辑）。
 * 用于模拟"旧版本持久化数据被重新加载"的场景。
 * @param schemaVersion 持久化数据版本号，默认为当前 SCHEMA_VERSION
 */
function writeRawState(
  state: Record<string, unknown>,
  schemaVersion: number = SCHEMA_VERSION,
): void {
  const payload = { ...state, schemaVersion };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

/** 读取 localStorage 中的原始（反序列化后）状态。 */
function readRawState(): Record<string, unknown> | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as Record<string, unknown>;
}

/** 构造一个 noteStatus 为指定值的知识包。 */
function makePackageWithNoteStatus(
  topicId: string,
  noteStatus: TopicNoteStatus,
): KnowledgePackage {
  const topic = makeTopic({ id: topicId, noteStatus });
  return makeKnowledgePackage({ id: `kp-${topicId}`, topic });
}

/** 构造一个带有已完成 note 的知识包。 */
function makePackageWithCompletedNote(topicId: string): KnowledgePackage {
  const topic = makeTopic({ id: topicId, noteStatus: 'completed' });
  return makeKnowledgePackage({
    id: `kp-${topicId}`,
    topic,
    note: makeNote({ topicId }),
  });
}

// ============== 测试套件 ==============

describe('persistence migration', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // 每个用例清空 localStorage，保证隔离
    localStorage.clear();
    // 静默 console.warn，避免持久化失败时的噪声污染测试输出
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  // ------------------------------------------------------------------
  // 1. v4→v5 迁移：旧六步 WorkflowStage → 新四步 ProductStage
  // ------------------------------------------------------------------
  describe('v4->v5 stage migration', () => {
    const cases: Array<{
      oldStage: string;
      expectedStage: ProductStage;
      expectedJob: BackgroundJob;
      expectedJobStatus: JobStatus;
    }> = [
      // upload → upload (idle)
      { oldStage: 'upload',               expectedStage: 'upload',    expectedJob: null, expectedJobStatus: 'idle' },
      // parse-review → document (completed)
      { oldStage: 'parse-review',         expectedStage: 'document',  expectedJob: null, expectedJobStatus: 'completed' },
      // extracting-structure → structure (running 降级为 idle)
      { oldStage: 'extracting-structure', expectedStage: 'structure', expectedJob: null, expectedJobStatus: 'idle' },
      // structure-review → structure (completed)
      { oldStage: 'structure-review',     expectedStage: 'structure', expectedJob: null, expectedJobStatus: 'completed' },
      // generating-notes → notes (running 降级为 idle)
      { oldStage: 'generating-notes',     expectedStage: 'notes',     expectedJob: null, expectedJobStatus: 'idle' },
      // notes → notes (completed)
      { oldStage: 'notes',                expectedStage: 'notes',     expectedJob: null, expectedJobStatus: 'completed' },
    ];

    it.each(cases)(
      'migrates "$oldStage" -> stage=$expectedStage job=$expectedJob jobStatus=$expectedJobStatus',
      ({ oldStage, expectedStage, expectedJob, expectedJobStatus }) => {
        // 旧 stage 值不是合法的 ProductStage，需要经 unknown 中转
        writeRawState(
          { stage: oldStage, topics: [], knowledgePackages: [] } as unknown as Record<string, unknown>,
          4,
        );

        const result = loadState();

        expect(result).not.toBeNull();
        expect(result!.stage).toBe(expectedStage);
        expect(result!.job).toBe(expectedJob);
        expect(result!.jobStatus).toBe(expectedJobStatus);
      },
    );
  });

  // ------------------------------------------------------------------
  // 2. 旧 'generating' 阶段：根据数据推导新状态
  // ------------------------------------------------------------------
  describe('old "generating" stage derivation', () => {
    it('derives to "document" when no topics, no notes, and not extracting', () => {
      writeRawState(
        { stage: 'generating', topics: [], knowledgePackages: [] } as unknown as Record<string, unknown>,
        4,
      );

      const result = loadState();

      expect(result).not.toBeNull();
      expect(result!.stage).toBe('document');
      expect(result!.job).toBeNull();
      expect(result!.jobStatus).toBe('completed');
    });

    it('derives to "structure" (idle) when extracting and no topics', () => {
      writeRawState(
        {
          stage: 'generating',
          topics: [],
          knowledgePackages: [],
          structureExtractionStatus: 'extracting-topics',
        } as unknown as Record<string, unknown>,
        4,
      );

      const result = loadState();

      expect(result).not.toBeNull();
      expect(result!.stage).toBe('structure');
      // running 在刷新后降级为 idle
      expect(result!.job).toBeNull();
      expect(result!.jobStatus).toBe('idle');
    });

    it('derives to "structure" (completed) when topics exist but no notes', () => {
      const topic = makeTopic({ id: 't1' });
      writeRawState(
        {
          stage: 'generating',
          topics: [topic],
          knowledgePackages: [makePackageWithNoteStatus('t1', 'pending')],
        } as unknown as Record<string, unknown>,
        4,
      );

      const result = loadState();

      expect(result).not.toBeNull();
      expect(result!.stage).toBe('structure');
      expect(result!.job).toBeNull();
      expect(result!.jobStatus).toBe('completed');
    });

    it('derives to "structure" (completed) when topics exist but knowledgePackages is empty', () => {
      const topic = makeTopic({ id: 't1' });
      writeRawState(
        { stage: 'generating', topics: [topic], knowledgePackages: [] } as unknown as Record<string, unknown>,
        4,
      );

      const result = loadState();

      expect(result).not.toBeNull();
      expect(result!.stage).toBe('structure');
      expect(result!.jobStatus).toBe('completed');
    });

    it('derives to "notes" (idle) when some notes are generating', () => {
      const topicA = makeTopic({ id: 't1' });
      const topicB = makeTopic({ id: 't2' });
      writeRawState(
        {
          stage: 'generating',
          topics: [topicA, topicB],
          knowledgePackages: [
            makePackageWithNoteStatus('t1', 'completed'),
            makePackageWithNoteStatus('t2', 'generating'),
          ],
        } as unknown as Record<string, unknown>,
        4,
      );

      const result = loadState();

      expect(result).not.toBeNull();
      expect(result!.stage).toBe('notes');
      // running 在刷新后降级为 idle
      expect(result!.job).toBeNull();
      expect(result!.jobStatus).toBe('idle');
    });

    it('derives to "notes" (completed) when notes are completed (no generating)', () => {
      const topic = makeTopic({ id: 't1' });
      writeRawState(
        {
          stage: 'generating',
          topics: [topic],
          knowledgePackages: [makePackageWithCompletedNote('t1')],
        } as unknown as Record<string, unknown>,
        4,
      );

      const result = loadState();

      expect(result).not.toBeNull();
      expect(result!.stage).toBe('notes');
      expect(result!.job).toBeNull();
      expect(result!.jobStatus).toBe('completed');
    });
  });

  // ------------------------------------------------------------------
  // 3. running 状态在刷新后降级为 idle
  // ------------------------------------------------------------------
  describe('running states downgraded to idle on refresh', () => {
    it('downgrades running jobStatus in v5 data', () => {
      writeRawState({
        stage: 'structure',
        job: 'extracting-topics',
        jobStatus: 'running',
        topics: [],
      });

      const result = loadState();

      expect(result!.job).toBeNull();
      expect(result!.jobStatus).toBe('idle');
    });

    it('downgrades running from v4 "extracting-structure"', () => {
      writeRawState(
        { stage: 'extracting-structure', topics: [], knowledgePackages: [] } as unknown as Record<string, unknown>,
        4,
      );

      const result = loadState();

      expect(result!.job).toBeNull();
      expect(result!.jobStatus).toBe('idle');
    });

    it('downgrades running from v4 "generating-notes"', () => {
      writeRawState(
        { stage: 'generating-notes', topics: [makeTopic({ id: 't1' })], knowledgePackages: [] } as unknown as Record<string, unknown>,
        4,
      );

      const result = loadState();

      expect(result!.job).toBeNull();
      expect(result!.jobStatus).toBe('idle');
    });
  });

  // ------------------------------------------------------------------
  // 4. 回退迁移：v5 数据中残留旧 stage 字符串
  // ------------------------------------------------------------------
  describe('fallback migration for v5 data with old stage', () => {
    it('migrates "parse-review" in v5 data via fallback', () => {
      writeRawState(
        { stage: 'parse-review', topics: [], knowledgePackages: [] } as unknown as Record<string, unknown>,
      );

      const result = loadState();

      expect(result!.stage).toBe('document');
      expect(result!.jobStatus).toBe('completed');
    });

    it('migrates "extracting-structure" in v5 data via fallback', () => {
      writeRawState(
        { stage: 'extracting-structure', topics: [], knowledgePackages: [] } as unknown as Record<string, unknown>,
      );

      const result = loadState();

      expect(result!.stage).toBe('structure');
      expect(result!.jobStatus).toBe('idle');
    });

    it('migrates "generating" with topics in v5 data via fallback', () => {
      const topic = makeTopic({ id: 't1' });
      writeRawState(
        { stage: 'generating', topics: [topic], knowledgePackages: [] } as unknown as Record<string, unknown>,
      );

      const result = loadState();

      expect(result!.stage).toBe('structure');
      expect(result!.jobStatus).toBe('completed');
    });
  });

  // ------------------------------------------------------------------
  // 5. v7→v8：知识卡片与完整笔记拆分
  // ------------------------------------------------------------------
  describe('v7->v8 knowledge card and master note migration', () => {
    it('moves a V2 topic-note screen back to cards and initializes master-note state', () => {
      writeRawState({
        stage: 'notes',
        sourceDocuments: [{ id: 'doc-1', courseId: 'course-1', title: '课件', markdown: '# 课件', blocks: [], outline: [], contentHash: 'h', createdAt: '', updatedAt: '' }],
        knowledgeCards: [{ id: 'card-1' }],
        topicNotes: [{ topicId: 'topic-1', markdown: '# 旧知识点笔记', sectionBindings: [], glossaryUpdates: [], formulaUpdates: [], version: 1 }],
      }, 7);

      const result = loadState();

      expect(result!.stage).toBe('cards');
      expect(result!.topicSyntheses).toEqual([]);
      expect(result!.chapterPlan).toEqual([]);
      expect(result!.chapterNotes).toEqual([]);
      expect(result!.courseMasterNote).toBeNull();
      expect(result!.topicNotes).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------
  // 6. saveState 行为
  // ------------------------------------------------------------------
  describe('saveState', () => {
    it('downgrades running jobStatus to idle when saving', () => {
      saveState({
        stage: 'structure',
        job: 'extracting-topics',
        jobStatus: 'running',
        topics: [],
      });

      const raw = readRawState();
      expect(raw).not.toBeNull();
      expect(raw!.job).toBeNull();
      expect(raw!.jobStatus).toBe('idle');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('saves normal ProductStage values unchanged', () => {
      const stages: ProductStage[] = ['upload', 'document', 'mineru', 'structure', 'cards', 'notes'];

      for (const stage of stages) {
        clearState();
        saveState({ stage, topics: [] });
        const raw = readRawState();
        expect(raw).not.toBeNull();
        expect(raw!.stage).toBe(stage);
      }
    });

    it('saves old stage as-is (no conversion); loadState migrates via fallback', () => {
      // v5 的 saveState 不再做 stage 转换，旧 stage 原样写入；
      // loadState 的兜底逻辑会将其迁移为新的 ProductStage。
      saveState({
        stage: 'parse-review',
        topics: [],
      } as unknown as Partial<ProjectState>);

      const raw = readRawState();
      expect(raw).not.toBeNull();
      expect(raw!.stage).toBe('parse-review');

      const loaded = loadState();
      expect(loaded!.stage).toBe('document');
      expect(loaded!.jobStatus).toBe('completed');
    });
  });

  // ------------------------------------------------------------------
  // 7. round-trip：saveState -> loadState
  // ------------------------------------------------------------------
  describe('round-trip', () => {
    it('preserves stable ProductStage values through save/load', () => {
      const stages: ProductStage[] = ['upload', 'document', 'mineru', 'structure', 'cards', 'notes'];

      for (const stage of stages) {
        clearState();
        saveState({ stage, job: null, jobStatus: 'idle', topics: [] });
        const loaded = loadState();
        expect(loaded).not.toBeNull();
        expect(loaded!.stage).toBe(stage);
      }
    });

    it('never resumes running state after save/load', () => {
      saveState({
        stage: 'structure',
        job: 'extracting-topics',
        jobStatus: 'running',
        topics: [],
      });

      const loaded = loadState();
      expect(loaded!.job).toBeNull();
      expect(loaded!.jobStatus).toBe('idle');
    });
  });

  // ------------------------------------------------------------------
  // 8. 边界情况
  // ------------------------------------------------------------------
  describe('edge cases', () => {
    it('returns null when nothing is saved', () => {
      const result = loadState();
      expect(result).toBeNull();
    });

    it('clearState removes persisted state', () => {
      writeRawState({ stage: 'upload', topics: [] });
      expect(loadState()).not.toBeNull();

      clearState();

      expect(loadState()).toBeNull();
    });

    it('fills default collections when missing from persisted state', () => {
      writeRawState({ stage: 'upload' });

      const result = loadState();
      expect(result).not.toBeNull();
      expect(result!.topics).toEqual([]);
      expect(result!.macroRelations).toEqual([]);
      expect(result!.knowledgePackages).toEqual([]);
      expect(result!.globalAnchors).toEqual([]);
      expect(result!.occurrences).toEqual([]);
    });
  });
});
