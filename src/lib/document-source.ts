const DB_NAME = 'zhigang-document-sources';
const STORE_NAME = 'files';
const DB_VERSION = 1;

const memorySources = new Map<string, ArrayBuffer>();

function cloneBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDocumentSource(key: string, buffer: ArrayBuffer): Promise<void> {
  memorySources.set(key, cloneBuffer(buffer));
  const database = await openDatabase();
  if (!database) return;

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(buffer, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function loadDocumentSource(key: string): Promise<ArrayBuffer | null> {
  const cached = memorySources.get(key);
  if (cached) return cloneBuffer(cached);

  const database = await openDatabase();
  if (!database) return null;

  const value = await new Promise<ArrayBuffer | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result instanceof ArrayBuffer ? request.result : null);
    request.onerror = () => reject(request.error);
  });
  database.close();

  if (value) memorySources.set(key, cloneBuffer(value));
  return value ? cloneBuffer(value) : null;
}

export async function deleteDocumentSource(key: string): Promise<void> {
  memorySources.delete(key);
  const database = await openDatabase();
  if (!database) return;

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
