const PREFIX = 'skribe:pending-canvas-ops:v2:';
const DB_NAME = 'skribe-recovery';
const DB_VERSION = 1;
const STORE = 'pending';

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isObjectId = (value) => typeof value === 'string' && value.length > 0;

const isIdList = (value) => Array.isArray(value) && value.every(isObjectId);

export const isRecoverableEntry = (entry) => {
  const op = entry?.op;
  if (!isPlainObject(op) || !isObjectId(op.opId) || !Number.isInteger(op.baseRevision)) return false;
  const upserts = op.upserts ?? [];
  const deletes = op.deletes ?? [];
  if (!Array.isArray(upserts) || !Array.isArray(deletes)) return false;
  if (op.order !== undefined && !isIdList(op.order)) return false;
  if (entry.baseOrder !== undefined && !isIdList(entry.baseOrder)) return false;
  if (entry.base !== undefined && !isPlainObject(entry.base)) return false;
  return upserts.every((upsert) => isObjectId(upsert?.id) && isPlainObject(upsert.data)) && deletes.every(isObjectId);
};

export const isHeldItem = (item) => isObjectId(item?.id) && (item.mine === null || (isPlainObject(item.mine) && item.mine.id === item.id));

export const readRecord = (record) => {
  if (!isPlainObject(record)) return null;
  const rawEntries = Array.isArray(record.entries) ? record.entries : [];
  const rawHeld = Array.isArray(record.held) ? record.held : [];
  const entries = rawEntries.filter(isRecoverableEntry);
  const held = rawHeld.filter(isHeldItem);
  const orderUsable = record.heldOrder === undefined || record.heldOrder === null || isIdList(record.heldOrder);
  const damaged = (rawEntries.length - entries.length)
    + (rawHeld.length - held.length)
    + (Array.isArray(record.entries) ? 0 : 1)
    + (record.held === undefined || Array.isArray(record.held) ? 0 : 1)
    + (orderUsable ? 0 : 1);
  return { entries, held, heldOrder: orderUsable ? record.heldOrder ?? null : null, damaged };
};

export const countPendingChanges = (journal) => {
  try {
    return journal.list().reduce((total, { record }) => {
      const read = readRecord(record);
      return read ? total + read.entries.length + read.held.length + (read.heldOrder ? 1 : 0) : total;
    }, 0);
  } catch {
    return 0;
  }
};

