const DATABASE_NAME = "deutsch-pruefungen-exams";
const DATABASE_VERSION = 1;
const STORE_NAME = "publishedExamMetadata";
export const EXAM_CACHE_VERSION = "2026-07-14-v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const openDatabase = () => new Promise((resolve, reject) => {
  if (typeof indexedDB === "undefined") {
    resolve(null);
    return;
  }
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: "key" });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const runStoreRequest = async (mode, execute) => {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = execute(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
};

export const readExamMetadata = async (key) => {
  try {
    const entry = await runStoreRequest("readonly", (store) => store.get(key));
    if (!entry || entry.version !== EXAM_CACHE_VERSION || Date.now() - entry.cachedAt > MAX_AGE_MS) {
      if (entry) await runStoreRequest("readwrite", (store) => store.delete(key));
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
};

export const writeExamMetadata = async (key, value) => {
  try {
    await runStoreRequest("readwrite", (store) => store.put({
      key,
      version: EXAM_CACHE_VERSION,
      cachedAt: Date.now(),
      value,
    }));
  } catch {
    // IndexedDB is an optional performance layer; network data remains authoritative.
  }
};

export const clearExamMetadata = async () => {
  try {
    await runStoreRequest("readwrite", (store) => store.clear());
  } catch {
    // Nothing to clear when IndexedDB is unavailable.
  }
};
