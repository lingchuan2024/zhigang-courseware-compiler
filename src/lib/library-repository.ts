import type {
  LibraryCourse,
  LibraryDocument,
  ProjectState,
  RetrievalRecord,
} from '../types';
import { buildRetrievalRecords } from './card-retrieval';

const DB_NAME = 'zhigang-library';
const DB_VERSION = 1;
const COURSES = 'courses';
const DOCUMENTS = 'documents';
const SNAPSHOTS = 'snapshots';
const RETRIEVAL = 'retrieval-records';

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
  dbPromise = new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('Unable to open course library IndexedDB:', request.error);
      resolve(null);
    };
  });
  return dbPromise;
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

/** 将旧版单项目快照一次性归入本地课程空间。 */
export async function migrateLegacyProjectToLibrary(
  legacy: Partial<ProjectState> | null | undefined,
): Promise<LibraryCourse | null> {
  const document = legacy?.document;
  if (!document) return null;
  const existingDocument = (await listLibraryDocuments()).find(item => item.id === document.id);
  if (existingDocument) {
    return (await listLibraryCourses()).find(course => course.id === existingDocument.courseId) ?? null;
  }

  const course = await createLibraryCourse({ name: document.title || '迁移课程' });
  const normalizedDocument = { ...document, courseId: course.id };
  const normalizedSnapshot: Partial<ProjectState> = {
    ...legacy,
    document: normalizedDocument,
    sourceDocuments: legacy.sourceDocuments?.map(source => ({ ...source, courseId: course.id })) ?? [],
    knowledgeTopics: legacy.knowledgeTopics?.map(topic => ({ ...topic, courseId: course.id })) ?? [],
    knowledgeCards: legacy.knowledgeCards?.map(card => ({ ...card, courseId: course.id })) ?? [],
  };
  await upsertLibraryDocument({
    id: document.id,
    courseId: course.id,
    title: document.title,
    fileName: document.fileName,
    fileType: document.fileType ?? 'markdown',
    pageCount: document.pages.length,
    stage: legacy.stage ?? 'upload',
    status: legacy.jobStatus === 'failed'
      ? 'failed'
      : legacy.stage === 'cards' || legacy.stage === 'notes' ? 'ready' : 'new',
    uploadedAt: document.uploadedAt,
    updatedAt: Date.now(),
    cardCount: normalizedSnapshot.knowledgeCards?.length ?? 0,
  });
  await saveLibraryProjectSnapshot(course.id, document.id, normalizedSnapshot);
  await replaceDocumentRetrievalRecords(
    document.id,
    buildRetrievalRecords(normalizedSnapshot.knowledgeCards ?? [], document.id, course.id),
  );
  return course;
}

export async function saveLibraryProjectSnapshot(
  courseId: string,
  documentId: string,
  snapshot: Partial<ProjectState>,
): Promise<void> {
  const record: SnapshotRecord = { courseId, documentId, snapshot: clone(snapshot) };
  const db = await openLibraryDb();
  if (!db) {
    memory.snapshots.set(documentId, record);
    return;
  }
  const tx = db.transaction(SNAPSHOTS, 'readwrite');
  tx.objectStore(SNAPSHOTS).put(record);
  await transactionDone(tx);
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

export async function resetLibraryRepositoryForTests(): Promise<void> {
  memory.courses.clear();
  memory.documents.clear();
  memory.snapshots.clear();
  memory.retrieval.clear();
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
