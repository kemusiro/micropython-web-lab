export const PROJECT_DATABASE_NAME = "micropython-web-lab-project";
export const PROJECT_DATABASE_VERSION = 2;

/** Shared connection owner. A blocked/obsolete connection is never silently reused. */
export class ProjectDatabase {
  readonly #opening: Promise<IDBDatabase>;
  #closed = false;
  get closed(): boolean { return this.#closed; }

  constructor(factory: IDBFactory = indexedDB, name = PROJECT_DATABASE_NAME) {
    this.#opening = new Promise((resolve, reject) => {
      const request = factory.open(name, PROJECT_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (this.#closed) { request.transaction!.abort(); return; }
        for (const store of ["project", "experimentSets", "experimentWorkspace"]) {
          if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
        }
      };
      request.onblocked = () => {
        this.#closed = true;
        reject(new Error("Project database is blocked by another tab / 別のタブを閉じて再読み込みしてください"));
      };
      request.onerror = () => { this.#closed = true; reject(request.error); };
      request.onsuccess = () => {
        const db = request.result;
        if (this.#closed) { db.close(); reject(new Error("Project database closed")); return; }
        db.onversionchange = () => { this.#closed = true; db.close(); };
        db.onclose = () => { this.#closed = true; };
        resolve(db);
      };
    });
    void this.#opening.catch(() => {});
  }

  async connection(): Promise<IDBDatabase> {
    const db = await this.#opening;
    if (this.#closed) throw new Error("Project database changed or closed / 再読み込みしてください");
    return db;
  }

  close(): void {
    this.#closed = true;
    void this.#opening.then(db => db.close(), () => {});
  }
}

let sharedDatabase: ProjectDatabase | undefined;
export function getProjectDatabase(): ProjectDatabase {
  if (!sharedDatabase || sharedDatabase.closed) sharedDatabase = new ProjectDatabase();
  return sharedDatabase;
}

/** Keep all requests synchronous; the promise resolves on commit, never request success. */
export async function projectTransaction<T>(
  database: ProjectDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  read: (tx: IDBTransaction) => IDBRequest[],
  apply: (values: unknown[], tx: IDBTransaction) => T,
): Promise<T> {
  const db = await database.connection();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("Project transaction aborted"));
    const abort = (error: unknown) => { failure = error; tx.abort(); };
    try {
      const requests = read(tx);
      const values: unknown[] = new Array(requests.length);
      let remaining = requests.length;
      if (!remaining) result = apply(values, tx);
      requests.forEach((request, i) => {
        request.onsuccess = () => {
          values[i] = request.result;
          if (--remaining === 0) {
            try { result = apply(values, tx); } catch (error) { abort(error); }
          }
        };
      });
    } catch (error) { abort(error); }
  });
}
