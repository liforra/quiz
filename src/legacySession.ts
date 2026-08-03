// Finds a leftover Firebase Auth session in the browser.
//
// Users who were signed in before the migration still carry a valid Firebase
// session — the SDK is gone, but its data is still sitting in IndexedDB. That
// refresh token is proof they own the old account, so we can migrate them
// without asking for a password they may well have forgotten.
//
// Deletable together with server/migrate.js once everyone has moved.

const DB_NAME = 'firebaseLocalStorageDb';
const STORE = 'firebaseLocalStorage';

export interface LegacySession {
  uid: string;
  username: string;
  refreshToken: string;
}

// Opens the SDK's database *without* creating it: if the user never signed in
// with the old app there is nothing to find, and creating an empty database as
// a side effect of looking would be rude.
function openExisting(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME);
    } catch {
      return resolve(null); // private mode / IndexedDB blocked
    }
    let existed = true;
    req.onupgradeneeded = () => { existed = false; }; // fired only when it had to be created
    req.onsuccess = () => {
      const db = req.result;
      if (!existed || !db.objectStoreNames.contains(STORE)) {
        db.close();
        indexedDB.deleteDatabase(DB_NAME);
        return resolve(null);
      }
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

export async function findLegacySession(): Promise<LegacySession | null> {
  const db = await openExisting();
  if (!db) return null;
  try {
    const records: any[] = await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    for (const record of records) {
      // Keys look like `firebase:authUser:<apiKey>:[DEFAULT]` — matching on the
      // prefix avoids having to ship the Firebase API key to the client.
      if (!String(record?.fbase_key || '').startsWith('firebase:authUser:')) continue;
      const user = record.value;
      const refreshToken = user?.stsTokenManager?.refreshToken;
      if (!user?.uid || !refreshToken) continue;
      return {
        uid: user.uid,
        username: user.displayName || String(user.email || '').replace(/@quiz\.local$/, '') || user.uid,
        refreshToken
      };
    }
    return null;
  } finally {
    db.close();
  }
}

// Called once the account has been migrated, so a reload doesn't offer the
// same thing again.
export function clearLegacySession() {
  try {
    indexedDB.deleteDatabase(DB_NAME);
  } catch {
    // best effort — a stale database only costs one redundant offer
  }
}
