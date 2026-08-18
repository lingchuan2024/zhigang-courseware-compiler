import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseDocument, ProjectState } from '../../types';

const mirrors = vi.hoisted(() => ({
  upsertLibraryDocument: vi.fn(),
  saveLibraryProjectSnapshot: vi.fn(),
  replaceDocumentRetrievalRecords: vi.fn(),
}));

vi.mock('../library-repository', () => ({
  upsertLibraryDocument: mirrors.upsertLibraryDocument,
  saveLibraryProjectSnapshot: mirrors.saveLibraryProjectSnapshot,
  replaceDocumentRetrievalRecords: mirrors.replaceDocumentRetrievalRecords,
}));
vi.mock('../card-retrieval', () => ({
  buildRetrievalRecords: vi.fn(() => []),
}));

import {
  cancelPendingSaves,
  cleanupLegacyStorage,
  clearState,
  flushPendingSaves,
  pickPersistedFields,
  saveState,
  writeWorkspacePointer,
} from '../persistence';

const localStorageValues = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
    removeItem: (key: string) => localStorageValues.delete(key),
    clear: () => localStorageValues.clear(),
  },
});

function makeDocument(overrides: Partial<CourseDocument> = {}): CourseDocument {
  return {
    id: 'doc-1',
    courseId: 'course-1',
    title: '测试课件',
    fileName: 'test.pdf',
    fileType: 'pdf',
    pages: [{ pageNumber: 1, text: '内容' }],
    uploadedAt: 1,
    ...overrides,
  };
}

function makeState(overrides: Partial<ProjectState> = {}): Partial<ProjectState> {
  return {
    stage: 'structure',
    document: makeDocument(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorageValues.clear();
  vi.clearAllMocks();
  cancelPendingSaves();
});

afterEach(() => {
  cancelPendingSaves();
  vi.useRealTimers();
});

describe('workspace pointer', () => {
  it('writes a v10 pointer on save and removes it when no document is active', () => {
    saveState(makeState());
    const pointer = JSON.parse(localStorageValues.get('zhigang_workspace_pointer')!);
    expect(pointer).toEqual({ schemaVersion: 10, documentId: 'doc-1', courseId: 'course-1' });

    saveState(makeState({ document: null }));
    expect(localStorageValues.has('zhigang_workspace_pointer')).toBe(false);
  });

  it('never writes project data into localStorage', () => {
    saveState(makeState({
      sourceDocuments: [{
        id: 'doc-1', courseId: 'course-1', title: '测试课件', markdown: '# 很长的课件正文',
        blocks: [], outline: [], contentHash: 'hash', createdAt: '', updatedAt: '',
      }],
    }));
    const keys = [...localStorageValues.keys()];
    expect(keys).toEqual(['zhigang_workspace_pointer']);
    expect((localStorageValues.get('zhigang_workspace_pointer') ?? '').length).toBeLessThan(200);
  });

  it('clearState removes the pointer and drops pending mirrors', () => {
    saveState(makeState());
    clearState();
    expect(localStorageValues.has('zhigang_workspace_pointer')).toBe(false);
    expect(mirrors.saveLibraryProjectSnapshot).not.toHaveBeenCalled();
  });

  it('writeWorkspacePointer records the active workspace explicitly', () => {
    writeWorkspacePointer('doc-9', 'course-9');
    expect(JSON.parse(localStorageValues.get('zhigang_workspace_pointer')!)).toEqual({
      schemaVersion: 10, documentId: 'doc-9', courseId: 'course-9',
    });
  });
});

describe('debounced library mirror', () => {
  it('merges saves inside the debounce window into one snapshot write', async () => {
    vi.useFakeTimers();
    saveState(makeState({ stage: 'mineru' }));
    vi.advanceTimersByTime(200);
    saveState(makeState({ stage: 'structure' }));
    vi.advanceTimersByTime(200);
    expect(mirrors.saveLibraryProjectSnapshot).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(mirrors.saveLibraryProjectSnapshot).toHaveBeenCalledTimes(1);
    const mirrored = mirrors.saveLibraryProjectSnapshot.mock.calls[0];
    expect(mirrored[0]).toBe('course-1');
    expect(mirrored[1]).toBe('doc-1');
    // 镜像的是防抖窗口内最后一次状态
    expect((mirrored[2] as Partial<ProjectState>).stage).toBe('structure');
  });

  it('flushPendingSaves writes immediately and is idempotent', async () => {
    saveState(makeState({ stage: 'cards' }));
    await flushPendingSaves();
    expect(mirrors.saveLibraryProjectSnapshot).toHaveBeenCalledTimes(1);

    // 无待写状态时再 flush 不产生新写入
    await flushPendingSaves();
    expect(mirrors.saveLibraryProjectSnapshot).toHaveBeenCalledTimes(1);
  });

  it('downgrades running jobs to idle in the mirrored snapshot', async () => {
    saveState(makeState({ job: 'extracting-topics', jobStatus: 'running' }));
    await flushPendingSaves();
    const mirrored = mirrors.saveLibraryProjectSnapshot.mock.calls[0][2] as Partial<ProjectState>;
    expect(mirrored.job).toBeNull();
    expect(mirrored.jobStatus).toBe('idle');
  });

  it('does not mirror when the document has no course binding', async () => {
    saveState(makeState({ document: makeDocument({ courseId: undefined }) }));
    await flushPendingSaves();
    expect(mirrors.saveLibraryProjectSnapshot).not.toHaveBeenCalled();
    expect(mirrors.upsertLibraryDocument).not.toHaveBeenCalled();
  });

  it('cancelPendingSaves drops the pending mirror', async () => {
    saveState(makeState());
    cancelPendingSaves();
    await flushPendingSaves();
    expect(mirrors.saveLibraryProjectSnapshot).not.toHaveBeenCalled();
  });
});

describe('legacy storage cleanup', () => {
  it('removes the pre-v10 full-state key', () => {
    localStorageValues.set('zhigang_project_state', JSON.stringify({ schemaVersion: 9, stage: 'notes' }));
    cleanupLegacyStorage();
    expect(localStorageValues.has('zhigang_project_state')).toBe(false);
    // 指针与其他 key 不受影响
    localStorageValues.set('zhigang_workspace_pointer', '{"schemaVersion":10}');
    localStorageValues.set('zhigang_model_config', '{}');
    cleanupLegacyStorage();
    expect(localStorageValues.has('zhigang_workspace_pointer')).toBe(true);
    expect(localStorageValues.has('zhigang_model_config')).toBe(true);
  });
});

describe('pickPersistedFields', () => {
  it('keeps whitelisted fields and drops unknown legacy keys', () => {
    const picked = pickPersistedFields({
      stage: 'notes',
      document: makeDocument(),
      knowledgeCards: [],
      // 旧 schema 遗留字段，不允许回流
      evidences: [{ id: 'ev-1' }],
      topics: [{ id: 'topic-1' }],
      schemaVersion: 8,
    });
    expect(Object.keys(picked).sort()).toEqual(['document', 'knowledgeCards', 'stage']);
  });
});
