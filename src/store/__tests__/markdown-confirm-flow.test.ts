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

vi.mock('../../lib/library-repository', () => ({
  upsertLibraryDocument: vi.fn(),
  saveLibraryProjectSnapshot: vi.fn(),
  replaceDocumentRetrievalRecords: vi.fn(),
}));

vi.mock('../../lib/card-retrieval', () => ({
  buildRetrievalRecords: vi.fn(() => []),
}));

import { useStore } from '../useStore';

function seedMarkdownWorkspace(sourceDocumentsPresent: boolean): void {
  useStore.setState({
    stage: 'document',
    job: null,
    jobStatus: 'idle',
    document: {
      id: 'doc-md-1', courseId: 'course-1', title: '概率讲义', fileName: 'lecture.md',
      fileType: 'markdown', uploadedAt: 1,
      pages: [{ pageNumber: 1, text: '# 概率模型\n\n正文内容' }],
    },
    sourceDocuments: sourceDocumentsPresent
      ? [{
          id: 'doc-md-1', courseId: 'course-1', title: '概率讲义',
          markdown: '# 概率模型\n\n正文内容',
          blocks: [], outline: [], contentHash: 'h', createdAt: '', updatedAt: '',
        }]
      : [],
    mineruParseResult: null,
  });
}

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
  act(() => useStore.setState({
    sourceDocuments: [],
    knowledgeTopics: [],
    knowledgePipelineStatus: 'idle',
    mineruParseResult: null,
    staleMarker: null,
  }));
});

describe('startMinerUParse markdown flow', () => {
  it('marks markdown parse as completed so the extract button becomes reachable', async () => {
    seedMarkdownWorkspace(true);

    await act(async () => {
      await useStore.getState().startMinerUParse();
    });

    const state = useStore.getState();
    expect(state.stage).toBe('mineru');
    expect(state.mineruParseResult?.status).toBe('completed');
    expect(state.mineruParseResult?.markdown).toContain('概率模型');
    // sourceDocuments 保持不重复
    expect(state.sourceDocuments.length).toBe(1);
  });

  it('rebuilds sourceDocuments from pages when they are missing', async () => {
    seedMarkdownWorkspace(false);

    await act(async () => {
      await useStore.getState().startMinerUParse();
    });

    const state = useStore.getState();
    expect(state.sourceDocuments.length).toBe(1);
    expect(state.sourceDocuments[0]?.markdown).toContain('概率模型');
    expect(state.mineruParseResult?.status).toBe('completed');
  });
});
