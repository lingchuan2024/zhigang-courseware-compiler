import type {
  ChatConversation,
  ChatMessage,
  CourseNebulaSummary,
  GenerationStatus,
  LibraryCourse,
  LibraryDocument,
  ProjectState,
  RetrievalRecord,
} from '../types';
import { deleteDocumentSource } from './document-source';
import { buildCourseNebulaSummary, type NebulaSnapshotInput } from './nebula/nebula-summary';

const DB_NAME = 'zhigang-library';
const DB_VERSION = 3;
const COURSES = 'courses';
const DOCUMENTS = 'documents';
const SNAPSHOTS = 'snapshots';
const RETRIEVAL = 'retrieval-records';
const QA_CONVERSATIONS = 'qa-conversations';
const QA_MESSAGES = 'qa-messages';
const NEBULA_SUMMARIES = 'nebula-summaries';
const LOCAL_STORAGE_UNAVAILABLE = 'Local course library storage is temporarily unavailable. Please retry.';

interface SnapshotRecord {
  documentId: string;
  courseId: string;
  snapshot: Partial<ProjectState>;
}

const memory = {
  courses: new Map<string, LibraryCourse>(),
  documents: new Map<string, LibraryDocument>(),
  snapshots: new Map<string, SnapshotRecord>(),
  retrieval: new Map<string, RetrievalRecord>(),
  conversations: new Map<string, ChatConversation>(),
  messages: new Map<string, ChatMessage>(),
  nebulaSummaries: new Map<string, CourseNebulaSummary>(),
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

async function openLibraryDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  if (dbPromise) return dbPromise;
  let settled = false;
  const openingPromise = new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    const settleUnavailable = () => {
      if (settled) return;
      settled = true;
      if (dbPromise === openingPromise) dbPromise = null;
      reject(new Error(LOCAL_STORAGE_UNAVAILABLE));
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(COURSES)) db.createObjectStore(COURSES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DOCUMENTS)) {
        const store = db.createObjectStore(DOCUMENTS, { keyPath: 'id' });
        store.createIndex('courseId', 'courseId', { unique: false });
      }
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: 'documentId' });
      if (!db.objectStoreNames.contains(RETRIEVAL)) {
        const store = db.createObjectStore(RETRIEVAL, { keyPath: 'id' });
        store.createIndex('documentId', 'documentId', { unique: false });
        store.createIndex('courseId', 'courseId', { unique: false });
      }
      if (!db.objectStoreNames.contains(QA_CONVERSATIONS)) {
        const store = db.createObjectStore(QA_CONVERSATIONS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(QA_MESSAGES)) {
        const store = db.createObjectStore(QA_MESSAGES, { keyPath: 'id' });
        store.createIndex('conversationId', 'conversationId', { unique: false });
        store.createIndex('conversationCreatedAt', ['conversationId', 'createdAt'], { unique: false });
      }
      if (!db.objectStoreNames.contains(NEBULA_SUMMARIES)) {
        db.createObjectStore(NEBULA_SUMMARIES, { keyPath: 'courseId' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        if (dbPromise === openingPromise) dbPromise = null;
      };
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      resolve(db);
    };
    request.onerror = () => {
      if (settled) return;
      console.warn('Unable to open course library IndexedDB:', request.error);
      settleUnavailable();
    };
    request.onblocked = () => {
      if (settled) return;
      console.warn('Course library IndexedDB upgrade blocked; local persistence is unavailable.');
      settleUnavailable();
    };
  });
  dbPromise = openingPromise;
  return openingPromise;
}

