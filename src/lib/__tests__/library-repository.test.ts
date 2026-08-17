import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatConversation, ChatMessage, ProjectState, RetrievalRecord } from '../../types';
import {
  createLibraryCourse,
  deleteChatConversation,
  deleteLibraryCourseCascade,
  deleteLibraryDocumentCascade,
  interruptPendingChatMessages,
  listChatConversations,
  listChatMessages,
  listCourseNebulaSummaries,
  listLibraryCourses,
  listLibraryDocuments,
  listRetrievalRecords,
  loadLibraryProjectSnapshot,
  replaceDocumentRetrievalRecords,
  resetLibraryRepositoryForTests,
  saveChatConversation,
  saveChatMessage,
  saveLibraryProjectSnapshot,
  upsertLibraryDocument,
} from '../library-repository';
import { flushPendingSaves, saveState } from '../persistence';

const DB_NAME = 'zhigang-library';
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
Object.defineProperty(globalThis, 'indexedDB', {
  configurable: true,
  writable: true,
  value: new IDBFactory(),
});

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(version?: number): Promise<IDBDatabase> {
  return idbRequest(version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME));
}

function createVersionOneDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const courses = db.createObjectStore('courses', { keyPath: 'id' });
      courses.put({
        id: 'legacy-course',
        name: '旧课程',
        documentIds: [],
        createdAt: 1,
        updatedAt: 10,
      });
      const documents = db.createObjectStore('documents', { keyPath: 'id' });
      documents.createIndex('courseId', 'courseId', { unique: false });
      db.createObjectStore('snapshots', { keyPath: 'documentId' });
      const retrieval = db.createObjectStore('retrieval-records', { keyPath: 'id' });
      retrieval.createIndex('documentId', 'documentId', { unique: false });
      retrieval.createIndex('courseId', 'courseId', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to create version 1 database'));
  });
}

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

