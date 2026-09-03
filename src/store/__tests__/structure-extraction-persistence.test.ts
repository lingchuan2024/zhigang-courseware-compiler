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
import type { PipelineResultV2 } from '../../lib/knowledge-pipeline-v2';
import type { CourseLearningStructure } from '../../lib/course-structure/types';

const mirrors = vi.hoisted(() => ({
  runKnowledgePipeline: vi.fn(),
  saveLibraryProjectSnapshot: vi.fn(),
}));

vi.mock('../../lib/knowledge-pipeline-v2', () => ({
  runKnowledgePipeline: mirrors.runKnowledgePipeline,
}));

vi.mock('../../lib/library-repository', () => ({
  upsertLibraryDocument: vi.fn(),
  saveLibraryProjectSnapshot: mirrors.saveLibraryProjectSnapshot,
  replaceDocumentRetrievalRecords: vi.fn(),
}));

vi.mock('../../lib/card-retrieval', () => ({
  buildRetrievalRecords: vi.fn(() => []),
}));

import { useStore } from '../useStore';
import { flushPendingSaves } from '../../lib/persistence';

function seedExtractable(): void {
  useStore.setState({
    stage: 'mineru',
    job: null,
    jobStatus: 'idle',
    modelConfig: { endpoint: 'https://api.example.com/v1', model: 'test', apiKey: 'key' },
    document: {
      id: 'doc-1', courseId: 'course-1', title: '测试课件', fileName: 'lecture.pdf',
      fileType: 'pdf', uploadedAt: 1, pages: [{ pageNumber: 1, text: '内容' }],
    },
    sourceDocuments: [{
      id: 'doc-1', courseId: 'course-1', title: '测试课件', markdown: '# 课程',
      blocks: [], outline: [], contentHash: 'h', createdAt: '', updatedAt: '',
    }],
    courseLearningStructure: null,
    courseExtractionSession: null,
    knowledgeTopics: [],
    knowledgePipelineStatus: 'idle',
  });
}

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

