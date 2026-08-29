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
    knowledgeTopics: [],
    knowledgePipelineStatus: 'idle',
  });
}

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

describe('startKnowledgePipeline persistence', () => {
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