function snapshotWithTopic(
  documentId: string,
  courseId: string,
  title: string,
  topicId: string,
  topicName: string,
  sourceRangeCount = 1,
): Partial<ProjectState> {
  return {
    ...snapshot(documentId, courseId, title),
    knowledgeTopics: [{
      id: topicId,
      courseId,
      name: topicName,
      aliases: [],
      summary: '',
      learningObjective: '',
      sourceRanges: Array.from({ length: sourceRangeCount }, (_, index) => ({
        documentId,
        startBlockId: `block-${index}`,
        endBlockId: `block-${index}`,
      })),
      childTopicIds: [],
      importance: 'core',
      difficulty: 3,
      knowledgeGenre: 'concept',
      confidence: 0.9,
      status: 'generated',
    }],
    knowledgeCards: [{
      id: `card-${topicId}`,
      courseId,
      topicId,
      topicName,
      teachingBlockId: `teaching-${topicId}`,
      teachingType: 'definition',
      title: topicName,
      conciseSummary: '',
      detailedNote: '',
      sourceRanges: [],
      keywords: [],
      aliases: [],
      prerequisiteTopicIds: [],
      relatedTopicIds: [],
      confidence: 0.9,
      reviewStatus: 'generated',
      status: 'completed',
    }],
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
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it('persists merged nebula summaries and rebuilds them during cascades', async () => {
    const course = await createLibraryCourse({ name: '机器学习' });
    await upsertLibraryDocument({
      id: 'doc-1', courseId: course.id, title: '第一讲', fileName: 'lecture1.pdf',
      fileType: 'pdf', pageCount: 10, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 2,
    });
    await upsertLibraryDocument({
      id: 'doc-2', courseId: course.id, title: '第二讲', fileName: 'lecture2.pdf',
      fileType: 'pdf', pageCount: 12, stage: 'cards', status: 'ready', uploadedAt: 3, updatedAt: 4,
    });
    await saveLibraryProjectSnapshot(
      course.id,
      'doc-1',
      snapshotWithTopic('doc-1', course.id, '第一讲', 'softmax-a', 'Softmax', 2),
    );
    await saveLibraryProjectSnapshot(
      course.id,
      'doc-2',
      snapshotWithTopic('doc-2', course.id, '第二讲', 'softmax-b', ' softmax ', 1),
    );

    expect((await listCourseNebulaSummaries())[0]).toMatchObject({
      courseId: course.id,
      documentCount: 2,
      knowledgeCount: 1,
      completedCardCount: 1,
    });
    expect((await listCourseNebulaSummaries())[0].stars[0]).toMatchObject({
      sourceDocumentCount: 2,
      evidenceCount: 3,
    });

    await deleteLibraryDocumentCascade('doc-2');
    expect((await listCourseNebulaSummaries())[0].stars[0]).toMatchObject({
      sourceDocumentCount: 1,
      evidenceCount: 2,
    });

    await deleteLibraryCourseCascade(course.id);
    expect(await listCourseNebulaSummaries()).toEqual([]);
  });

  it('replaces retrieval records for one document without changing another document', async () => {
    await replaceDocumentRetrievalRecords('doc-1', [record('card-a', 'course-1', 'doc-1')]);
    await replaceDocumentRetrievalRecords('doc-2', [record('card-b', 'course-1', 'doc-2')]);
    await replaceDocumentRetrievalRecords('doc-1', [record('card-c', 'course-1', 'doc-1')]);

    expect((await listRetrievalRecords()).map(item => item.cardId).sort()).toEqual(['card-b', 'card-c']);
    expect((await listRetrievalRecords({ courseIds: ['course-1'] })).length).toBe(2);
  });

  it('deletes one document with its snapshot and retrieval records only', async () => {
    const course = await createLibraryCourse({ name: '机器学习' });
    await upsertLibraryDocument({
      id: 'doc-1', courseId: course.id, title: '第一讲', fileName: 'lecture1.pdf',
      fileType: 'pdf', pageCount: 10, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 2,
    });
    await upsertLibraryDocument({
      id: 'doc-2', courseId: course.id, title: '第二讲', fileName: 'lecture2.pdf',
      fileType: 'pdf', pageCount: 12, stage: 'cards', status: 'ready', uploadedAt: 3, updatedAt: 4,
    });
    await saveLibraryProjectSnapshot(course.id, 'doc-1', snapshot('doc-1', course.id, '第一讲'));
    await saveLibraryProjectSnapshot(course.id, 'doc-2', snapshot('doc-2', course.id, '第二讲'));
    await replaceDocumentRetrievalRecords('doc-1', [record('card-a', course.id, 'doc-1')]);
    await replaceDocumentRetrievalRecords('doc-2', [record('card-b', course.id, 'doc-2')]);

    await deleteLibraryDocumentCascade('doc-1');

    expect((await listLibraryDocuments(course.id)).map(item => item.id)).toEqual(['doc-2']);
    expect((await listLibraryCourses())[0].documentIds).toEqual(['doc-2']);
    expect(await loadLibraryProjectSnapshot('doc-1')).toBeNull();
    expect((await loadLibraryProjectSnapshot('doc-2'))?.document?.title).toBe('第二讲');
    expect((await listRetrievalRecords()).map(item => item.documentId)).toEqual(['doc-2']);
  });

  it('deletes a course and all derived courseware while retaining other courses and chat history', async () => {
    const deletedCourse = await createLibraryCourse({ name: '待删除课程' });
    const keptCourse = await createLibraryCourse({ name: '保留课程' });
    await upsertLibraryDocument({
      id: 'deleted-doc', courseId: deletedCourse.id, title: '删除讲义', fileName: 'delete.pdf',
      fileType: 'pdf', pageCount: 10, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 2,
    });
    await upsertLibraryDocument({
      id: 'kept-doc', courseId: keptCourse.id, title: '保留讲义', fileName: 'keep.pdf',
      fileType: 'pdf', pageCount: 10, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 2,
    });
    await saveLibraryProjectSnapshot(deletedCourse.id, 'deleted-doc', snapshot('deleted-doc', deletedCourse.id, '删除讲义'));
    await saveLibraryProjectSnapshot(keptCourse.id, 'kept-doc', snapshot('kept-doc', keptCourse.id, '保留讲义'));
    await replaceDocumentRetrievalRecords('deleted-doc', [record('deleted-card', deletedCourse.id, 'deleted-doc')]);
    await replaceDocumentRetrievalRecords('kept-doc', [record('kept-card', keptCourse.id, 'kept-doc')]);
    await saveChatConversation(conversation('history', 20));
    await saveChatMessage(message('history-message', 'history', 'assistant', 'completed', 21));

    await deleteLibraryCourseCascade(deletedCourse.id);

    expect((await listLibraryCourses()).map(item => item.id)).toEqual([keptCourse.id]);
    expect((await listLibraryDocuments()).map(item => item.id)).toEqual(['kept-doc']);
    expect(await loadLibraryProjectSnapshot('deleted-doc')).toBeNull();
    expect((await listRetrievalRecords()).map(item => item.cardId)).toEqual(['kept-card']);
    expect((await listChatConversations()).map(item => item.id)).toEqual(['history']);
    expect((await listChatMessages('history')).map(item => item.id)).toEqual(['history-message']);
  });

  it('mirrors an active course document when saveState flushes', async () => {
    const state = {
      ...snapshot('doc-mirror', 'course-mirror', '镜像课件'),
      knowledgeCards: [{
        id: 'card-mirror', courseId: 'course-mirror', topicId: 'topic-1', topicName: 'GLM', teachingBlockId: 'block-1', teachingType: 'formula',
        title: 'GLM 公式', conciseSummary: '公式摘要', detailedNote: '公式正文', sourceRanges: [], keywords: ['GLM'], aliases: [],
        prerequisiteTopicIds: [], relatedTopicIds: [], confidence: 0.9, reviewStatus: 'generated' as const,
      }],
    };
    saveState(state);
    await flushPendingSaves();

    expect((await loadLibraryProjectSnapshot('doc-mirror'))?.document?.courseId).toBe('course-mirror');
    expect((await listRetrievalRecords()).map(item => item.cardId)).toEqual(['card-mirror']);
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

    const db = await openDatabase();
    const storedMessages = await idbRequest(
      db.transaction('qa-messages', 'readonly').objectStore('qa-messages').getAll(),
    ) as ChatMessage[];
    db.close();
    expect(storedMessages.map(item => item.id)).toEqual(['message-other']);
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

    const db = await openDatabase();
    const storedMessage = await idbRequest(
      db.transaction('qa-messages', 'readonly').objectStore('qa-messages').get(pendingAssistant.id),
    ) as ChatMessage;
    db.close();
    expect(storedMessage.status).toBe('interrupted');
    expect(storedMessage.updatedAt).toBe(100);
    now.mockRestore();
  });

  it('upgrades version 1 data and creates the QA and nebula stores and indexes', async () => {
    const versionOneDb = await createVersionOneDatabase();
    versionOneDb.close();

    expect((await listLibraryCourses()).map(course => course.id)).toEqual(['legacy-course']);

    const db = await openDatabase();
    expect(db.version).toBe(3);
    expect(Array.from(db.objectStoreNames)).toEqual(expect.arrayContaining([
      'courses',
      'documents',
      'snapshots',
      'retrieval-records',
      'qa-conversations',
      'qa-messages',
      'nebula-summaries',
    ]));
    const course = await idbRequest(
      db.transaction('courses', 'readonly').objectStore('courses').get('legacy-course'),
    );
    const conversationStore = db.transaction('qa-conversations', 'readonly').objectStore('qa-conversations');
    const messageStore = db.transaction('qa-messages', 'readonly').objectStore('qa-messages');
    const conversationIndexes = Array.from(conversationStore.indexNames);
    const messageIndexes = Array.from(messageStore.indexNames);
    const updatedAtKeyPath = conversationStore.index('updatedAt').keyPath;
    const conversationIdKeyPath = messageStore.index('conversationId').keyPath;
    const conversationCreatedAtKeyPath = messageStore.index('conversationCreatedAt').keyPath;
    db.close();
    expect(course).toMatchObject({ id: 'legacy-course' });
    expect(conversationIndexes).toContain('updatedAt');
    expect(messageIndexes).toEqual(expect.arrayContaining(['conversationId', 'conversationCreatedAt']));
    expect(updatedAtKeyPath).toBe('updatedAt');
    expect(conversationIdKeyPath).toBe('conversationId');
    expect(conversationCreatedAtKeyPath).toEqual(['conversationId', 'createdAt']);
  });

  it('rejects a blocked write and persists it after the blocker closes and the write is retried', async () => {
    const versionOneDb = await createVersionOneDatabase();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const blockedWrite = saveChatConversation(conversation('after-block', 20));
    const outcome = await Promise.race([
      blockedWrite.then(
        () => ({ status: 'resolved' as const }),
        error => ({ status: 'rejected' as const, error }),
      ),
      new Promise<{ status: 'pending' }>(resolve => {
        setTimeout(() => resolve({ status: 'pending' }), 25);
      }),
    ]);

    versionOneDb.close();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(outcome).toMatchObject({ status: 'rejected' });
    if (outcome.status === 'rejected') {
      expect(outcome.error).toEqual(new Error('Local course library storage is temporarily unavailable. Please retry.'));
    }

    await saveChatConversation(conversation('after-block', 20));
    const db = await openDatabase();
    const storedConversation = await idbRequest(
      db.transaction('qa-conversations', 'readonly').objectStore('qa-conversations').get('after-block'),
    );
    db.close();

    expect(warning).toHaveBeenCalledWith('Course library IndexedDB upgrade blocked; local persistence is unavailable.');
    expect((await listChatConversations()).map(item => item.id)).toContain('after-block');
    expect(storedConversation).toMatchObject({ id: 'after-block' });
  });

  it('rejects a write when the IndexedDB open request errors', async () => {
    const futureDb = await openDatabase(4);
    futureDb.close();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(saveChatConversation(conversation('cannot-save', 20))).rejects.toThrow(
      'Local course library storage is temporarily unavailable. Please retry.',
    );
  });

  it('closes an open repository connection when another version is requested', async () => {
    await listLibraryCourses();
    const upgradeRequest = indexedDB.open(DB_NAME, 4);
    const upgrade = idbRequest(upgradeRequest);
    const outcome = await Promise.race([
      upgrade.then(() => 'opened' as const),
      new Promise<'blocked'>(resolve => {
        upgradeRequest.onblocked = () => resolve('blocked');
      }),
    ]);

    await resetLibraryRepositoryForTests();
    const upgradedDb = await upgrade;
    upgradedDb.close();
    expect(outcome).toBe('opened');
  });
});
