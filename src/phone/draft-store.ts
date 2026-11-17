import type { Draft } from "./editor/editor";

// IndexedDB, not localStorage: a few full-size screenshots exceed its ~5MB cap.
const DB = "fast-share-drafts";
const STORE = "kv";
const KEY = "drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let timer = 0;

export function saveDrafts(drafts: Draft[]): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const write =
      drafts.length > 0
        ? run("readwrite", (s) => s.put(drafts, KEY))
        : run("readwrite", (s) => s.delete(KEY));
    void write.catch(() => {});
  }, 400);
}

export async function loadDrafts(): Promise<Draft[]> {
  try {
    const saved = await run<Draft[] | undefined>("readonly", (s) => s.get(KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}