export async function createLibraryCourse(input: { name: string; description?: string }): Promise<LibraryCourse> {
  const now = Date.now();
  const course: LibraryCourse = {
    id: makeId('course'),
    name: input.name.trim() || '未命名课程',
    description: input.description?.trim() || undefined,
    documentIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const db = await openLibraryDb();
  if (!db) {
    memory.courses.set(course.id, clone(course));
    return clone(course);
  }
  const tx = db.transaction(COURSES, 'readwrite');
  tx.objectStore(COURSES).put(course);
  await transactionDone(tx);
  return course;
}

export async function listLibraryCourses(): Promise<LibraryCourse[]> {
  const db = await openLibraryDb();
  const courses = db
    ? await requestValue(db.transaction(COURSES, 'readonly').objectStore(COURSES).getAll()) as LibraryCourse[]
    : Array.from(memory.courses.values()).map(clone);
  return courses.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function upsertLibraryDocument(document: LibraryDocument): Promise<void> {
  const normalized = clone(document);
  const db = await openLibraryDb();
  if (!db) {
    memory.documents.set(normalized.id, normalized);
    const course = memory.courses.get(normalized.courseId);
    if (course) {
      const documentIds = course.documentIds.includes(normalized.id)
        ? course.documentIds
        : [...course.documentIds, normalized.id];
      memory.courses.set(course.id, { ...course, documentIds, updatedAt: normalized.updatedAt });
    }
    return;
  }
  const tx = db.transaction([DOCUMENTS, COURSES], 'readwrite');
  tx.objectStore(DOCUMENTS).put(normalized);
  const courseStore = tx.objectStore(COURSES);
  const course = await requestValue(courseStore.get(normalized.courseId)) as LibraryCourse | undefined;
  if (course) {
    courseStore.put({
      ...course,
      documentIds: course.documentIds.includes(normalized.id) ? course.documentIds : [...course.documentIds, normalized.id],
      updatedAt: normalized.updatedAt,
    });
  }
  await transactionDone(tx);
}

export async function listLibraryDocuments(courseId?: string): Promise<LibraryDocument[]> {
  const db = await openLibraryDb();
  let documents: LibraryDocument[];
  if (!db) {
    documents = Array.from(memory.documents.values()).map(clone);
  } else {
    const tx = db.transaction(DOCUMENTS, 'readonly');
    const store = tx.objectStore(DOCUMENTS);
    documents = courseId
      ? await requestValue(store.index('courseId').getAll(courseId)) as LibraryDocument[]
      : await requestValue(store.getAll()) as LibraryDocument[];
  }
  return documents
    .filter(document => !courseId || document.courseId === courseId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteLibraryDocumentCascade(documentId: string): Promise<void> {
  const db = await openLibraryDb();
  if (!db) {
    const document = memory.documents.get(documentId);
    const snapshot = memory.snapshots.get(documentId);
    memory.documents.delete(documentId);
    memory.snapshots.delete(documentId);
    for (const [id, retrieval] of memory.retrieval) {
      if (retrieval.documentId === documentId) memory.retrieval.delete(id);
    }
    if (document) {
      const course = memory.courses.get(document.courseId);
      if (course) {
        memory.courses.set(course.id, {
          ...course,
          documentIds: course.documentIds.filter(id => id !== documentId),
          updatedAt: Date.now(),
        });
      }
      await rebuildCourseNebulaSummary(document.courseId);
    }
    await deleteDocumentSource(snapshot?.snapshot.document?.sourceKey ?? documentId);
    return;
  }

  const tx = db.transaction([COURSES, DOCUMENTS, SNAPSHOTS, RETRIEVAL], 'readwrite');
  const courseStore = tx.objectStore(COURSES);
  const documentStore = tx.objectStore(DOCUMENTS);
  const snapshotStore = tx.objectStore(SNAPSHOTS);
  const retrievalStore = tx.objectStore(RETRIEVAL);
  const document = await requestValue(documentStore.get(documentId)) as LibraryDocument | undefined;
  const snapshot = await requestValue(snapshotStore.get(documentId)) as SnapshotRecord | undefined;
  const retrieval = await requestValue(retrievalStore.index('documentId').getAll(documentId)) as RetrievalRecord[];

  documentStore.delete(documentId);
  snapshotStore.delete(documentId);
  retrieval.forEach(record => retrievalStore.delete(record.id));
  if (document) {
    const course = await requestValue(courseStore.get(document.courseId)) as LibraryCourse | undefined;
    if (course) {
      courseStore.put({
        ...course,
        documentIds: course.documentIds.filter(id => id !== documentId),
        updatedAt: Date.now(),
      });
    }
  }
  await transactionDone(tx);
  await deleteDocumentSource(snapshot?.snapshot.document?.sourceKey ?? documentId);
  if (document) await rebuildCourseNebulaSummary(document.courseId);
}

export async function deleteLibraryCourseCascade(courseId: string): Promise<void> {
  const db = await openLibraryDb();
  if (!db) {
    const documentIds = new Set<string>();
    const sourceKeys: string[] = [];
    for (const document of memory.documents.values()) {
      if (document.courseId === courseId) documentIds.add(document.id);
    }
    memory.courses.get(courseId)?.documentIds.forEach(id => documentIds.add(id));
    for (const documentId of documentIds) {
      sourceKeys.push(memory.snapshots.get(documentId)?.snapshot.document?.sourceKey ?? documentId);
      memory.documents.delete(documentId);
      memory.snapshots.delete(documentId);
    }
    for (const [id, retrieval] of memory.retrieval) {
      if (retrieval.courseId === courseId || documentIds.has(retrieval.documentId)) memory.retrieval.delete(id);
    }
    memory.courses.delete(courseId);
    memory.nebulaSummaries.delete(courseId);
    await Promise.all(sourceKeys.map(sourceKey => deleteDocumentSource(sourceKey)));
    return;
  }

  const tx = db.transaction([COURSES, DOCUMENTS, SNAPSHOTS, RETRIEVAL, NEBULA_SUMMARIES], 'readwrite');
  const courseStore = tx.objectStore(COURSES);
  const documentStore = tx.objectStore(DOCUMENTS);
  const snapshotStore = tx.objectStore(SNAPSHOTS);
  const retrievalStore = tx.objectStore(RETRIEVAL);
  const documents = await requestValue(documentStore.index('courseId').getAll(courseId)) as LibraryDocument[];
  const documentIds = documents.map(document => document.id);
  const snapshots = await Promise.all(
    documentIds.map(documentId => requestValue(snapshotStore.get(documentId)) as Promise<SnapshotRecord | undefined>),
  );
  const retrieval = await requestValue(retrievalStore.index('courseId').getAll(courseId)) as RetrievalRecord[];

  documents.forEach(document => documentStore.delete(document.id));
  documentIds.forEach(documentId => snapshotStore.delete(documentId));
  retrieval.forEach(record => retrievalStore.delete(record.id));
  courseStore.delete(courseId);
  tx.objectStore(NEBULA_SUMMARIES).delete(courseId);
  await transactionDone(tx);
  await Promise.all(snapshots.map((snapshot, index) =>
    deleteDocumentSource(snapshot?.snapshot.document?.sourceKey ?? documentIds[index])));
}

/** 将旧版单项目快照一次性归入本地课程空间。 */
export async function saveLibraryProjectSnapshot(
  courseId: string,
  documentId: string,
  snapshot: Partial<ProjectState>,
): Promise<void> {
  const record: SnapshotRecord = { courseId, documentId, snapshot: clone(snapshot) };
  const db = await openLibraryDb();
  if (!db) {
    memory.snapshots.set(documentId, record);
    await rebuildCourseNebulaSummary(courseId);
    return;
  }
  const tx = db.transaction(SNAPSHOTS, 'readwrite');
  tx.objectStore(SNAPSHOTS).put(record);
  await transactionDone(tx);
  await rebuildCourseNebulaSummary(courseId);
}

function toNebulaCardStatus(status: GenerationStatus | undefined): NebulaSnapshotInput['cards'][number]['status'] {
  if (status === 'failed') return 'failed';
  if (status === 'partial' || status === 'generating' || status === 'stale') return 'partial';
  if (status === 'pending') return 'none';
  return 'complete';
}

function snapshotToNebulaInput(record: SnapshotRecord): NebulaSnapshotInput {
  return {
    documentId: record.documentId,
    topics: (record.snapshot.knowledgeTopics ?? []).map(topic => ({
      id: topic.id,
      name: topic.name,
      aliases: topic.aliases,
      importance: topic.importance,
      sourceRangeCount: topic.sourceRanges.length,
    })),
    cards: (record.snapshot.knowledgeCards ?? []).map(card => ({
      topicId: card.topicId,
      status: toNebulaCardStatus(card.status),
    })),
  };
}

/** Rebuilds only the compact home-page payload; full project data remains in snapshots. */
export async function rebuildCourseNebulaSummary(courseId: string): Promise<CourseNebulaSummary | null> {
  const db = await openLibraryDb();
  if (!db) {
    const course = memory.courses.get(courseId);
    if (!course) {
      memory.nebulaSummaries.delete(courseId);
      return null;
    }
    const documents = Array.from(memory.documents.values()).filter(document => document.courseId === courseId);
    const snapshots = documents
      .map(document => memory.snapshots.get(document.id))
      .filter((record): record is SnapshotRecord => Boolean(record))
      .map(snapshotToNebulaInput);
    const summary = buildCourseNebulaSummary({ course, documents, snapshots });
    memory.nebulaSummaries.set(courseId, clone(summary));
    return summary;
  }

  const readTx = db.transaction([COURSES, DOCUMENTS, SNAPSHOTS], 'readonly');
  const course = await requestValue(readTx.objectStore(COURSES).get(courseId)) as LibraryCourse | undefined;
  if (!course) {
    const deleteTx = db.transaction(NEBULA_SUMMARIES, 'readwrite');
    deleteTx.objectStore(NEBULA_SUMMARIES).delete(courseId);
    await transactionDone(deleteTx);
    return null;
  }
  const documents = await requestValue(
    readTx.objectStore(DOCUMENTS).index('courseId').getAll(courseId),
  ) as LibraryDocument[];
  const snapshotStore = readTx.objectStore(SNAPSHOTS);
  const snapshotRecords = await Promise.all(
    documents.map(document => requestValue(snapshotStore.get(document.id)) as Promise<SnapshotRecord | undefined>),
  );
  await transactionDone(readTx);

  const summary = buildCourseNebulaSummary({
    course,
    documents,
    snapshots: snapshotRecords
      .filter((record): record is SnapshotRecord => Boolean(record))
      .map(snapshotToNebulaInput),
  });
  const writeTx = db.transaction(NEBULA_SUMMARIES, 'readwrite');
  writeTx.objectStore(NEBULA_SUMMARIES).put(summary);
  await transactionDone(writeTx);
  return summary;
}

export async function listCourseNebulaSummaries(): Promise<CourseNebulaSummary[]> {
  const db = await openLibraryDb();
  const summaries = db
    ? await requestValue(
      db.transaction(NEBULA_SUMMARIES, 'readonly').objectStore(NEBULA_SUMMARIES).getAll(),
    ) as CourseNebulaSummary[]
    : Array.from(memory.nebulaSummaries.values()).map(clone);
  return summaries.sort((left, right) => right.updatedAt - left.updatedAt || left.courseId.localeCompare(right.courseId));
}

export async function loadLibraryProjectSnapshot(documentId: string): Promise<Partial<ProjectState> | null> {
  const db = await openLibraryDb();
  const record = db
    ? await requestValue(db.transaction(SNAPSHOTS, 'readonly').objectStore(SNAPSHOTS).get(documentId)) as SnapshotRecord | undefined
    : memory.snapshots.get(documentId);
  return record ? clone(record.snapshot) : null;
}

export async function replaceDocumentRetrievalRecords(
  documentId: string,
  records: RetrievalRecord[],
): Promise<void> {
  const db = await openLibraryDb();
  if (!db) {
    for (const [id, record] of memory.retrieval) {
      if (record.documentId === documentId) memory.retrieval.delete(id);
    }
    records.forEach(record => memory.retrieval.set(record.id, clone(record)));
    return;
  }
  const tx = db.transaction(RETRIEVAL, 'readwrite');
  const store = tx.objectStore(RETRIEVAL);
  const existing = await requestValue(store.index('documentId').getAll(documentId)) as RetrievalRecord[];
  existing.forEach(record => store.delete(record.id));
  records.forEach(record => store.put(record));
  await transactionDone(tx);
}

export async function listRetrievalRecords(filter?: { courseIds?: string[]; documentIds?: string[] }): Promise<RetrievalRecord[]> {
  const db = await openLibraryDb();
  const records = db
    ? await requestValue(db.transaction(RETRIEVAL, 'readonly').objectStore(RETRIEVAL).getAll()) as RetrievalRecord[]
    : Array.from(memory.retrieval.values()).map(clone);
  const courseIds = filter?.courseIds ? new Set(filter.courseIds) : null;
  const documentIds = filter?.documentIds ? new Set(filter.documentIds) : null;
  return records.filter(record =>
    (!courseIds || courseIds.has(record.courseId)) &&
    (!documentIds || documentIds.has(record.documentId))
  );
}

export async function saveChatConversation(conversation: ChatConversation): Promise<void> {
  const normalized = clone(conversation);
  const db = await openLibraryDb();
  if (!db) {
    memory.conversations.set(normalized.id, normalized);
    return;
  }
  const tx = db.transaction(QA_CONVERSATIONS, 'readwrite');
  tx.objectStore(QA_CONVERSATIONS).put(normalized);
  await transactionDone(tx);
}

export async function listChatConversations(): Promise<ChatConversation[]> {
  const db = await openLibraryDb();
  const conversations = db
    ? await requestValue(db.transaction(QA_CONVERSATIONS, 'readonly').objectStore(QA_CONVERSATIONS).getAll()) as ChatConversation[]
    : Array.from(memory.conversations.values()).map(clone);
  return conversations.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export async function deleteChatConversation(conversationId: string): Promise<void> {
  const db = await openLibraryDb();
  if (!db) {
    memory.conversations.delete(conversationId);
    for (const [id, message] of memory.messages) {
      if (message.conversationId === conversationId) memory.messages.delete(id);
    }
    return;
  }
  const tx = db.transaction([QA_CONVERSATIONS, QA_MESSAGES], 'readwrite');
  tx.objectStore(QA_CONVERSATIONS).delete(conversationId);
  const messageStore = tx.objectStore(QA_MESSAGES);
  const messages = await requestValue(messageStore.index('conversationId').getAll(conversationId)) as ChatMessage[];
  messages.forEach(message => messageStore.delete(message.id));
  await transactionDone(tx);
}

export async function saveChatMessage(message: ChatMessage): Promise<void> {
  const normalized = clone(message);
  const db = await openLibraryDb();
  if (!db) {
    memory.messages.set(normalized.id, normalized);
    return;
  }
  const tx = db.transaction(QA_MESSAGES, 'readwrite');
  tx.objectStore(QA_MESSAGES).put(normalized);
  await transactionDone(tx);
}

export async function listChatMessages(conversationId: string): Promise<ChatMessage[]> {
  const db = await openLibraryDb();
  let messages: ChatMessage[];
  if (!db) {
    messages = Array.from(memory.messages.values()).map(clone);
  } else {
    const tx = db.transaction(QA_MESSAGES, 'readonly');
    messages = await requestValue(
      tx.objectStore(QA_MESSAGES).index('conversationId').getAll(conversationId),
    ) as ChatMessage[];
  }
  return messages
    .filter(message => message.conversationId === conversationId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export async function interruptPendingChatMessages(): Promise<void> {
  const now = Date.now();
  const db = await openLibraryDb();
  if (!db) {
    for (const [id, message] of memory.messages) {
      if (message.role !== 'assistant' || message.status !== 'pending') continue;
      memory.messages.set(id, clone({
        ...message,
        status: 'interrupted',
        error: '上次回答因页面关闭而中断',
        updatedAt: now,
      }));
    }
    return;
  }
  const tx = db.transaction(QA_MESSAGES, 'readwrite');
  const store = tx.objectStore(QA_MESSAGES);
  const messages = await requestValue(store.getAll()) as ChatMessage[];
  messages
    .filter(message => message.role === 'assistant' && message.status === 'pending')
    .forEach(message => store.put({
      ...message,
      status: 'interrupted',
      error: '上次回答因页面关闭而中断',
      updatedAt: now,
    }));
  await transactionDone(tx);
}

export async function resetLibraryRepositoryForTests(): Promise<void> {
  memory.courses.clear();
  memory.documents.clear();
  memory.snapshots.clear();
  memory.retrieval.clear();
  memory.conversations.clear();
  memory.messages.clear();
  memory.nebulaSummaries.clear();
  if (typeof indexedDB === 'undefined') return;
  const db = await dbPromise;
  db?.close();
  dbPromise = null;
  await new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
