const PREFIX = 'skribe:pending-canvas-ops:v2:';

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

export const createPendingJournal = ({ boardId, userId, storage = globalThis.localStorage }) => {
  if (!boardId || !userId || !storage) return null;
  const prefix = `${PREFIX}${userId}:${boardId}:`;
  try {
    storage.setItem(`${PREFIX}probe`, '1');
    storage.removeItem(`${PREFIX}probe`);
  } catch {
    return null;
  }
  return {
    available: true,
    write: (instanceId, record) => storage.setItem(`${prefix}${instanceId}`, JSON.stringify(record)),
    remove: (instanceId) => storage.removeItem(`${prefix}${instanceId}`),
    list: () => {
      const records = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.startsWith(prefix)) continue;
        try {
          records.push({ instanceId: key.slice(prefix.length), record: JSON.parse(storage.getItem(key)) });
        } catch {
          records.push({ instanceId: key.slice(prefix.length), record: null });
        }
      }
      return records;
    }
  };
};

export default createPendingJournal;
