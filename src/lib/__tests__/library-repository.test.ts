import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatConversation, ChatMessage, ProjectState, RetrievalRecord } from '../../types';
import {
  createLibraryCourse,
  deleteChatConversation,
  interruptPendingChatMessages,
  listChatConversations,
  listChatMessages,
  listLibraryCourses,
  listLibraryDocuments,
  listRetrievalRecords,
  loadLibraryProjectSnapshot,
  migrateLegacyProjectToLibrary,
  replaceDocumentRetrievalRecords,
  resetLibraryRepositoryForTests,
  saveChatConversation,
  saveChatMessage,
  saveLibraryProjectSnapshot,
  upsertLibraryDocument,
} from '../library-repository';
import { saveState } from '../persistence';

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

function snapshot(documentId: string, courseId: string, title: string): Partial<ProjectState> {
  return {
    stage: 'cards',
    document: {
      id: documentId,
      courseId,
      title,
      fileName: `${title}.pdf`,
      fileType: 'pdf',
      pages: [],
      uploadedAt: 1,
    },
    knowledgeCards: [],
  };
}

function record(cardId: string, courseId: string, documentId: string): RetrievalRecord {
  return {
    id: `retrieval-${cardId}`,
    cardId,
    courseId,
    documentId,
    topicId: 'topic-1',
    teachingBlockId: 'block-1',
    title: cardId,
    content: `${cardId} content`,
    keywords: [cardId],
    aliases: [],
    sourceRanges: [],
    version: 1,
  };
}

