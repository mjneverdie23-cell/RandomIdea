/**
 * Tiny IndexedDB key-value store.
 *
 * An imported Oracle's Elixir season is far too big for `localStorage`
 * (megabytes of structured objects), and IndexedDB stores structured clones
 * directly — no JSON round-trip. This is deliberately ~60 lines rather than a
 * dependency; it does exactly three things.
 */

const DB_NAME = 'draftcall';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  if (!idbAvailable()) return Promise.reject(new Error('IndexedDB is not available.'));
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'));
  });
  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
        tx.oncomplete = () => resolve(request.result);
      }),
  );
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return withStore<T | undefined>('readonly', (store) => store.get(key) as IDBRequest<T | undefined>);
}

export function idbSet(key: string, value: unknown): Promise<unknown> {
  return withStore('readwrite', (store) => store.put(value, key));
}

export function idbDelete(key: string): Promise<unknown> {
  return withStore('readwrite', (store) => store.delete(key));
}