const parse = (raw) => {
  try {
    const value = JSON.parse(raw);
    return isPlainObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const seqOf = (record) => (Number.isInteger(record?.seq) ? record.seq : 0);

const databases = new Map();

export const openRecoveryDatabase = (idb) => {
  if (!idb) return Promise.resolve(null);
  if (databases.has(idb)) return databases.get(idb);
  const opening = new Promise((resolve) => {
    let settled = false;
    const settle = (db) => {
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      resolve(db);
    };
    let request;
    try {
      request = idb.open(DB_NAME, DB_VERSION);
    } catch {
      settle(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      const forget = () => {
        if (databases.get(idb) === opening) databases.delete(idb);
      };
      db.onversionchange = () => {
        forget();
        db.close();
      };
      db.onclose = forget;
      settle(db);
    };
    request.onerror = () => settle(null);
    request.onblocked = () => settle(null);
  }).then((db) => {
    if (!db && databases.get(idb) === opening) databases.delete(idb);
    return db;
  });
  databases.set(idb, opening);
  return opening;
};

const failureOf = (error) => (error?.name === 'QuotaExceededError' ? 'full' : 'error');

export const createPendingJournal = ({ boardId, userId, storage = globalThis.localStorage, indexedDB: idb = globalThis.indexedDB, onState = null }) => {
  if (!boardId || !userId || !storage) return null;
  const scope = `${userId}:${boardId}:`;
  const prefix = `${PREFIX}${scope}`;
  try {
    storage.setItem(`${PREFIX}probe`, '1');
    storage.removeItem(`${PREFIX}probe`);
  } catch {
    return null;
  }
  const mirror = new Map();
  const latest = new Map();
  const queue = new Map();
  let draining = null;
  let failure = idb ? null : 'unavailable';
  let reported = null;

  const state = () => failure || (queue.size > 0 || draining ? 'pending' : 'protected');
  const emit = () => {
    const next = state();
    if (next === reported) return;
    reported = next;
    try {
      onState?.(next);
    } catch {
      reported = next;
    }
  };
  const bump = (instanceId, seq) => {
    if (seq > (latest.get(instanceId) || 0)) latest.set(instanceId, seq);
  };
  const nextSeq = (instanceId) => (latest.get(instanceId) || 0) + 1;
  const keyOf = (instanceId) => `${prefix}${instanceId}`;
  const localIds = () => {
    const ids = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(prefix)) ids.push(key.slice(prefix.length));
    }
    return ids;
  };

  const commit = (db, instanceId, job) => new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      if (job.json === null) store.delete(`${scope}${instanceId}`);
      else store.put({ userId: String(userId), boardId: String(boardId), instanceId, seq: job.seq, json: job.json }, `${scope}${instanceId}`);
    } catch (error) {
      resolve(error?.name === 'QuotaExceededError' ? 'full' : 'unavailable');
      return;
    }
    tx.oncomplete = () => resolve('complete');
    tx.onabort = () => resolve(failureOf(tx.error));
  });

  const drain = async () => {
    while (queue.size > 0) {
      const db = await openRecoveryDatabase(idb);
      const [instanceId, job] = queue.entries().next().value;
      queue.delete(instanceId);
      if (!db) {
        failure = 'unavailable';
        continue;
      }
      const result = await commit(db, instanceId, job);
      if (result !== 'complete') {
        failure = result;
        continue;
      }
      failure = null;
      if (job.json !== null) {
        mirror.set(instanceId, { seq: job.seq, json: job.json });
        continue;
      }
      mirror.delete(instanceId);
      if (latest.get(instanceId) === job.seq && !queue.has(instanceId)) {
        try {
          storage.removeItem(keyOf(instanceId));
        } catch {
          failure = 'error';
        }
      }
    }
  };

  const kick = () => {
    if (!draining) {
      draining = drain().finally(() => {
        draining = null;
        if (queue.size > 0) kick();
        else emit();
      });
    }
    emit();
  };

  const enqueue = (instanceId, seq, json) => {
    if (!idb) return;
    queue.delete(instanceId);
    queue.set(instanceId, { seq, json });
    kick();
  };

  const pick = (instanceId) => {
    const raw = storage.getItem(keyOf(instanceId));
    const local = raw === null ? null : parse(raw);
    const copy = mirror.get(instanceId);
    const mirrored = copy ? parse(copy.json) : null;
    bump(instanceId, Math.max(seqOf(local), copy?.seq || 0));
    if (local && (!mirrored || seqOf(local) >= copy.seq)) return local;
    if (mirrored) return mirrored;
    return raw === null ? undefined : null;
  };

  const readMirror = (db) => new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(IDBKeyRange.bound(scope, `${scope}￿`));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  const load = async () => {
    const db = await openRecoveryDatabase(idb);
    const rows = db ? await readMirror(db) : null;
    if (!Array.isArray(rows)) {
      if (idb) failure = 'unavailable';
      emit();
      return false;
    }
    const corrupt = [];
    rows.forEach((row) => {
      const valid = isPlainObject(row) && row.userId === String(userId) && row.boardId === String(boardId) && isObjectId(row.instanceId)
        && Number.isInteger(row.seq) && typeof row.json === 'string' && parse(row.json) !== undefined;
      if (!valid) {
        if (isObjectId(row?.instanceId)) corrupt.push(row.instanceId);
        return;
      }
      if (queue.has(row.instanceId) || (mirror.get(row.instanceId)?.seq || 0) > row.seq) return;
      mirror.set(row.instanceId, { seq: row.seq, json: row.json });
    });
    if (failure === 'unavailable') failure = null;
    new Set([...localIds(), ...mirror.keys(), ...corrupt]).forEach((instanceId) => {
      if (queue.has(instanceId)) return;
      const raw = storage.getItem(keyOf(instanceId));
      const local = raw === null ? null : parse(raw);
      const copy = mirror.get(instanceId);
      bump(instanceId, Math.max(seqOf(local), copy?.seq || 0));
      if (local && (!copy || seqOf(local) > copy.seq)) {
        enqueue(instanceId, seqOf(local), local.cleared ? null : raw);
        return;
      }
      if (copy && (!local || copy.seq > seqOf(local))) {
        try {
          storage.setItem(keyOf(instanceId), copy.json);
        } catch {
          failure = failure || 'error';
        }
        return;
      }
      if (local?.cleared) enqueue(instanceId, seqOf(local), null);
      else if (!copy && !local && corrupt.includes(instanceId)) enqueue(instanceId, nextSeq(instanceId), null);
    });
    emit();
    return true;
  };

  return {
    available: true,
    write: (instanceId, record) => {
      const seq = nextSeq(instanceId);
      const json = JSON.stringify({ ...record, seq });
      latest.set(instanceId, seq);
      try {
        storage.setItem(keyOf(instanceId), json);
      } finally {
        enqueue(instanceId, seq, json);
      }
    },
    remove: (instanceId) => {
      if (!idb) {
        storage.removeItem(keyOf(instanceId));
        return;
      }
      const seq = nextSeq(instanceId);
      latest.set(instanceId, seq);
      try {
        storage.setItem(keyOf(instanceId), JSON.stringify({ seq, cleared: true }));
      } finally {
        enqueue(instanceId, seq, null);
      }
    },
    list: () => {
      const records = [];
      new Set([...localIds(), ...mirror.keys()]).forEach((instanceId) => {
        const record = pick(instanceId);
        if (record === undefined || record?.cleared) return;
        records.push({ instanceId, record });
      });
      return records;
    },
    load,
    flush: async () => {
      while (draining) await draining;
      return state();
    },
    state,
    confirmedSeq: (instanceId) => mirror.get(instanceId)?.seq || 0
  };
};

export default createPendingJournal;