function conversation(id: string, updatedAt: number): ChatConversation {
  return {
    id,
    title: id,
    courseIds: [],
    createdAt: 1,
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
): ChatMessage {
  return {
    id,
    conversationId,
    role,
    content: id,
    status,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('library repository', () => {
  beforeEach(async () => {
    localStorageValues.clear();
    await resetLibraryRepositoryForTests();
  });

  it('stores multiple document snapshots inside one course', async () => {
    const course = await createLibraryCourse({ name: '机器学习' });
    await upsertLibraryDocument({
      id: 'doc-1', courseId: course.id, title: '第一讲', fileName: 'lecture1.pdf',
      fileType: 'pdf', pageCount: 20, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 2,
    });
    await upsertLibraryDocument({
      id: 'doc-2', courseId: course.id, title: '第二讲', fileName: 'lecture2.pptx',
      fileType: 'pptx', pageCount: 30, stage: 'structure', status: 'processing', uploadedAt: 3, updatedAt: 4,
    });
    await saveLibraryProjectSnapshot(course.id, 'doc-1', snapshot('doc-1', course.id, '第一讲'));
    await saveLibraryProjectSnapshot(course.id, 'doc-2', snapshot('doc-2', course.id, '第二讲'));

    expect((await listLibraryCourses())[0].documentIds).toEqual(['doc-1', 'doc-2']);
    expect((await listLibraryDocuments(course.id)).map(item => item.id)).toEqual(['doc-2', 'doc-1']);
    expect((await loadLibraryProjectSnapshot('doc-1'))?.document?.title).toBe('第一讲');
    expect((await loadLibraryProjectSnapshot('doc-2'))?.document?.title).toBe('第二讲');
  });

  it('replaces retrieval records for one document without changing another document', async () => {
    await replaceDocumentRetrievalRecords('doc-1', [record('card-a', 'course-1', 'doc-1')]);
    await replaceDocumentRetrievalRecords('doc-2', [record('card-b', 'course-1', 'doc-2')]);
    await replaceDocumentRetrievalRecords('doc-1', [record('card-c', 'course-1', 'doc-1')]);

    expect((await listRetrievalRecords()).map(item => item.cardId).sort()).toEqual(['card-b', 'card-c']);
    expect((await listRetrievalRecords({ courseIds: ['course-1'] })).length).toBe(2);
  });

  it('mirrors an active course document when the legacy persistence path saves', async () => {
    const state = {
      ...snapshot('doc-mirror', 'course-mirror', '镜像课件'),
      knowledgeCards: [{
        id: 'card-mirror', courseId: 'course-mirror', topicId: 'topic-1', topicName: 'GLM', teachingBlockId: 'block-1', teachingType: 'formula',
        title: 'GLM 公式', conciseSummary: '公式摘要', detailedNote: '公式正文', sourceRanges: [], keywords: ['GLM'], aliases: [],
        prerequisiteTopicIds: [], relatedTopicIds: [], confidence: 0.9, reviewStatus: 'generated' as const,
      }],
    };
    saveState(state);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect((await loadLibraryProjectSnapshot('doc-mirror'))?.document?.courseId).toBe('course-mirror');
    expect((await listRetrievalRecords()).map(item => item.cardId)).toEqual(['card-mirror']);
  });

  it('migrates one legacy project into a course space without losing card indexes', async () => {
    const legacy = {
      ...snapshot('legacy-doc', 'legacy-doc', '旧机器学习课件'),
      document: {
        id: 'legacy-doc', title: '旧机器学习课件', fileName: 'legacy.pdf', fileType: 'pdf' as const, pages: [], uploadedAt: 1,
      },
      sourceDocuments: [],
      knowledgeTopics: [],
      knowledgeCards: [{
        id: 'legacy-card', courseId: 'legacy-doc', topicId: 'topic-1', topicName: 'GLM', teachingBlockId: 'block-1', teachingType: 'formula',
        title: 'GLM', conciseSummary: '摘要', detailedNote: '正文', sourceRanges: [], keywords: ['GLM'], aliases: [],
        prerequisiteTopicIds: [], relatedTopicIds: [], confidence: 0.9, reviewStatus: 'generated' as const,
      }],
    };
    const migrated = await migrateLegacyProjectToLibrary(legacy);

    expect(migrated).not.toBeNull();
    const course = (await listLibraryCourses())[0];
    expect(course.documentIds).toEqual(['legacy-doc']);
    const restored = await loadLibraryProjectSnapshot('legacy-doc');
    expect(restored?.document?.courseId).toBe(course.id);
    expect(restored?.knowledgeCards?.[0].courseId).toBe(course.id);
    expect((await listRetrievalRecords())[0].courseId).toBe(course.id);
  });

  it('lists conversations by most recent update with an id tie-break', async () => {
    await saveChatConversation(conversation('conversation-b', 20));
    await saveChatConversation(conversation('conversation-old', 10));
    await saveChatConversation(conversation('conversation-a', 20));

    expect((await listChatConversations()).map(item => item.id)).toEqual([
      'conversation-a',
      'conversation-b',
      'conversation-old',
    ]);
  });

  it('lists messages chronologically with a stable id tie-break', async () => {
    await saveChatMessage(message('message-b', 'conversation-1', 'assistant', 'completed', 20));
    await saveChatMessage(message('message-other', 'conversation-2', 'user', 'completed', 5));
    await saveChatMessage(message('message-late', 'conversation-1', 'assistant', 'completed', 30));
    await saveChatMessage(message('message-a', 'conversation-1', 'user', 'completed', 20));

    expect((await listChatMessages('conversation-1')).map(item => item.id)).toEqual([
      'message-a',
      'message-b',
      'message-late',
    ]);
  });

  it('deletes a conversation and only its messages', async () => {
    await saveChatConversation(conversation('conversation-1', 10));
    await saveChatConversation(conversation('conversation-2', 20));
    await saveChatMessage(message('message-1', 'conversation-1', 'user', 'completed', 1));
    await saveChatMessage(message('message-2', 'conversation-1', 'assistant', 'completed', 2));
    await saveChatMessage(message('message-other', 'conversation-2', 'user', 'completed', 3));

    await deleteChatConversation('conversation-1');

    expect((await listChatConversations()).map(item => item.id)).toEqual(['conversation-2']);
    expect(await listChatMessages('conversation-1')).toEqual([]);
    expect((await listChatMessages('conversation-2')).map(item => item.id)).toEqual(['message-other']);
  });

  it('interrupts only pending assistant messages', async () => {
    const pendingAssistant = message('assistant-pending', 'conversation-1', 'assistant', 'pending', 1);
    const pendingUser = message('user-pending', 'conversation-1', 'user', 'pending', 2);
    const completedAssistant = message('assistant-completed', 'conversation-1', 'assistant', 'completed', 3);
    const failedAssistant = message('assistant-failed', 'conversation-1', 'assistant', 'failed', 4);
    await Promise.all([
      saveChatMessage(pendingAssistant),
      saveChatMessage(pendingUser),
      saveChatMessage(completedAssistant),
      saveChatMessage(failedAssistant),
    ]);
    const now = vi.spyOn(Date, 'now').mockReturnValue(100);

    await interruptPendingChatMessages();

    const messages = await listChatMessages('conversation-1');
    expect(messages.find(item => item.id === pendingAssistant.id)).toEqual({
      ...pendingAssistant,
      status: 'interrupted',
      error: '上次回答因页面关闭而中断',
      updatedAt: 100,
    });
    expect(messages.find(item => item.id === pendingUser.id)).toEqual(pendingUser);
    expect(messages.find(item => item.id === completedAssistant.id)).toEqual(completedAssistant);
    expect(messages.find(item => item.id === failedAssistant.id)).toEqual(failedAssistant);
    now.mockRestore();
  });
});
