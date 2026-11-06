import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingJournal, countPendingChanges } from './pendingJournal.js';

globalThis.IDBKeyRange = globalThis.IDBKeyRange || { bound: (lower, upper) => ({ lower, upper }) };

const memoryStorage = () => {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); }
  };
};

const fakeIndexedDB = () => {
  const data = new Map();
  const control = { data, failures: [], openFails: false, created: false, puts: 0 };
  const factory = {
    open: () => {
      const request = {};
      setTimeout(() => {
        if (control.openFails) {
          request.onerror?.();
          return;
        }
        request.result = {
          objectStoreNames: { contains: () => control.created },
          createObjectStore: () => { control.created = true; },
          close: () => {},
          transaction: (name, mode) => {
            const tx = { error: null };
            const writes = [];
            tx.objectStore = () => ({
              put: (value, key) => { writes.push(() => data.set(key, structuredClone(value))); return {}; },
              delete: (key) => { writes.push(() => data.delete(key)); return {}; },
              getAll: (range) => {
                const read = {};
                setTimeout(() => {
                  read.result = [...data.entries()].filter(([key]) => key >= range.lower && key <= range.upper).map(([, value]) => structuredClone(value));
                  read.onsuccess?.();
                });
                return read;
              }
            });
            if (mode === 'readwrite') {
              setTimeout(() => {
                const failure = control.failures.shift();
                if (failure) {
                  tx.error = { name: failure };
                  tx.onabort?.();
                  return;
                }
                control.puts += 1;
                writes.forEach((apply) => apply());
                tx.oncomplete?.();
              });
            }
            return tx;
          }
        };
        if (!control.created) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
  return { factory, control };
};

const entry = (opId) => ({ savedAt: 1, op: { opId, baseRevision: 1, upserts: [{ id: 'x', data: { id: 'x', left: 1 } }], deletes: [] }, base: { x: null } });
const record = (...opIds) => ({ beat: 1, ended: false, entries: opIds.map(entry) });
const LS = 'skribe:pending-canvas-ops:v2:user_a:board_1:inst_a';
const IDB = 'user_a:board_1:inst_a';
const open = (storage, factory, states = []) => createPendingJournal({ boardId: 'board_1', userId: 'user_a', storage, indexedDB: factory, onState: (state) => states.push(state) });

test('a write lands in localStorage at once and is only protected after the IndexedDB transaction completes', async () => {
  const storage = memoryStorage();
  const { factory, control } = fakeIndexedDB();
  const states = [];
  const journal = open(storage, factory, states);
  journal.write('inst_a', record('op_1'));
  assert.equal(JSON.parse(storage.getItem(LS)).seq, 1);
  assert.equal(journal.state(), 'pending');
  assert.equal(journal.confirmedSeq('inst_a'), 0);
  assert.equal(await journal.flush(), 'protected');
  assert.equal(control.data.get(IDB).json, storage.getItem(LS));
  assert.equal(journal.confirmedSeq('inst_a'), 1);
  assert.deepEqual(states, ['pending', 'protected']);
});

test('a quota abort keeps the last confirmed IndexedDB record byte-identical and never marks the newer edit as protected', async () => {
  const storage = memoryStorage();
  const { factory, control } = fakeIndexedDB();
  const journal = open(storage, factory);
  journal.write('inst_a', record('op_1'));
  await journal.flush();
  const confirmed = control.data.get(IDB).json;
  control.failures.push('QuotaExceededError');
  journal.write('inst_a', record('op_1', 'op_2'));
  assert.equal(await journal.flush(), 'full');
  assert.equal(control.data.get(IDB).json, confirmed);
  assert.equal(journal.confirmedSeq('inst_a'), 1);
  assert.equal(JSON.parse(storage.getItem(LS)).seq, 2);
  assert.equal(countPendingChanges(journal), 2);
  journal.write('inst_a', record('op_1', 'op_2'));
  assert.equal(await journal.flush(), 'protected');
  assert.equal(control.data.get(IDB).json, storage.getItem(LS));
});

test('reopening picks the newer copy by sequence: IndexedDB when localStorage lost a write, localStorage when the mirror never completed', async () => {
  const storage = memoryStorage();
  const { factory, control } = fakeIndexedDB();
  const first = open(storage, factory);
  first.write('inst_a', record('op_1'));
  await first.flush();
  first.write('inst_a', record('op_1', 'op_2'));
  await first.flush();
  storage.setItem(LS, JSON.stringify({ ...record('op_1'), seq: 1 }));
  assert.equal(JSON.parse(storage.getItem(LS)).entries.length, 1);
  const second = open(storage, factory);
  assert.equal(await second.load(), true);
  assert.deepEqual(second.list()[0].record.entries.map((item) => item.op.opId), ['op_1', 'op_2']);
  assert.equal(storage.getItem(LS), control.data.get(IDB).json);
  control.failures.push('AbortError');
  second.write('inst_a', record('op_1', 'op_2', 'op_3'));
  assert.equal(await second.flush(), 'error');
  const third = open(storage, factory);
  await third.load();
  assert.equal(third.list()[0].record.entries.length, 3);
  assert.equal(await third.flush(), 'protected');
  assert.equal(JSON.parse(control.data.get(IDB).json).entries.length, 3);
});

test('legacy localStorage-only records migrate into IndexedDB and corrupt copies never destroy the valid one', async () => {
  const storage = memoryStorage();
  const { factory, control } = fakeIndexedDB();
  storage.setItem(LS, JSON.stringify(record('op_legacy')));
  const journal = open(storage, factory);
  await journal.load();
  await journal.flush();
  assert.equal(control.data.get(IDB).json, storage.getItem(LS));
  control.data.set(IDB, { userId: 'user_a', boardId: 'board_1', instanceId: 'inst_a', seq: 9, json: '{broken' });
  const afterCorruptMirror = open(storage, factory);
  await afterCorruptMirror.load();
  await afterCorruptMirror.flush();
  assert.equal(afterCorruptMirror.list()[0].record.entries[0].op.opId, 'op_legacy');
  assert.equal(control.data.get(IDB).json, storage.getItem(LS));
  storage.setItem(LS, '{not json');
  const afterCorruptLocal = open(storage, factory);
  await afterCorruptLocal.load();
  assert.equal(afterCorruptLocal.list()[0].record.entries[0].op.opId, 'op_legacy');
  assert.equal(storage.getItem(LS), control.data.get(IDB).json);
});

test('cleanup survives a failed IndexedDB delete without replaying the cleared record, and a retry clears both stores', async () => {
  const storage = memoryStorage();
  const { factory, control } = fakeIndexedDB();
  const journal = open(storage, factory);
  journal.write('inst_a', record('op_1'));
  await journal.flush();
  control.failures.push('UnknownError');
  journal.remove('inst_a');
  assert.equal(await journal.flush(), 'error');
  assert.equal(JSON.parse(storage.getItem(LS)).cleared, true);
  assert.ok(control.data.has(IDB));
  assert.deepEqual(journal.list(), []);
  const reopened = open(storage, factory);
  await reopened.load();
  assert.deepEqual(reopened.list(), []);
  assert.equal(await reopened.flush(), 'protected');
  assert.equal(storage.getItem(LS), null);
  assert.equal(control.data.has(IDB), false);
});

test('the mirror keeps accounts, boards and tabs apart and rejects rows that claim another account', async () => {
  const storage = memoryStorage();
  const { factory, control } = fakeIndexedDB();
  const mine = open(storage, factory);
  mine.write('inst_a', record('op_a'));
  mine.write('inst_b', record('op_b'));
  await mine.flush();
  assert.deepEqual([...control.data.keys()].sort(), ['user_a:board_1:inst_a', 'user_a:board_1:inst_b']);
  const other = createPendingJournal({ boardId: 'board_1', userId: 'user_b', storage, indexedDB: factory });
  await other.load();
  assert.deepEqual(other.list(), []);
  const otherBoard = createPendingJournal({ boardId: 'board_2', userId: 'user_a', storage, indexedDB: factory });
  await otherBoard.load();
  assert.deepEqual(otherBoard.list(), []);
  control.data.set('user_a:board_1:inst_c', { userId: 'user_b', boardId: 'board_1', instanceId: 'inst_c', seq: 1, json: JSON.stringify(record('op_stolen')) });
  const check = open(memoryStorage(), factory);
  await check.load();
  assert.deepEqual(check.list().map((row) => row.instanceId).sort(), ['inst_a', 'inst_b']);
});

test('an unavailable IndexedDB keeps the localStorage journal working and reports that recovery storage is unavailable', async () => {
  const storage = memoryStorage();
  const { factory, control } = fakeIndexedDB();
  control.openFails = true;
  const journal = open(storage, factory);
  journal.write('inst_a', record('op_1'));
  assert.equal(await journal.flush(), 'unavailable');
  assert.equal(await journal.load(), false);
  assert.equal(journal.list()[0].record.entries[0].op.opId, 'op_1');
});
