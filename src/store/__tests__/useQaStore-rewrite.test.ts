import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig, RagAnswer, RetrievalRecord } from '../../types';
import {
  resetLibraryRepositoryForTests,
  replaceDocumentRetrievalRecords,
  upsertLibraryDocument,
} from '../../lib/library-repository';
import { resetQaStoreRuntimeForTests, useQaStore, type QaAnswerer } from '../useQaStore';

const rewriteMock = vi.hoisted(() => ({
  rewriteQueryForRetrieval: vi.fn(),
}));

vi.mock('../../lib/query-rewrite', async importOriginal => {
  const original = await importOriginal<typeof import('../../lib/query-rewrite')>();
  return {
    ...original,
    rewriteQueryForRetrieval: rewriteMock.rewriteQueryForRetrieval,
  };
});

const config: ModelConfig = {
  endpoint: 'https://example.test/v1',
  model: 'test-model',
  apiKey: 'test-key',
};

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

const completedAnswer = (content: string, cardIds: string[] = []): RagAnswer => ({
  mode: cardIds.length > 0 ? 'cards' : 'general',
  sections: [{ source: cardIds.length > 0 ? 'cards' : 'general', content, cardIds }],
});

function record(cardId: string, keywords: string[]): RetrievalRecord {
  return {
    id: `rec-${cardId}`,
    cardId,
    courseId: 'course-1',
    documentId: 'doc-1',
    topicId: `topic-${cardId}`,
    teachingBlockId: `tb-${cardId}`,
    title: cardId,
    content: `${cardId} content`,
    keywords,
    aliases: [],
    sourceRanges: [],
    version: 1,
  };
}

describe('QA 查询改写接入', () => {
  beforeEach(async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    });
    localStorageValues.clear();
    await resetLibraryRepositoryForTests();
    resetQaStoreRuntimeForTests();
    useQaStore.setState({
      conversations: [],
      messages: [],
      activeConversationId: null,
      selectedCitation: null,
      initialized: false,
      loadingConversation: false,
      activeRequestConversationIds: [],
      error: null,
    });
    rewriteMock.rewriteQueryForRetrieval.mockReset();

    await upsertLibraryDocument({
      id: 'doc-1', courseId: 'course-1', title: '正则化讲义', fileName: 'reg.pdf',
      fileType: 'pdf', pageCount: 3, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 1,
    });
    await replaceDocumentRetrievalRecords('doc-1', [
      record('card-reg', ['正则化', 'Ridge', 'Lasso']),
      record('card-mle', ['最大似然估计', 'MLE']),
    ]);
    await useQaStore.getState().initialize();
  });

  it('改写生效时多查询命中原本词面查不到的卡片，并记录检索词', async () => {
    rewriteMock.rewriteQueryForRetrieval.mockResolvedValue({
      queries: ['过拟合怎么防', '正则化 Ridge Lasso'],
      rewritten: true,
    });

    const seenCardIds: string[][] = [];
    const answerer: QaAnswerer = async (_config, _question, hits) => {
      seenCardIds.push(hits.map(hit => hit.record.cardId));
      return completedAnswer('正则化可以缓解过拟合', ['card-reg']);
    };

    await useQaStore.getState().sendQuestion({ config, question: '过拟合怎么防', answerer });

    // 原问题与卡片词面零重叠，靠改写查询命中
    expect(seenCardIds[0]).toContain('card-reg');
    expect(seenCardIds[0]).not.toContain('card-mle');

    const assistant = useQaStore.getState().messages.find(item => item.role === 'assistant');
    expect(assistant?.status).toBe('completed');
    expect(assistant?.retrievalQueries).toEqual(['过拟合怎么防', '正则化 Ridge Lasso']);
  });

  it('改写未生效时不记录检索词，行为与原有单查询一致', async () => {
    rewriteMock.rewriteQueryForRetrieval.mockResolvedValue({
      queries: ['最大似然估计是什么'],
      rewritten: false,
    });

    const answerer: QaAnswerer = async (_config, _question, hits) =>
      completedAnswer('MLE 回答', hits.map(hit => hit.record.cardId).slice(0, 1));

    await useQaStore.getState().sendQuestion({ config, question: '最大似然估计是什么', answerer });

    const assistant = useQaStore.getState().messages.find(item => item.role === 'assistant');
    expect(assistant?.status).toBe('completed');
    expect(assistant?.retrievalQueries).toBeUndefined();
  });
});
