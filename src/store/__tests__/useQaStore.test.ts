import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChatConversation,
  ChatMessage,
  LibraryDocument,
  ModelConfig,
  RagAnswer,
  RetrievalRecord,
} from '../../types';
import {
  createLibraryCourse,
  listChatConversations,
  listChatMessages,
  replaceDocumentRetrievalRecords,
  resetLibraryRepositoryForTests,
  saveChatConversation,
  saveChatMessage,
  upsertLibraryDocument,
} from '../../lib/library-repository';
import { useQaStore, type QaAnswerer } from '../useQaStore';

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

const initialQaState = {
  conversations: [],
  messages: [],
  activeConversationId: null,
  selectedCitation: null,
  initialized: false,
  loadingConversation: false,
  activeRequestConversationIds: [],
  error: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  assertion();
}

function conversation(id: string, updatedAt: number, courseIds: string[] = []): ChatConversation {
  return {
    id,
    title: id,
    courseIds,
    createdAt: updatedAt,
    updatedAt,
    lastOpenedAt: updatedAt,
  };
}

function message(
  id: string,
  conversationId: string,
  role: ChatMessage['role'],
  status: ChatMessage['status'],
  createdAt: number,
  content = id,
): ChatMessage {
  return { id, conversationId, role, status, content, createdAt, updatedAt: createdAt };
}

function retrievalRecord(input: Partial<RetrievalRecord> & Pick<RetrievalRecord, 'id' | 'cardId' | 'courseId' | 'documentId'>): RetrievalRecord {
  return {
    topicId: `topic-${input.cardId}`,
    teachingBlockId: `block-${input.cardId}`,
    title: input.cardId,
    content: `${input.cardId} content`,
    keywords: [],
    aliases: [],
    sourceRanges: [],
    version: 1,
    ...input,
  };
}

async function addDocument(courseId: string, documentId: string, title: string): Promise<LibraryDocument> {
  const document: LibraryDocument = {
    id: documentId,
    courseId,
    title,
    fileName: `${documentId}.pdf`,
    fileType: 'pdf',
    pageCount: 1,
    stage: 'cards',
    status: 'ready',
    uploadedAt: 1,
    updatedAt: 1,
  };
  await upsertLibraryDocument(document);
  return document;
}