describe('startKnowledgePipeline persistence', () => {
  it('stores and mirrors a degraded canonical structure as a usable result', async () => {
    seedExtractable();
    useStore.setState({
      staleMarker: {
        reason: 'source-reparsed', affectedTopicIds: [], affectedPackageIds: [], timestamp: 1,
        summary: '新增内容尚未覆盖',
      },
    });
    const canonical: CourseLearningStructure = {
      courseId: 'course-1', sourceVersion: 1, structureVersion: 1, compilerVersion: 'v1',
      topics: [], teachingUnits: [], evidenceSpans: [], orderConstraints: [], orderedTopicIds: [],
      teachingPaths: {}, status: 'degraded', checkpoints: [],
      validation: {
        issues: [{ code: 'FAILED_SECTION_BATCH', severity: 'error', message: '一个章节批次失败' }],
        meaningfulBlockCount: 1, coveredMeaningfulBlockCount: 0, coverageRate: 0,
      },
    };
    const result: PipelineResultV2 = {
      sourceDocuments: useStore.getState().sourceDocuments,
      allBlocks: [],
      courseLearningStructure: canonical,
      topics: [{
        id: 'topic-1', courseId: 'course-1', name: '可用主题', aliases: [], summary: '摘要',
        learningObjective: '学习', sourceRanges: [], childTopicIds: [], importance: 'core', difficulty: 1,
        knowledgeGenre: 'concept', confidence: 0.8, status: 'generated',
      }],
      topicRelations: [], teachingBlocks: [], teachingRelations: [],
      courseLearningPath: { orderedTopicIds: ['topic-1'], steps: [] }, narrativePaths: {},
      knowledgeCards: [], topicNotes: [], glossary: [], formulaCards: [], unassignedBlocks: [],
      versions: {
        source: 1, normalization: 1, topicStructure: 1, teachingStructure: 1,
        ordering: 1, cards: 0, notes: 0, embeddings: 0,
      },
      validation: {
        errors: [{ code: 'FAILED_SECTION_BATCH', message: '一个章节批次失败', severity: 'error' }],
        warnings: [],
        coverage: { totalBlocks: 1, assignedBlocks: 0, unassignedBlocks: [], coverageRate: 0 },
        topicStats: { totalTopics: 1, topicsWithTeachingBlocks: 0, avgTeachingBlocksPerTopic: 0 },
        qualityIssues: ['一个章节批次失败'],
      },
      warnings: [], errors: ['一个章节批次失败'], status: 'degraded',
    };
    mirrors.runKnowledgePipeline.mockResolvedValueOnce(result);

    await act(async () => { await useStore.getState().startKnowledgePipeline(); });
    await act(async () => { await flushPendingSaves(); });

    expect(mirrors.runKnowledgePipeline).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'course-1',
      expect.objectContaining({
        sourceDocuments: useStore.getState().sourceDocuments,
        previousStructure: null,
      }),
    );
    expect(useStore.getState().courseLearningStructure).toBe(canonical);
    expect(useStore.getState().knowledgePipelineStatus).toBe('degraded');
    expect(useStore.getState().jobStatus).toBe('completed');
    expect(useStore.getState().staleMarker).toBeNull();
    expect(useStore.getState().structureQuality?.qualityIssues).toEqual(['一个章节批次失败']);
    const mirrored = mirrors.saveLibraryProjectSnapshot.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(mirrored.courseLearningStructure).toEqual(canonical);
  });

  it('persists stage=structure at extraction start so a mid-extraction reload restores the structure view', async () => {
    seedExtractable();
    let rejectPipeline!: (reason: Error) => void;
    mirrors.runKnowledgePipeline.mockImplementationOnce(
      () => new Promise<PipelineResultV2>((_, reject) => { rejectPipeline = reject; }),
    );

    let running!: Promise<void>;
    await act(async () => {
      running = useStore.getState().startKnowledgePipeline();
    });
    await act(async () => { await flushPendingSaves(); });

    expect(useStore.getState().stage).toBe('structure');
    expect(JSON.parse(localStorageMock.getItem('zhigang_workspace_pointer')!)).toEqual(
      { schemaVersion: 10, documentId: 'doc-1', courseId: 'course-1' },
    );
    // 开始提取即落盘：快照里 stage 应为 structure（jobStatus running 已降级为 idle），
    // 而不是停留在 mineru——否则刷新后会被恢复到 MinerU 解析页。
    expect(mirrors.saveLibraryProjectSnapshot).toHaveBeenCalled();
    const mirrored = mirrors.saveLibraryProjectSnapshot.mock.calls[0][2] as Record<string, unknown>;
    expect(mirrored.stage).toBe('structure');
    expect(mirrored.jobStatus).toBe('idle');
    expect(mirrored.job).toBeNull();

    await act(async () => {
      rejectPipeline(new Error('end of test'));
      await running;
    });
  });

  it('persists every successful evidence unit so a reload can resume it', async () => {
    seedExtractable();
    let rejectPipeline!: (reason: Error) => void;
    mirrors.runKnowledgePipeline.mockImplementationOnce(
      () => new Promise<PipelineResultV2>((_, reject) => { rejectPipeline = reject; }),
    );

    let running!: Promise<void>;
    await act(async () => { running = useStore.getState().startKnowledgePipeline(); });
    const options = mirrors.runKnowledgePipeline.mock.calls[0][3];
    const checkpoint = {
      cacheKey: 'cache-a', batchId: 'batch-a', sectionIds: ['sec-a'],
      status: 'succeeded' as const, attempts: 1, completedAt: 100,
      result: {
        batchId: 'batch-a', sectionIds: ['sec-a'], topicMentions: [], teachingUnits: [],
        orderClaims: [], unresolvedReferences: [], confidence: 1,
      },
    };
    await act(async () => {
      options.onUnitCheckpoint?.(checkpoint);
      options.onExtractionProgress?.({
        completedUnits: 1, successfulUnits: 1, failedUnits: 0, totalUnits: 2,
        discoveredTopicMentions: 3, elapsedMs: 5_000,
      });
    });
    await act(async () => { await flushPendingSaves(); });

    expect(useStore.getState().courseExtractionSession?.checkpoints).toEqual([checkpoint]);
    expect(useStore.getState().pipelineProgress).toMatchObject({
      successfulItems: 1, failedItems: 0, discoveredItems: 3, elapsedMs: 5_000,
    });
    const mirrored = mirrors.saveLibraryProjectSnapshot.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(mirrored.courseExtractionSession).toMatchObject({
      courseId: 'course-1', checkpoints: [checkpoint],
    });

    await act(async () => {
      rejectPipeline(new Error('end of test'));
      await running;
    });
  });

  it('keeps the workspace on structure after a failed extraction instead of silently resetting', async () => {
    seedExtractable();
    mirrors.runKnowledgePipeline.mockRejectedValueOnce(new Error('模型超时'));

    await act(async () => {
      await useStore.getState().startKnowledgePipeline();
    });
    await act(async () => { await flushPendingSaves(); });

    expect(useStore.getState().stage).toBe('structure');
    expect(useStore.getState().jobStatus).toBe('failed');
    expect(useStore.getState().knowledgePipelineStatus).toBe('failed');
    expect(useStore.getState().pipelineProgress.message).toContain('模型超时');
  });
});
