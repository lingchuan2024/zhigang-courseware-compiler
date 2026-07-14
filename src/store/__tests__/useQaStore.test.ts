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
import * as repository from '../../lib/library-repository';
import {
  resetQaStoreRuntimeForTests,
  useQaStore,
  type QaAnswerer,
} from '../useQaStore';

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
    vi.restoreAllMocks();
    await resetLibraryRepositoryForTests();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    });
    localStorage.clear();
    resetQaStoreRuntimeForTests();
    useQaStore.setState(initialQaState);
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

  it('lets cascade deletion win over a deferred answer without recreating orphan messages', async () => {
    const slow = deferred<RagAnswer>();
    const answerer = vi.fn<QaAnswerer>(() => slow.promise);

    const send = useQaStore.getState().sendQuestion({ config, question: '待删除问题', answerer });
    await waitFor(() => expect(answerer).toHaveBeenCalledOnce());
    const conversationId = useQaStore.getState().activeConversationId!;

    await useQaStore.getState().deleteConversation(conversationId);
    slow.resolve(completedAnswer('这个回答不应被保存'));
    await send;

    expect(await listChatMessages(conversationId)).toEqual([]);
    expect((await listChatConversations()).some(item => item.id === conversationId)).toBe(false);
    expect(useQaStore.getState().activeRequestConversationIds).not.toContain(conversationId);
  });

  it('marks a pending answer interrupted when cascade deletion itself fails', async () => {
    const slow = deferred<RagAnswer>();
    const answerer = vi.fn<QaAnswerer>(() => slow.promise);
    const send = useQaStore.getState().sendQuestion({ config, question: '删除失败问题', answerer });
    await waitFor(() => expect(answerer).toHaveBeenCalledOnce());
    const conversationId = useQaStore.getState().activeConversationId!;
    vi.spyOn(repository, 'deleteChatConversation').mockRejectedValueOnce(new Error('删除事务失败'));

    await expect(useQaStore.getState().deleteConversation(conversationId)).rejects.toThrow('删除事务失败');

    const interrupted = (await listChatMessages(conversationId)).find(item => item.role === 'assistant')!;
    expect(interrupted).toMatchObject({
      status: 'interrupted',
      error: '删除聊天失败，回答生成已中断',
    });
    expect(useQaStore.getState().messages.find(item => item.id === interrupted.id)).toMatchObject({
      status: 'interrupted',
    });
    expect(useQaStore.getState().activeRequestConversationIds).not.toContain(conversationId);

    const replacement = deferred<RagAnswer>();
    const replacementAnswerer = vi.fn<QaAnswerer>(() => replacement.promise);
    const replacementSend = useQaStore.getState().sendQuestion({
      config,
      question: '删除失败后的新问题',
      answerer: replacementAnswerer,
    });
    await waitFor(() => expect(replacementAnswerer).toHaveBeenCalledOnce());
    expect(useQaStore.getState().activeRequestConversationIds).toEqual([conversationId]);

    slow.resolve(completedAnswer('迟到回答'));
    await send;
    expect(useQaStore.getState().activeRequestConversationIds).toEqual([conversationId]);
    expect((await listChatMessages(conversationId)).find(item => item.id === interrupted.id)?.status).toBe('interrupted');
    replacement.resolve(completedAnswer('新回答'));
    await replacementSend;
    expect(useQaStore.getState().activeRequestConversationIds).toEqual([]);
  });

  it('keeps a successful cascade deleted when the following conversation refresh fails', async () => {
    const slow = deferred<RagAnswer>();
    const answerer = vi.fn<QaAnswerer>(() => slow.promise);
    const send = useQaStore.getState().sendQuestion({ config, question: '刷新失败问题', answerer });
    await waitFor(() => expect(answerer).toHaveBeenCalledOnce());
    const conversationId = useQaStore.getState().activeConversationId!;
    const refreshSpy = vi.spyOn(repository, 'listChatConversations')
      .mockRejectedValueOnce(new Error('列表刷新失败'));

    await expect(useQaStore.getState().deleteConversation(conversationId)).resolves.toBeUndefined();

    expect(useQaStore.getState().conversations.some(item => item.id === conversationId)).toBe(false);
    expect(useQaStore.getState().activeConversationId).toBeNull();
    expect(useQaStore.getState().messages).toEqual([]);
    expect(useQaStore.getState().error).toContain('聊天已删除');
    refreshSpy.mockRestore();
    slow.resolve(completedAnswer('不应复活的回答'));
    await send;

    expect(await listChatMessages(conversationId)).toEqual([]);
    expect((await listChatConversations()).some(item => item.id === conversationId)).toBe(false);
  });

  it('does not let a slow active deletion override a later conversation selection', async () => {
    await saveChatConversation(conversation('older', 1));
    await saveChatConversation(conversation('deleting', 2));
    await saveChatMessage(message('older-user', 'older', 'user', 'completed', 2, '旧聊天'));
    await useQaStore.getState().initialize();
    const deleteGate = deferred<void>();
    const realDelete = repository.deleteChatConversation;
    vi.spyOn(repository, 'deleteChatConversation').mockImplementation(async id => {
      await deleteGate.promise;
      return realDelete(id);
    });

    const deletion = useQaStore.getState().deleteConversation('deleting');
    await useQaStore.getState().selectConversation('older');
    useQaStore.getState().startNewChat();
    deleteGate.resolve();
    await deletion;

    expect(useQaStore.getState().activeConversationId).toBeNull();
    expect(useQaStore.getState().messages).toEqual([]);
  });

  it('clears stale messages while switching, blocks sends during load, and ignores a stale load result', async () => {
    const oldChat = conversation('old-chat', 1);
    const targetChat = conversation('target-chat', 2);
    useQaStore.setState({
      conversations: [targetChat, oldChat],
      activeConversationId: 'old-chat',
      messages: [message('old-message', 'old-chat', 'user', 'completed', 1, '旧内容')],
    });
    const loadGate = deferred<ChatMessage[]>();
    vi.spyOn(repository, 'listChatMessages').mockImplementation(id => (
      id === 'target-chat' ? loadGate.promise : Promise.resolve([])
    ));
    const answerer = vi.fn<QaAnswerer>().mockResolvedValue(completedAnswer('不应调用'));

    const selection = useQaStore.getState().selectConversation('target-chat');
    expect(useQaStore.getState().messages).toEqual([]);
    await expect(useQaStore.getState().sendQuestion({
      config,
      question: '加载期问题',
      answerer,
    })).rejects.toThrow('聊天正在加载');
    expect(answerer).not.toHaveBeenCalled();

    useQaStore.getState().startNewChat();
    loadGate.resolve([message('late', 'target-chat', 'user', 'completed', 3, '迟到内容')]);
    await selection;
    expect(useQaStore.getState().activeConversationId).toBeNull();
    expect(useQaStore.getState().messages).toEqual([]);
  });

  it('rejects a second generation in the same conversation before writing another message', async () => {
    const first = deferred<RagAnswer>();
    const answerer = vi.fn<QaAnswerer>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(completedAnswer('不应生成的回答'));

    const firstSend = useQaStore.getState().sendQuestion({ config, question: '问题一', answerer });
    await waitFor(() => expect(answerer).toHaveBeenCalledOnce());
    const conversationId = useQaStore.getState().activeConversationId!;
    const secondOutcome = useQaStore.getState().sendQuestion({
      config,
      question: '问题二',
      answerer,
    }).then(
      () => ({ status: 'resolved' as const, error: null }),
      error => ({ status: 'rejected' as const, error }),
    );

    first.resolve(completedAnswer('回答一'));
    await firstSend;
    const secondResult = await secondOutcome;
    expect(secondResult.status).toBe('rejected');
    expect(secondResult.error).toBeInstanceOf(Error);
    expect((secondResult.error as Error).message).toContain('当前聊天正在生成回答');
    expect(answerer).toHaveBeenCalledOnce();
    expect(useQaStore.getState().activeRequestConversationIds).toEqual([]);

    const stored = await listChatMessages(conversationId);
    expect(stored.map(item => item.content)).toEqual(['问题一', '回答一']);
    expect(stored.every(item => item.status === 'completed')).toBe(true);
  });

  it('reserves a blank draft synchronously so two immediate sends create only one chat', async () => {
    const saveGate = deferred<void>();
    const realSaveConversation = repository.saveChatConversation;
    vi.spyOn(repository, 'saveChatConversation').mockImplementation(async item => {
      await saveGate.promise;
      return realSaveConversation(item);
    });
    const answerer = vi.fn<QaAnswerer>().mockResolvedValue(completedAnswer('唯一回答'));

    const firstSend = useQaStore.getState().sendQuestion({ config, question: '第一次发送', answerer });
    const secondSend = useQaStore.getState().sendQuestion({ config, question: '双击发送', answerer });

    expect(useQaStore.getState().conversations).toEqual([]);
    expect(useQaStore.getState().messages).toEqual([]);
    expect(useQaStore.getState().activeConversationId).toBeNull();
    await expect(secondSend).rejects.toThrow('新聊天正在创建');

    saveGate.resolve();
    await firstSend;
    const conversations = await listChatConversations();
    expect(conversations).toHaveLength(1);
    const stored = await listChatMessages(conversations[0].id);
    expect(stored.filter(item => item.role === 'user').map(item => item.content)).toEqual(['第一次发送']);
    expect(answerer).toHaveBeenCalledOnce();
  });

  it('allows different conversations to generate concurrently without crossing results', async () => {
    const first = deferred<RagAnswer>();
    const second = deferred<RagAnswer>();
    const firstAnswerer = vi.fn<QaAnswerer>(() => first.promise);
    const secondAnswerer = vi.fn<QaAnswerer>(() => second.promise);

    const firstSend = useQaStore.getState().sendQuestion({ config, question: '聊天一问题', answerer: firstAnswerer });
    await waitFor(() => expect(firstAnswerer).toHaveBeenCalledOnce());
    const firstId = useQaStore.getState().activeConversationId!;
    useQaStore.getState().startNewChat();
    const secondSend = useQaStore.getState().sendQuestion({ config, question: '聊天二问题', answerer: secondAnswerer });
    await waitFor(() => expect(secondAnswerer).toHaveBeenCalledOnce());
    const secondId = useQaStore.getState().activeConversationId!;

    expect(new Set(useQaStore.getState().activeRequestConversationIds)).toEqual(new Set([firstId, secondId]));
    first.resolve(completedAnswer('聊天一回答'));
    await firstSend;
    expect(useQaStore.getState().messages.map(item => item.content)).toEqual(['聊天二问题', '']);

    second.resolve(completedAnswer('聊天二回答'));
    await secondSend;
    expect(useQaStore.getState().messages.map(item => item.content)).toEqual(['聊天二问题', '聊天二回答']);
    expect((await listChatMessages(firstId)).map(item => item.content)).toEqual(['聊天一问题', '聊天一回答']);
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

  it('follows retry chains back to the original assistant question', async () => {
    const failA = vi.fn<QaAnswerer>().mockRejectedValue(new Error('A 失败'));
    await useQaStore.getState().sendQuestion({ config, question: '问题 A', answerer: failA });
    const originalFailure = useQaStore.getState().messages.find(item => item.role === 'assistant')!;
    await useQaStore.getState().sendQuestion({
      config,
      question: '问题 B',
      answerer: async () => completedAnswer('B 成功'),
    });
    await useQaStore.getState().retryMessage(
      originalFailure.id,
      config,
      vi.fn<QaAnswerer>().mockRejectedValue(new Error('A 再次失败')),
    );
    const retryFailure = useQaStore.getState().messages[useQaStore.getState().messages.length - 1];
    const finalAnswerer = vi.fn<QaAnswerer>().mockResolvedValue(completedAnswer('A 最终成功'));

    await useQaStore.getState().retryMessage(retryFailure.id, config, finalAnswerer);

    expect(finalAnswerer.mock.calls[0][1]).toBe('问题 A');
    const stored = await listChatMessages(originalFailure.conversationId);
    expect(stored.filter(item => item.role === 'user').map(item => item.content)).toEqual(['问题 A', '问题 B']);
  });

  it('rejects retry when a visible target no longer exists in persistence', async () => {
    const ghost = message('ghost', 'chat', 'assistant', 'failed', 2, '');
    useQaStore.setState({
      conversations: [conversation('chat', 1)],
      activeConversationId: 'chat',
      messages: [ghost],
    });

    await expect(useQaStore.getState().retryMessage(
      ghost.id,
      config,
      async () => completedAnswer('不应调用'),
    )).rejects.toThrow('重试消息已不存在');
  });

  it('keeps a completed answer when only the conversation recency update fails', async () => {
    await saveChatConversation(conversation('chat', 1));
    await useQaStore.getState().initialize();
    vi.spyOn(repository, 'saveChatConversation').mockRejectedValueOnce(new Error('时间更新失败'));

    await useQaStore.getState().sendQuestion({
      config,
      question: '会成功的问题',
      answerer: async () => completedAnswer('已保存的回答'),
    });

    const stored = await listChatMessages('chat');
    expect(stored[stored.length - 1]).toMatchObject({ status: 'completed', content: '已保存的回答' });
    expect(useQaStore.getState().messages[useQaStore.getState().messages.length - 1]).toMatchObject({
      status: 'completed',
      content: '已保存的回答',
    });
    expect(useQaStore.getState().error).toContain('回答已保存');
  });

  it('does not publish or generate when initial conversation persistence fails', async () => {
    const answerer = vi.fn<QaAnswerer>().mockResolvedValue(completedAnswer('不应调用'));
    vi.spyOn(repository, 'saveChatConversation').mockRejectedValueOnce(new Error('数据库写入失败'));

    await useQaStore.getState().sendQuestion({ config, question: '新聊天问题', answerer });

    expect(useQaStore.getState().conversations).toEqual([]);
    expect(useQaStore.getState().messages).toEqual([]);
    expect(useQaStore.getState().activeConversationId).toBeNull();
    expect(localStorage.getItem('zhigang_qa_active_conversation')).toBeNull();
    expect(answerer).not.toHaveBeenCalled();
    expect(useQaStore.getState().error).toContain('保存问题失败');
  });

  it('rolls back a new conversation when its user message cannot be persisted', async () => {
    const answerer = vi.fn<QaAnswerer>().mockResolvedValue(completedAnswer('不应调用'));
    vi.spyOn(repository, 'saveChatMessage').mockRejectedValueOnce(new Error('消息写入失败'));

    await useQaStore.getState().sendQuestion({ config, question: '新聊天问题', answerer });

    expect(await listChatConversations()).toEqual([]);
    expect(useQaStore.getState().conversations).toEqual([]);
    expect(useQaStore.getState().messages).toEqual([]);
    expect(answerer).not.toHaveBeenCalled();
  });

  it('keeps an existing chat UI unchanged when its new user message cannot be persisted', async () => {
    await saveChatConversation(conversation('chat', 1));
    await saveChatMessage(message('existing', 'chat', 'user', 'completed', 2, '已有内容'));
    await useQaStore.getState().initialize();
    const answerer = vi.fn<QaAnswerer>().mockResolvedValue(completedAnswer('不应调用'));
    vi.spyOn(repository, 'saveChatMessage').mockRejectedValueOnce(new Error('消息写入失败'));

    await useQaStore.getState().sendQuestion({ config, question: '新问题', answerer });

    expect(useQaStore.getState().messages.map(item => item.content)).toEqual(['已有内容']);
    expect((await listChatMessages('chat')).map(item => item.content)).toEqual(['已有内容']);
    expect(answerer).not.toHaveBeenCalled();
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