describe('QA conversation store', () => {
  beforeEach(async () => {
    await resetLibraryRepositoryForTests();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    });
    localStorage.clear();
    useQaStore.setState(initialQaState);
    vi.restoreAllMocks();
  });

  it('creates a conversation only on first send and restores it after initialize', async () => {
    const answerer = vi.fn<QaAnswerer>().mockResolvedValue(completedAnswer('GLM 回答'));

    await useQaStore.getState().initialize();
    expect(useQaStore.getState().initialized).toBe(true);
    expect(useQaStore.getState().conversations).toEqual([]);

    useQaStore.getState().startNewChat();
    expect(await listChatConversations()).toEqual([]);

    await useQaStore.getState().sendQuestion({ config, question: '  GLM 是什么？  ', answerer });

    expect(useQaStore.getState().conversations[0]).toMatchObject({
      title: 'GLM 是什么？',
      courseIds: [],
    });
    expect(useQaStore.getState().messages.map(item => item.role)).toEqual(['user', 'assistant']);
    expect(useQaStore.getState().messages[1].content).toBe('GLM 回答');

    useQaStore.setState(initialQaState);
    await useQaStore.getState().initialize();

    expect(useQaStore.getState().messages.map(item => item.content)).toEqual(['GLM 是什么？', 'GLM 回答']);
  });

  it('creates two chats and switches between their isolated messages', async () => {
    const answerer: QaAnswerer = async (_config, question) => completedAnswer(`回答：${question}`);

    await useQaStore.getState().sendQuestion({ config, question: '第一个问题', answerer });
    const firstId = useQaStore.getState().activeConversationId!;
    useQaStore.getState().startNewChat();
    await useQaStore.getState().sendQuestion({ config, question: '第二个问题', answerer });
    const secondId = useQaStore.getState().activeConversationId!;

    expect(secondId).not.toBe(firstId);
    expect(useQaStore.getState().messages.map(item => item.content)).toEqual(['第二个问题', '回答：第二个问题']);

    await useQaStore.getState().selectConversation(firstId);
    expect(useQaStore.getState().messages.map(item => item.content)).toEqual(['第一个问题', '回答：第一个问题']);

    await useQaStore.getState().selectConversation(secondId);
    expect(useQaStore.getState().messages.map(item => item.content)).toEqual(['第二个问题', '回答：第二个问题']);
  });

  it('routes a delayed answer to its owning conversation after the user switches chats', async () => {
    const slow = deferred<RagAnswer>();
    const slowAnswerer = vi.fn<QaAnswerer>(() => slow.promise);
    const fastAnswerer: QaAnswerer = async () => completedAnswer('第一条回答');

    await useQaStore.getState().sendQuestion({ config, question: '已有聊天', answerer: fastAnswerer });
    const firstId = useQaStore.getState().activeConversationId!;
    useQaStore.getState().startNewChat();
    const pendingSend = useQaStore.getState().sendQuestion({ config, question: '慢问题', answerer: slowAnswerer });
    await waitFor(() => expect(slowAnswerer).toHaveBeenCalledOnce());
    const slowConversationId = useQaStore.getState().activeConversationId!;

    await useQaStore.getState().selectConversation(firstId);
    slow.resolve(completedAnswer('慢回答'));
    await pendingSend;

    expect(useQaStore.getState().activeConversationId).toBe(firstId);
    expect(useQaStore.getState().messages.map(item => item.content)).toEqual(['已有聊天', '第一条回答']);
    expect((await listChatMessages(slowConversationId)).map(item => item.content)).toEqual(['慢问题', '慢回答']);
  });

  it('tracks concurrent requests as one conversation owner until every request settles without losing messages', async () => {
    const first = deferred<RagAnswer>();
    const second = deferred<RagAnswer>();
    const answerer = vi.fn<QaAnswerer>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const firstSend = useQaStore.getState().sendQuestion({ config, question: '问题一', answerer });
    await waitFor(() => expect(answerer).toHaveBeenCalledTimes(1));
    const conversationId = useQaStore.getState().activeConversationId!;
    const secondSend = useQaStore.getState().sendQuestion({ config, question: '问题二', answerer });
    await waitFor(() => expect(answerer).toHaveBeenCalledTimes(2));
    expect(useQaStore.getState().activeRequestConversationIds).toEqual([conversationId]);

    second.resolve(completedAnswer('回答二'));
    await secondSend;
    expect(useQaStore.getState().activeRequestConversationIds).toEqual([conversationId]);

    first.resolve(completedAnswer('回答一'));
    await firstSend;
    expect(useQaStore.getState().activeRequestConversationIds).toEqual([]);

    const stored = await listChatMessages(conversationId);
    expect(stored.map(item => item.content)).toEqual(['问题一', '回答一', '问题二', '回答二']);
    expect(stored.every(item => item.status === 'completed')).toBe(true);
  });

  it('renames a conversation, rejects a blank title, and deletes the active chat before selecting the newest remainder', async () => {
    await saveChatConversation(conversation('older', 1));
    await saveChatConversation(conversation('newer', 2));
    await useQaStore.getState().initialize();

    await useQaStore.getState().renameConversation('newer', '  新标题  ');
    expect(useQaStore.getState().conversations.find(item => item.id === 'newer')?.title).toBe('新标题');
    await expect(useQaStore.getState().renameConversation('newer', '   ')).rejects.toThrow('标题不能为空');

    await useQaStore.getState().deleteConversation('newer');
    expect(useQaStore.getState().activeConversationId).toBe('older');
    expect((await listChatConversations()).map(item => item.id)).toEqual(['older']);
  });

  it('persists a failed assistant and retries it without duplicating the original user message', async () => {
    const failing = vi.fn<QaAnswerer>().mockRejectedValue(new Error('模型暂时不可用'));
    await useQaStore.getState().sendQuestion({ config, question: '需要重试的问题', answerer: failing });
    const failed = useQaStore.getState().messages.find(item => item.role === 'assistant')!;

    expect(failed).toMatchObject({ status: 'failed', error: '模型暂时不可用' });

    const succeeding = vi.fn<QaAnswerer>().mockResolvedValue(completedAnswer('重试成功'));
    await useQaStore.getState().retryMessage(failed.id, config, succeeding);

    const stored = await listChatMessages(failed.conversationId);
    expect(stored.filter(item => item.role === 'user')).toHaveLength(1);
    expect(stored.filter(item => item.role === 'assistant')).toHaveLength(2);
    expect(stored[stored.length - 1]).toMatchObject({
      content: '重试成功',
      status: 'completed',
      retryOfMessageId: failed.id,
    });
  });

  it('passes bounded history into contextual retrieval and snapshots the exact selected hit', async () => {
    const course = await createLibraryCourse({ name: '机器学习' });
    await addDocument(course.id, 'doc-other', '其他课件');
    await addDocument(course.id, 'doc-selected', '实际命中的课件');
    await replaceDocumentRetrievalRecords('doc-other', [retrievalRecord({
      id: 'record-other', cardId: 'shared-card', courseId: course.id, documentId: 'doc-other',
      title: 'GLM 历史内容', content: 'GLM 旧来源', sourceExcerpt: '其他原文',
    })]);
    await replaceDocumentRetrievalRecords('doc-selected', [retrievalRecord({
      id: 'record-selected', cardId: 'shared-card', courseId: course.id, documentId: 'doc-selected',
      title: 'Bayes 精确内容', content: 'Bayes 当前来源', sourceExcerpt: '选中原文',
    })]);
    const answerer = vi.fn<QaAnswerer>()
      .mockResolvedValueOnce(completedAnswer('历史回答'))
      .mockImplementationOnce(async (_config, _question, hits, history) => {
        expect(history).toEqual(expect.arrayContaining([
          { role: 'user', content: '先讲 GLM' },
          { role: 'assistant', content: '历史回答' },
        ]));
        expect(hits[0].record.documentId).toBe('doc-selected');
        return completedAnswer('当前回答', [hits[0].record.cardId]);
      });

    await useQaStore.getState().sendQuestion({ config, question: '先讲 GLM', answerer });
    await useQaStore.getState().sendQuestion({ config, question: 'Bayes 是什么', answerer });

    const visibleMessages = useQaStore.getState().messages;
    const assistant = visibleMessages[visibleMessages.length - 1]!;
    expect(assistant.citations).toEqual([expect.objectContaining({
      cardId: 'shared-card',
      documentId: 'doc-selected',
      documentTitle: '实际命中的课件',
      sourceExcerpt: '选中原文',
    })]);
  });

  it('restores a valid active id and preserves its future course scope', async () => {
    const courseA = await createLibraryCourse({ name: '课程 A' });
    const courseB = await createLibraryCourse({ name: '课程 B' });
    await addDocument(courseA.id, 'doc-a', '课件 A');
    await addDocument(courseB.id, 'doc-b', '课件 B');
    await replaceDocumentRetrievalRecords('doc-a', [retrievalRecord({
      id: 'record-a', cardId: 'card-a', courseId: courseA.id, documentId: 'doc-a', title: '共同主题', content: 'A', keywords: ['共同主题'],
    })]);
    await replaceDocumentRetrievalRecords('doc-b', [retrievalRecord({
      id: 'record-b', cardId: 'card-b', courseId: courseB.id, documentId: 'doc-b', title: '共同主题', content: 'B', keywords: ['共同主题'],
    })]);
    await saveChatConversation(conversation('scoped', 1, [courseA.id]));
    await saveChatConversation(conversation('newer', 2));
    localStorage.setItem('zhigang_qa_active_conversation', 'scoped');

    await useQaStore.getState().initialize();
    expect(useQaStore.getState().activeConversationId).toBe('scoped');

    const answerer = vi.fn<QaAnswerer>().mockImplementation(async (_config, _question, hits) => {
      expect(hits.map(hit => hit.record.courseId)).toEqual([courseA.id]);
      return completedAnswer('限定回答', hits.map(hit => hit.record.cardId));
    });
    await useQaStore.getState().sendQuestion({ config, question: '共同主题', answerer });

    expect(useQaStore.getState().conversations.find(item => item.id === 'scoped')?.courseIds).toEqual([courseA.id]);
  });

  it('recovers pending assistants during initialize and supports citation drawer state', async () => {
    await saveChatConversation(conversation('chat', 1));
    await saveChatMessage(message('pending', 'chat', 'assistant', 'pending', 2, ''));

    await useQaStore.getState().initialize();
    expect(useQaStore.getState().messages[0]).toMatchObject({
      status: 'interrupted',
      error: '上次回答因页面关闭而中断',
    });

    const citation = {
      cardId: 'card', courseId: 'course', documentId: 'doc', courseName: '课程', documentTitle: '课件',
      title: '卡片', content: '内容',
    };
    useQaStore.getState().openCitation(citation);
    expect(useQaStore.getState().selectedCitation).toEqual(citation);
    useQaStore.getState().closeCitation();
    expect(useQaStore.getState().selectedCitation).toBeNull();
  });
});
