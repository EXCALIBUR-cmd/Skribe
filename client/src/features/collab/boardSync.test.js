import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCanvasOperation, buildCanvasOperation, conflictUndoObjects, mergeThreeWay, OPERATION_BYTE_LIMIT } from './boardSync.js';
import { createBoardSyncController } from './boardSyncController.js';
import { countPendingChanges, createPendingJournal } from './pendingJournal.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shape = (id, extra = {}) => ({ type: 'Rect', id, left: 10, top: 10, width: 100, height: 60, elementId: id.replace(/^shape_/, ''), ...extra });
const label = (id, parentShapeId, extra = {}) => ({ type: 'Textbox', id, text: 'Label', elementId: parentShapeId.replace(/^shape_/, ''), parentShapeId, ...extra });
const connector = (id, sourceShapeId, targetShapeId, path) => ({ type: 'Path', id, isConnector: true, sourceShapeId, targetShapeId, path });
const startingBoard = () => [
  shape('shape_a', { attachedTextId: 'text_a' }),
  label('text_a', 'shape_a'),
  shape('shape_b', { left: 400 }),
  connector('conn_ab', 'shape_a', 'shape_b', [['M', 110, 40], ['L', 400, 40]]),
  shape('shape_c', { left: 700, isStickyNote: true, noteColor: '#fce7f3', metadata: { isStickyNote: true, nested: { keep: [1, 2] } } })
];

const createServer = ({ enabled = true, objects = startingBoard() } = {}) => {
  const server = { enabled, revision: 0, lastOperationRevision: 0, objects: clone(objects), recent: new Map(), clients: [], saves: [], ops: [] };
  const broadcast = (from, method, event) => server.clients.filter((client) => client !== from && client.connected).forEach((client) => client.deliver(method, event));
  server.getBoard = () => ({ revision: server.revision, objects: clone(server.objects), enabled: server.enabled });
  server.saveBoard = (from, body) => {
    server.saves.push({ from: from.name, baseRevision: body.baseRevision });
    if (body.baseRevision !== undefined) {
      if (!server.enabled) return { ok: false, code: 'REVISION_PROTOCOL_DISABLED' };
      if (body.baseRevision !== server.revision) return { ok: false, code: 'STALE_REVISION', currentRevision: server.revision };
      server.lastOperationRevision = server.revision + 1;
    } else if (server.lastOperationRevision > 0) {
      return { ok: false, code: 'REVISION_REQUIRED', currentRevision: server.revision };
    }
    server.objects = clone(body.canvasData.objects);
    server.revision += 1;
    broadcast(from, 'receiveRevision', { revision: server.revision });
    return { ok: true, revision: server.revision };
  };
  server.operation = (from, payload) => {
    server.ops.push({ from: from.name, opId: payload.opId });
    if (!server.enabled) return { ok: false, code: 'OPERATIONS_DISABLED' };
    if (server.recent.has(payload.opId)) return { ok: true, duplicate: true, revision: server.recent.get(payload.opId) };
    if (payload.baseRevision !== server.revision) return { ok: false, code: 'STALE_REVISION', currentRevision: server.revision };
    const applied = applyCanvasOperation(server.objects, payload);
    if (!applied.ok) return { ok: false, code: applied.code, currentRevision: server.revision };
    server.objects = clone(applied.objects);
    server.revision += 1;
    server.lastOperationRevision = server.revision;
    server.recent.set(payload.opId, server.revision);
    const { boardId, opId, baseRevision, ...op } = payload;
    broadcast(from, 'receiveOperation', { boardId, opId, revision: server.revision, baseRevision, op: clone(op) });
    return { ok: true, revision: server.revision };
  };
  return server;
};

const createClient = (name, server, overrides = {}, { normalize = (objects) => objects, getBoard = null, onPrepare = null, journalStore = null, instanceId = undefined } = {}) => {
  const client = { name, server, stalled: [], recoveries: [], connected: true, busy: false, objects: [], undoBase: null, merges: [], conflicts: [], syncErrors: [], failOps: [], rejoins: 0, legacyBroadcasts: 0, saveRequests: 0, hold: null, held: [] };
  const canvas = {
    serialize: () => clone(client.objects),
    serializeIds: (wanted) => clone(client.objects.filter((object) => wanted.includes(object.id))),
    snapshot: () => (client.detached ? null : { version: '7.4.0', objects: clone(client.objects) }),
    prepare: async (objects) => {
      if (onPrepare) await onPrepare(objects);
      return new Map(objects.map((object) => [object.id, client.unpreparable?.includes(object.id) ? null : clone(object)]));
    },
    applyMerge: (merge) => {
      merge.changedIds.forEach((id) => assert.ok(merge.prepared.has(id), `unprepared ${id}`));
      client.merges.push(clone({ ...merge, prepared: undefined }));
      client.objects = normalize(clone(merge.objects));
      client.undoBase = merge.undoObjects ? clone(merge.undoObjects) : null;
    },
    isBusy: () => client.busy
  };
  client.controller = createBoardSyncController({
    boardId: 'board_1',
    api: {
      getBoard: async () => (getBoard ? getBoard() : server.getBoard()),
      saveBoard: async (body) => (client.saveFails ? { ok: false, code: 'NETWORK_ERROR' } : server.saveBoard(client, clone(body))),
      saveOnUnload: (body) => { client.unloadSaves = (client.unloadSaves || 0) + 1; server.saveBoard(client, clone(body)); return true; }
    },
    socket: {
      emitOperation: async (payload) => {
        if (client.stall) return new Promise((resolve) => client.stalled.push({ payload: clone(payload), resolve }));
        if (client.failOps[0] === 'COMMIT_THEN_TIMEOUT') {
          client.failOps.shift();
          server.operation(client, clone(payload));
          return { ok: false, code: 'ACK_TIMEOUT' };
        }
        if (client.failOps.length > 0) return { ok: false, code: client.failOps.shift() };
        return client.connected ? server.operation(client, clone(payload)) : { ok: false, code: 'DISCONNECTED' };
      },
      rejoin: () => { client.rejoins += 1; },
      isConnected: () => client.connected,
      send: (payload) => { client.sent = (client.sent || 0) + 1; if (client.connected) server.operation(client, clone(payload)); }
    },
    canvas,
    notify: (kind, detail) => {
      if (kind === 'conflict') client.conflicts.push(...detail.ids);
      if (kind === 'sync-error') client.syncErrors.push(detail.code);
      if (kind === 'unrestorable') client.unrestorable = detail.count;
      if (kind === 'synced') client.synced = (client.synced || 0) + 1;
      if (kind === 'recovered') client.recoveries.push(detail);
      if (kind === 'recovery-state') client.recoveryState = detail;
      if (kind === 'journal-unavailable') client.journalWarnings = (client.journalWarnings || 0) + 1;
    },
    requestSave: () => { client.saveRequests += 1; },
    random: () => 0,
    journal: journalStore ? {
      available: true,
      write: (id, record) => { if (journalStore.failWrites) throw new Error('QuotaExceededError'); journalStore.records[id] = clone(record); },
      remove: (id) => { delete journalStore.records[id]; },
      list: () => Object.entries(journalStore.records).map(([id, record]) => ({ instanceId: id, record: clone(record) }))
    } : null,
    ...(instanceId ? { instanceId } : {}),
    options: { pullDelayMs: 5, gapTimeoutMs: 20, idlePollMs: 2, editDelayMs: 5, retryBaseMs: 20, retryMaxMs: 80, ...overrides }
  });
  client.deliver = (method, event) => {
    if (client.hold) { client.held.push([method, event]); return; }
    client.controller[method](clone(event));
  };
  client.release = (order) => {
    const held = client.held;
    client.held = [];
    client.hold = null;
    (order ? order.map((index) => held[index]) : held).filter(Boolean).forEach(([method, event]) => client.controller[method](clone(event)));
  };
  client.history = async (kind, mutate) => {
    client.objects = mutate(clone(client.objects));
    return client.controller.submitHistoryOperation({ kind, legacyBroadcast: () => { client.legacyBroadcasts += 1; } });
  };
  client.edit = (mutate) => {
    client.objects = mutate(clone(client.objects));
  };
  client.commit = (mutate) => {
    client.objects = mutate(clone(client.objects));
    return client.controller.submitLocalChanges();
  };
  const board = server.getBoard();
  client.controller.load(board);
  client.objects = normalize(clone(board.objects));
  client.controller.markLoaded();
  client.save = (options) => client.controller.persist({ version: '7.4.0', objects: clone(client.objects) }, options);
  server.clients.push(client);
  return client;
};

const settle = async (...clients) => {
  await wait(40);
  await Promise.all(clients.map((client) => client.controller.idle()));
};

const patch = (id, changes) => (objects) => objects.map((object) => (object.id === id ? { ...object, ...changes } : object));
const find = (objects, id) => objects.find((object) => object.id === id);
const ids = (objects) => objects.map((object) => object.id);

const cleanupResult = (objects) => {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const text = { ...byId.get('text_a'), left: 640, top: 300 };
  delete text.parentShapeId;
  const shapeA = { ...byId.get('shape_a'), left: 520, top: 260 };
  delete shapeA.attachedTextId;
  const conn = { ...byId.get('conn_ab'), path: [['M', 620, 290], ['L', 400, 40]] };
  return [byId.get('shape_c'), shapeA, conn, byId.get('shape_b'), text];
};

test('buildCanvasOperation sends full snapshots, removed fields, deletions and the full z-order', () => {
  const server = startingBoard();
  const current = cleanupResult(server);
  const op = buildCanvasOperation({ serverObjects: server, canvasObjects: current, baseRevision: 4, kind: 'apply', opId: 'op_fixed_0001' });
  assert.equal(op.baseRevision, 4);
  assert.deepEqual(op.order, ['shape_c', 'shape_a', 'conn_ab', 'shape_b', 'text_a']);
  assert.deepEqual(op.upserts.map((upsert) => [upsert.id, upsert.unset]), [['shape_a', ['attachedTextId']], ['conn_ab', []], ['text_a', ['parentShapeId']]]);
  assert.deepEqual(op.deletes, []);
  assert.equal(buildCanvasOperation({ serverObjects: server, canvasObjects: clone(server).map((object, index) => ({ ...object, stackIndex: index })), baseRevision: 0, kind: 'undo' }), null);
  const deletion = buildCanvasOperation({ serverObjects: server, canvasObjects: server.filter((object) => object.id !== 'shape_b'), baseRevision: 0, kind: 'undo' });
  assert.deepEqual([deletion.upserts.length, deletion.deletes], [0, ['shape_b']]);
});

test('applyCanvasOperation matches the server contract, including z-order mismatch rejection', () => {
  const server = startingBoard();
  const op = buildCanvasOperation({ serverObjects: server, canvasObjects: cleanupResult(server), baseRevision: 0, kind: 'apply', opId: 'op_fixed_0002' });
  const applied = applyCanvasOperation(server, op);
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.objects, cleanupResult(server));
  assert.deepEqual(applyCanvasOperation(server, { upserts: [], deletes: [], order: ['shape_a'] }), { ok: false, code: 'ORDER_MISMATCH' });
});

test('mergeThreeWay keeps untracked local edits and local z-order, takes collaborator changes elsewhere and reports genuine conflicts only', () => {
  const base = startingBoard();
  const localEdited = patch('text_a', { text: 'Edited prompt' })(patch('shape_a', { left: 1 })(base));
  const local = [find(localEdited, 'shape_a'), find(localEdited, 'text_a'), find(localEdited, 'shape_b'), find(localEdited, 'shape_c'), find(localEdited, 'conn_ab'), shape('shape_new')];
  const theirsEdited = patch('shape_b', { top: 99 })(patch('shape_a', { top: 99 })(base)).filter((object) => object.id !== 'shape_c');
  const theirs = [...theirsEdited.slice(0, 3), shape('shape_d', { left: 900 }), theirsEdited[3]];

  const merged = mergeThreeWay({ baseRaw: base, baseLocal: base, theirs, local });
  assert.deepEqual(ids(merged.objects), ['shape_a', 'text_a', 'shape_b', 'shape_d', 'conn_ab', 'shape_new']);
  assert.deepEqual([find(merged.objects, 'shape_a').left, find(merged.objects, 'shape_a').top], [1, 10]);
  assert.equal(find(merged.objects, 'text_a').text, 'Edited prompt');
  assert.equal(find(merged.objects, 'shape_b').top, 99);
  assert.deepEqual(merged.conflicts, ['shape_a']);
  assert.deepEqual(merged.changedIds, ['shape_b', 'shape_d']);
  assert.deepEqual(merged.removedIds, ['shape_c']);
  assert.equal(merged.orderConflict, false);

  const undo = conflictUndoObjects(merged, theirs);
  assert.deepEqual(ids(undo), ids(merged.objects));
  assert.deepEqual([find(undo, 'shape_a').left, find(undo, 'shape_a').top], [10, 99]);
  assert.equal(find(undo, 'text_a').text, 'Edited prompt');
  assert.ok(find(undo, 'shape_new'));
  undo.filter((object) => object.id !== 'shape_a').forEach((object) => assert.equal(object, find(merged.objects, object.id)));

  const converged = mergeThreeWay({ baseRaw: base, baseLocal: base, theirs: patch('shape_a', { left: 1 })(base), local: patch('shape_a', { left: 1 })(base) });
  assert.deepEqual([converged.conflicts, converged.changedIds, converged.orderChanged], [[], [], false]);

  const theirsOrder = [base[4], ...base.slice(0, 4)];
  const followTheirs = mergeThreeWay({ baseRaw: base, baseLocal: base, theirs: theirsOrder, local: patch('text_a', { text: 'x' })(base) });
  assert.deepEqual(ids(followTheirs.objects), ids(theirsOrder));
  assert.equal(followTheirs.orderChanged, true);
  const bothReordered = mergeThreeWay({ baseRaw: base, baseLocal: base, theirs: theirsOrder, local: [...base.slice(1), base[0]] });
  assert.deepEqual(ids(bothReordered.objects), ids([...base.slice(1), base[0]]));
  assert.equal(bothReordered.orderConflict, true);
});

test('Apply, Undo, Redo and Undo stay identical on two clients and the server, once each, with no echo', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  const original = clone(server.objects);
  const applied = cleanupResult(original);

  assert.equal((await a.history('apply', () => applied)).mode, 'operation');
  await settle(a, b);
  assert.deepEqual([a.objects, b.objects, server.objects], [applied, applied, applied]);
  assert.equal(find(b.objects, 'text_a').parentShapeId, undefined);
  assert.deepEqual(find(b.objects, 'conn_ab').path, [['M', 620, 290], ['L', 400, 40]]);

  for (const [kind, state] of [['undo', original], ['redo', applied], ['undo', original]]) {
    assert.equal((await a.history(kind, () => clone(state))).mode, 'operation');
    await settle(a, b);
    assert.deepEqual([a.objects, b.objects, server.objects], [state, state, state], kind);
  }
  assert.deepEqual(server.ops.map((op) => op.from), ['A', 'A', 'A', 'A']);
  assert.equal(server.saves.length, 0);
  assert.equal(server.revision, 4);
  assert.equal(b.merges.length, 4);
  assert.equal(a.merges.length, 0);
  assert.deepEqual(b.controller.getState(), { enabled: true, knownRevision: 4, loaded: true, pendingRevisions: [], hasLocalChanges: false });
  assert.deepEqual(b.conflicts, []);
  assert.equal(find(b.objects, 'shape_c').metadata.nested.keep[1], 2);
});

test('out-of-order, duplicate and missing operations are applied in revision order or resynchronised', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  b.hold = true;
  await a.history('apply', patch('shape_b', { left: 450 }));
  await a.history('apply', patch('shape_b', { left: 500 }));
  b.release([1, 0, 0]);
  await settle(a, b);
  assert.deepEqual(b.objects, server.objects);
  assert.equal(b.controller.getState().knownRevision, 2);

  b.hold = true;
  await a.history('apply', patch('shape_b', { left: 550 }));
  await a.history('apply', (objects) => objects.filter((object) => object.id !== 'shape_c'));
  b.release([1]);
  await settle(a, b);
  assert.deepEqual(b.objects, server.objects);
  assert.equal(b.controller.getState().knownRevision, 4);
});

test('a client that missed events while disconnected resynchronises on reconnect', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  b.connected = false;
  await a.history('apply', (objects) => objects.filter((object) => object.id !== 'conn_ab'));
  await settle(a, b);
  assert.notDeepEqual(b.objects, server.objects);
  b.connected = true;
  await b.controller.reconnect();
  assert.deepEqual(b.objects, server.objects);
  assert.equal(b.controller.getState().knownRevision, 1);
});

test('unsaved edits made during an undo are preserved, and a conflict undo restores only the conflicting object', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  b.edit(patch('shape_b', { top: 333 }));
  b.edit(patch('shape_c', { checklistItems: [{ id: 'c1', checked: true, text: 'Ship' }] }));
  b.busy = true;
  await a.history('undo', patch('shape_a', { left: 77 }));
  await wait(15);
  assert.equal(find(b.objects, 'shape_a').left, 10);
  b.busy = false;
  await settle(a, b);
  assert.equal(find(b.objects, 'shape_a').left, 77);
  assert.equal(find(b.objects, 'shape_b').top, 333);
  assert.equal(find(b.objects, 'shape_c').checklistItems[0].checked, true);
  assert.deepEqual(b.conflicts, []);

  await a.history('undo', patch('shape_b', { top: 5 }));
  await settle(a, b);
  assert.deepEqual(b.conflicts, ['shape_b']);
  assert.equal(find(b.objects, 'shape_b').top, 333);
  assert.deepEqual(ids(b.undoBase), ids(b.objects));
  assert.equal(find(b.undoBase, 'shape_b').top, 5);
  assert.equal(find(b.undoBase, 'shape_c').checklistItems[0].checked, true);
  assert.equal(find(b.undoBase, 'shape_a').left, 77);
  assert.equal((await b.save()).ok, true);
  assert.equal(find(server.objects, 'shape_b').top, 333);
  assert.equal(find(server.objects, 'shape_c').checklistItems[0].checked, true);
  assert.equal(find(server.objects, 'shape_a').left, 77);
});

test('local z-order and prompt edits survive a collaborator operation and reach the server and other clients', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  b.edit((objects) => [...objects.filter((object) => object.id !== 'shape_a'), find(objects, 'shape_a')]);
  b.edit(patch('text_a', { text: 'Prompt edited' }));
  await a.history('apply', patch('shape_c', { left: 720 }));
  await settle(a, b);
  assert.equal(ids(b.objects).at(-1), 'shape_a');
  assert.equal(find(b.objects, 'text_a').text, 'Prompt edited');
  assert.equal(find(b.objects, 'shape_c').left, 720);
  assert.deepEqual(b.conflicts, []);
  assert.equal((await b.save()).ok, true);
  assert.deepEqual(ids(server.objects), ids(b.objects));
  assert.equal(find(server.objects, 'text_a').text, 'Prompt edited');
  await settle(a, b);
  assert.deepEqual(a.objects, server.objects);
  assert.deepEqual(a.conflicts, []);
});

test('a normalised board loads, reloads and pulls without a canvas update, save or conflict, and updates stay incremental', async () => {
  const normalize = (objects) => {
    const shapeA = find(objects, 'shape_a');
    return objects.map((object) => (object.id === 'text_a' && shapeA ? { ...object, left: shapeA.left + 5, top: shapeA.top + 5 } : object));
  };
  const server = createServer();
  const a = createClient('A', server, {}, { normalize });
  assert.notDeepEqual(a.objects, server.objects);
  await a.controller.pull();
  assert.equal(a.merges.length, 0);
  assert.deepEqual(await a.save(), { ok: true, skipped: true });
  const reloaded = createClient('A2', server, {}, { normalize });
  const reloadedAgain = createClient('A3', server, {}, { normalize });
  assert.deepEqual(reloaded.objects, a.objects);
  assert.deepEqual(reloadedAgain.objects, a.objects);
  assert.equal(server.saves.length, 0);

  const b = createClient('B', server, {}, { normalize });
  await b.history('apply', patch('shape_b', { left: 420 }));
  await settle(a, b);
  assert.equal(a.merges.length, 1);
  assert.deepEqual([a.merges[0].changedIds, a.merges[0].removedIds, a.merges[0].orderChanged], [['shape_b'], [], false]);
  assert.equal(find(a.objects, 'shape_b').left, 420);
  assert.equal(find(a.objects, 'text_a').left, 15);
  assert.deepEqual(a.conflicts, []);
  assert.equal(a.controller.getState().hasLocalChanges, false);
});

test('canvas updates wait for text editing or a transform to finish, with no timeout', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server, { idleTimeoutMs: 5 });
  b.busy = true;
  await a.history('apply', patch('shape_b', { left: 999 }));
  await wait(120);
  assert.equal(find(b.objects, 'shape_b').left, 400);
  assert.equal(b.merges.length, 0);
  b.edit(patch('text_a', { text: 'typing' }));
  b.busy = false;
  await settle(a, b);
  assert.equal(find(b.objects, 'shape_b').left, 999);
  assert.equal(find(b.objects, 'text_a').text, 'typing');
  assert.deepEqual(b.conflicts, []);
});

test('a stale board response never replaces newer state', async () => {
  const server = createServer();
  const old = server.getBoard();
  let serveStale = false;
  const a = createClient('A', server);
  const b = createClient('B', server, {}, { getBoard: () => (serveStale ? clone(old) : server.getBoard()) });
  await a.history('apply', patch('shape_b', { left: 640 }));
  await settle(a, b);
  assert.equal(find(b.objects, 'shape_b').left, 640);
  serveStale = true;
  await b.controller.pull();
  await b.controller.reconnect();
  assert.equal(find(b.objects, 'shape_b').left, 640);
  assert.equal(b.merges.length, 1);
  assert.equal(b.controller.getState().knownRevision, 1);
});

test('a stale save gets 409, merges the latest board and saves again without losing either edit', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  b.connected = false;
  a.edit(patch('shape_a', { left: 11 }));
  b.edit(patch('shape_b', { left: 444 }));
  assert.equal((await a.save()).ok, true);
  const bSave = await b.save();
  assert.equal(bSave.ok, true);
  assert.equal(find(server.objects, 'shape_a').left, 11);
  assert.equal(find(server.objects, 'shape_b').left, 444);
  assert.equal(find(b.objects, 'shape_a').left, 11);
  assert.deepEqual(server.saves.map((save) => [save.from, save.baseRevision]), [['A', 0], ['B', 0], ['B', 1]]);
  assert.equal(server.revision, 2);
  assert.equal(b.controller.getState().hasLocalChanges, false);
  assert.deepEqual(b.conflicts, []);
});

test('with the flag off the client stays on the legacy path synchronously, and switches safely once the server enables it', async () => {
  const server = createServer({ enabled: false });
  const a = createClient('A', server);
  const b = createClient('B', server);
  const pending = a.history('apply', (objects) => objects.filter((object) => object.id !== 'shape_c'));
  assert.equal(a.legacyBroadcasts, 1);
  assert.equal((await pending).mode, 'legacy');
  assert.equal((await a.save()).ok, true);
  assert.equal((await b.save()).ok, true);
  assert.deepEqual(server.saves.map((save) => save.baseRevision), [undefined, undefined]);
  assert.equal(server.ops.length, 0);

  server.enabled = true;
  const reloaded = createClient('C', server);
  assert.equal((await reloaded.history('apply', patch('shape_a', { left: 90 }))).mode, 'operation');
  a.edit(patch('shape_b', { top: 90 }));
  assert.equal((await a.save()).ok, true);
  assert.equal(a.controller.getState().enabled, true);
  assert.equal(find(server.objects, 'shape_a').left, 90);
  assert.equal(find(server.objects, 'shape_b').top, 90);
  assert.equal(find(a.objects, 'shape_a').left, 90);
  assert.equal((await a.history('undo', patch('shape_b', { top: 10 }))).mode, 'operation');
});

test('an oversized operation is saved only through a compare-and-set save of the merged board', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  await b.commit(patch('shape_c', { left: 701 }));
  await settle(a, b);
  const big = 'x'.repeat(OPERATION_BYTE_LIMIT);
  a.connected = false;
  const result = await a.history('apply', patch('shape_b', { blob: big }));
  assert.deepEqual([result.mode, result.reason], ['save', 'OPERATION_TOO_LARGE']);
  assert.equal(server.ops.filter((op) => op.from === 'A').length, 0);
  assert.deepEqual(server.saves.map((save) => [save.from, save.baseRevision]), [['A', 1]]);
  assert.equal(find(server.objects, 'shape_b').blob.length, OPERATION_BYTE_LIMIT);
  assert.equal(find(server.objects, 'shape_c').left, 701);
  assert.equal(a.controller.getState().hasLocalChanges, false);
});

test('a save right after an acknowledged operation is skipped instead of writing the same board again', async () => {
  const server = createServer();
  const a = createClient('A', server);
  await a.history('apply', (objects) => objects.filter((object) => object.id !== 'shape_c'));
  const saved = await a.save();
  assert.deepEqual(saved, { ok: true, skipped: true });
  assert.equal(server.saves.length, 0);
  assert.equal(server.revision, 1);
});

test('a final save that meets a 409 merges the latest board once, keeps both edits, and never saves an empty board', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  a.connected = false;
  assert.equal((await b.history('apply', (objects) => objects.filter((object) => object.id !== 'shape_c'))).mode, 'operation');
  a.edit(patch('shape_a', { left: 5 }));
  const result = await a.save({ final: true });
  assert.deepEqual(result, { ok: true, merged: true, conflicts: [] });
  assert.equal(find(server.objects, 'shape_c'), undefined);
  assert.equal(find(server.objects, 'shape_a').left, 5);
  assert.deepEqual(server.saves.map((save) => [save.from, save.baseRevision]), [['A', 0], ['A', 1]]);
  assert.deepEqual(await a.controller.persist({ version: '7.4.0', objects: [] }, { final: true }), { ok: false, skipped: true, code: 'ALREADY_MERGED' });
  assert.equal(a.controller.flushOnUnload(), false);
  assert.equal(server.saves.length, 2);
  assert.ok(server.objects.length > 0);
});

test('a final save bypasses a queue that is waiting for the canvas and still keeps both edits', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  b.busy = true;
  await a.history('apply', patch('shape_c', { left: 760 }));
  await wait(10);
  b.edit(patch('shape_b', { left: 404 }));
  const result = await b.save({ final: true });
  b.controller.dispose();
  assert.equal(result.ok, true);
  assert.equal(find(server.objects, 'shape_c').left, 760);
  assert.equal(find(server.objects, 'shape_b').left, 404);
});

test('a disposed controller ignores events and queued work for its old board', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  b.controller.dispose();
  const untouched = clone(b.objects);
  await a.history('apply', (objects) => objects.filter((object) => object.id !== 'shape_b'));
  await settle(a, b);
  assert.deepEqual(b.objects, untouched);
  assert.deepEqual(await b.save(), { ok: false, code: 'DISPOSED' });
  assert.equal((await b.history('undo', (objects) => objects)).mode, 'legacy');
  assert.equal(server.saves.length, 0);
});

test('a queued save sends the canvas as it is when it runs, not the earlier capture', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  a.edit(patch('shape_a', { left: 33 }));
  const staleCapture = { version: '7.4.0', objects: clone(a.objects) };
  await b.history('apply', patch('shape_b', { left: 777 }));
  await settle(a, b);
  assert.equal((await a.controller.persist(staleCapture)).ok, true);
  assert.equal(find(server.objects, 'shape_b').left, 777);
  assert.equal(find(server.objects, 'shape_a').left, 33);
});

test('an edit made while incoming objects are being prepared is kept, sent and saved', async () => {
  const server = createServer();
  const a = createClient('A', server);
  let b = null;
  b = createClient('B', server, {}, { onPrepare: async () => { b.edit(patch('shape_b', { top: 222 })); await wait(5); } });
  await a.history('apply', patch('shape_c', { left: 705 }));
  await settle(a, b);
  assert.equal(find(b.objects, 'shape_c').left, 705);
  assert.equal(find(b.objects, 'shape_b').top, 222);
  assert.equal(b.controller.getState().hasLocalChanges, true);
  assert.equal((await b.save()).ok, true);
  assert.equal(find(server.objects, 'shape_b').top, 222);
  assert.equal(find(server.objects, 'shape_c').left, 705);
});

test('a conflict where the local side deleted an object can be restored by Undo at its original position', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  b.edit((objects) => objects.filter((object) => object.id !== 'shape_b'));
  await a.history('apply', patch('shape_b', { left: 455 }));
  await settle(a, b);
  assert.deepEqual(b.conflicts, ['shape_b']);
  assert.equal(find(b.objects, 'shape_b'), undefined);
  assert.equal(find(b.undoBase, 'shape_b').left, 455);
  assert.deepEqual(ids(b.undoBase), ids(server.objects));
});

test('operations from a board whose ids were normalised on load still apply atomically on the server', async () => {
  const stored = [...startingBoard(), { type: 'Path', id: 'shape_line_1', elementId: 'line_1', isStraightLine: true, path: [['M', 0, 0], ['L', 50, 0]] }];
  const normalize = (objects) => objects.map((object) => (object.id === 'shape_line_1' ? { ...object, id: 'line_1' } : object));
  const server = createServer({ objects: stored });
  const a = createClient('A', server, {}, { normalize });
  const b = createClient('B', server, {}, { normalize });
  const result = await a.history('apply', patch('shape_a', { left: 50 }));
  assert.equal(result.mode, 'operation');
  await settle(a, b);
  assert.deepEqual(server.objects, a.objects);
  assert.deepEqual(b.objects, a.objects);
  assert.ok(find(server.objects, 'line_1'));
  assert.equal(find(server.objects, 'shape_line_1'), undefined);
  assert.equal(server.saves.length, 0);
});

test('a collaborator edit already shown through a legacy relay is not reported as a conflict', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  a.edit(patch('shape_b', { left: 480, width: 101 }));
  b.edit(patch('shape_b', { left: 480 }));
  b.controller.acceptRemoteObjects(['shape_b']);
  assert.equal(b.controller.getState().hasLocalChanges, false);
  assert.equal((await a.save()).ok, true);
  await settle(a, b);
  assert.deepEqual(b.conflicts, []);
  assert.deepEqual(find(b.objects, 'shape_b'), find(server.objects, 'shape_b'));
  assert.equal(b.controller.getState().hasLocalChanges, false);
});

test('a failed board fetch or canvas preparation during resync is retried instead of losing the revision', async () => {
  const server = createServer();
  const a = createClient('A', server);
  let fetchFailures = 1;
  let prepareFailures = 1;
  const b = createClient('B', server, {}, {
    getBoard: () => {
      if (fetchFailures > 0) { fetchFailures -= 1; throw new Error('network'); }
      return server.getBoard();
    },
    onPrepare: async () => {
      if (prepareFailures > 0) { prepareFailures -= 1; throw new Error('enliven'); }
    }
  });
  await a.history('apply', patch('shape_b', { left: 451 }));
  await settle(a, b);
  b.hold = true;
  await a.history('apply', patch('shape_b', { left: 452 }));
  await a.history('apply', patch('shape_b', { left: 453 }));
  b.release([1]);
  await wait(150);
  await settle(a, b);
  assert.deepEqual(b.objects, server.objects);
  assert.equal(b.controller.getState().knownRevision, 3);
  assert.deepEqual(b.controller.getState().pendingRevisions, []);
  assert.equal(fetchFailures + prepareFailures, 0);
});

test('one logical edit becomes one operation that every client applies once, with no save and no echo', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  const results = await Promise.all([
    a.commit(patch('shape_a', { left: 300 })),
    a.commit(patch('text_a', { left: 305, text: 'Moved label' })),
    a.commit(patch('shape_c', { checklistItems: [{ id: 'c1', checked: true, text: 'Ship' }], metadata: { isStickyNote: true, nested: { keep: [1, 2, 3] } } }))
  ]);
  await settle(a, b);
  assert.deepEqual(results.map((result) => result.mode), ['operation', 'operation', 'operation']);
  assert.equal(server.ops.length, 1);
  assert.equal(server.saves.length, 0);
  assert.equal(server.revision, 1);
  assert.deepEqual([a.objects, b.objects], [server.objects, server.objects]);
  assert.deepEqual(find(b.objects, 'shape_c').metadata.nested.keep, [1, 2, 3]);
  assert.equal(b.merges.length, 1);
  assert.equal(a.merges.length, 0);
});

test('operations carry the z-order only when it changed', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  const sent = [];
  const original = server.operation;
  server.operation = (from, payload) => { sent.push(payload); return original(from, payload); };
  await a.commit(patch('shape_b', { left: 410 }));
  await a.commit((objects) => [...objects.filter((object) => object.id !== 'shape_a'), find(objects, 'shape_a')]);
  await a.commit((objects) => [...objects, shape('shape_new', { left: 900 })]);
  await settle(a, b);
  assert.deepEqual(sent.map((payload) => Array.isArray(payload.order)), [false, true, false]);
  assert.deepEqual(ids(b.objects), ids(server.objects));
  assert.equal(ids(server.objects).at(-1), 'shape_new');
  assert.equal(ids(server.objects).at(-2), 'shape_a');
});

test('rapid successive edits, additions and deletions from two clients all persist in revision order', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  for (let step = 1; step <= 5; step += 1) {
    a.commit(patch('shape_a', { left: 10 + step }));
    b.commit(patch('shape_b', { top: 10 + step }));
    await wait(3);
  }
  await b.commit((objects) => objects.filter((object) => object.id !== 'conn_ab'));
  await a.commit((objects) => [...objects, shape('shape_added', { left: 1200 })]);
  await wait(120);
  await settle(a, b);
  assert.equal(find(server.objects, 'shape_a').left, 15);
  assert.equal(find(server.objects, 'shape_b').top, 15);
  assert.equal(find(server.objects, 'conn_ab'), undefined);
  assert.ok(find(server.objects, 'shape_added'));
  assert.deepEqual(a.objects, server.objects);
  assert.deepEqual(b.objects, server.objects);
  assert.equal(server.saves.length, 0);
  assert.equal(new Set(server.ops.map((op) => op.opId)).size, server.ops.length);
  assert.deepEqual([a.conflicts, b.conflicts], [[], []]);
});

test('edits made while text is being edited are sent once, after editing ends', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  a.busy = true;
  const pending = [a.commit(patch('text_a', { text: 'H' })), a.commit(patch('text_a', { text: 'He' })), a.commit(patch('text_a', { text: 'Hello' }))];
  await wait(60);
  assert.equal(server.ops.length, 0);
  a.busy = false;
  await Promise.all(pending);
  await settle(a, b);
  assert.equal(server.ops.length, 1);
  assert.equal(find(b.objects, 'text_a').text, 'Hello');
});

test('a disconnected or unroutable client keeps its edits, rejoins and retries without any full-board save', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  a.connected = false;
  const first = await a.commit(patch('shape_a', { left: 222 }));
  assert.deepEqual([first.mode, first.code], ['pending', 'DISCONNECTED']);
  assert.equal(find(a.objects, 'shape_a').left, 222);
  a.connected = true;
  a.failOps.push('NOT_IN_ROOM');
  await wait(150);
  await settle(a, b);
  assert.equal(a.rejoins, 1);
  assert.equal(find(server.objects, 'shape_a').left, 222);
  assert.equal(find(b.objects, 'shape_a').left, 222);
  assert.equal(server.saves.length, 0);
  assert.deepEqual(a.syncErrors, ['DISCONNECTED', 'NOT_IN_ROOM']);
  assert.equal(a.controller.getState().hasLocalChanges, false);
});

test('an operation the server cannot apply is saved through a compare-and-set save, never an unconditional one', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  await b.commit(patch('shape_c', { left: 702 }));
  await settle(a, b);
  a.failOps.push('INVALID_OPERATION');
  const result = await a.commit(patch('shape_a', { left: 333 }));
  assert.deepEqual([result.mode, result.reason], ['save', 'INVALID_OPERATION']);
  assert.deepEqual(server.saves.map((save) => [save.from, save.baseRevision]), [['A', 1]]);
  assert.equal(find(server.objects, 'shape_a').left, 333);
  assert.equal(find(server.objects, 'shape_c').left, 702);
  assert.equal(a.controller.getState().hasLocalChanges, false);
});

test('a forbidden operation is reported without retrying or saving, and local edits stay', async () => {
  const server = createServer();
  const a = createClient('A', server);
  a.failOps.push('FORBIDDEN');
  const result = await a.commit(patch('shape_a', { left: 334 }));
  assert.deepEqual([result.mode, result.code], ['error', 'FORBIDDEN']);
  await wait(80);
  assert.deepEqual([server.saves.length, server.ops.length], [0, 0]);
  assert.equal(a.controller.getState().hasLocalChanges, true);
});

test('an edit touching more objects than one operation allows uses a compare-and-set save', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const many = Array.from({ length: 1001 }, (_, index) => shape(`shape_bulk_${index}`, { left: index }));
  const result = await a.commit((objects) => [...objects, ...many]);
  assert.deepEqual([result.mode, result.reason], ['save', 'OPERATION_TOO_LARGE']);
  assert.equal(server.ops.length, 0);
  assert.deepEqual(server.saves.map((save) => save.baseRevision), [0]);
  assert.equal(server.objects.length, startingBoard().length + 1001);
});

test('a background retry that succeeds reports the board as synced, and retries stop after the cap', async () => {
  const server = createServer();
  const a = createClient('A', server, { maxRetries: 2 });
  a.failOps.push('SERVER_ERROR');
  const first = await a.commit(patch('shape_a', { left: 444 }));
  assert.deepEqual([first.mode, first.code], ['pending', 'SERVER_ERROR']);
  await wait(80);
  await a.controller.idle();
  assert.equal(find(server.objects, 'shape_a').left, 444);
  assert.equal(a.synced, 1);
  a.failOps.push('RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMITED');
  await a.commit(patch('shape_a', { left: 445 }));
  await wait(200);
  await a.controller.idle();
  assert.equal(a.syncErrors.at(-1), 'SYNC_STALLED');
  assert.equal(find(server.objects, 'shape_a').left, 444);
  assert.equal(a.controller.getState().hasLocalChanges, true);
  assert.equal((await a.commit((objects) => objects)).mode, 'operation');
  assert.equal(find(server.objects, 'shape_a').left, 445);
});

test('a local edit made after a collaborator preview is still sent as the local user\'s change', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  b.edit(patch('shape_b', { left: 520 }));
  b.controller.notePreview(['shape_b']);
  await b.commit(patch('shape_b', { fill: '#ff0000' }));
  assert.equal(find(server.objects, 'shape_b').fill, '#ff0000');
  await settle(a, b);
  assert.equal(find(a.objects, 'shape_b').fill, '#ff0000');
});

test('a collaborator drag preview never conflicts with the final edit and is reset if no edit follows', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  b.edit(patch('shape_b', { left: 520 }));
  b.controller.notePreview(['shape_b']);
  await b.commit(patch('shape_c', { top: 77 }));
  assert.equal(server.ops.filter((op) => op.from === 'B').length, 1);
  assert.equal(find(server.objects, 'shape_b').left, 400);
  await a.commit(patch('shape_b', { left: 530 }));
  await settle(a, b);
  assert.equal(find(b.objects, 'shape_b').left, 530);
  assert.deepEqual(b.conflicts, []);

  b.edit(patch('shape_a', { left: 640 }));
  b.controller.notePreview(['shape_a']);
  await a.commit(patch('shape_c', { left: 711 }));
  await settle(a, b);
  assert.equal(find(b.objects, 'shape_a').left, 10);
  assert.deepEqual(b.objects, server.objects);
  assert.deepEqual(b.conflicts, []);
});

test('undo after ordinary edits is sent as a sequenced operation and reaches the other client', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  const before = clone(a.objects);
  await a.commit(patch('shape_a', { left: 260 }));
  await a.commit((objects) => objects.filter((object) => object.id !== 'shape_c'));
  assert.equal((await a.history('undo', () => clone(before))).mode, 'operation');
  await settle(a, b);
  assert.deepEqual([a.objects, b.objects, server.objects], [before, before, before]);
  assert.deepEqual(server.ops.map((op) => op.from), ['A', 'A', 'A']);
});

test('the final flush on leave sends pending edits as an operation', async () => {
  const server = createServer();
  const a = createClient('A', server);
  a.edit(patch('shape_a', { left: 91 }));
  const result = await a.save({ final: true });
  assert.deepEqual(result, { ok: true, operation: true });
  assert.equal(server.saves.length, 0);
  assert.equal(find(server.objects, 'shape_a').left, 91);
});

test('a stale operation is rebuilt after merging the collaborator edit, keeping both', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  b.hold = true;
  await a.commit(patch('shape_a', { left: 55 }));
  const result = await b.commit(patch('shape_b', { left: 455 }));
  assert.equal(result.mode, 'operation');
  b.release();
  await settle(a, b);
  assert.equal(find(server.objects, 'shape_a').left, 55);
  assert.equal(find(server.objects, 'shape_b').left, 455);
  assert.deepEqual([a.objects, b.objects], [server.objects, server.objects]);
  assert.deepEqual(b.conflicts, []);
});

const richBoard = () => [
  ...startingBoard(),
  { type: 'Path', id: 'stroke_1', strokeId: 'stroke_1', elementId: 'stroke_1', isVectorStroke: true, path: [['M', 5, 5], ['L', 60, 40]], metadata: { tool: 'pen', nested: { width: 3 } } },
  shape('shape_meta', { metadata: { tags: ['keep'], nested: { deep: { value: 7 } } }, checklistItems: [{ id: 'c1', checked: true, text: 'Done' }] })
];

const passiveSetup = async () => {
  const server = createServer({ objects: richBoard() });
  const a = createClient('A', server);
  const b = createClient('B', server);
  const staleAtLoad = { version: '7.4.0', objects: [] };
  await a.commit(patch('shape_a', { left: 140 }));
  await a.commit((objects) => [...objects, connector('conn_new', 'shape_b', 'shape_meta', [['M', 400, 40], ['L', 600, 40]]), { type: 'Path', id: 'stroke_2', strokeId: 'stroke_2', elementId: 'stroke_2', isVectorStroke: true, path: [['M', 1, 1], ['L', 9, 9]] }]);
  await a.commit(patch('shape_meta', { metadata: { tags: ['keep', 'remote'], nested: { deep: { value: 8 } } } }));
  await settle(a, b);
  return { server, a, b, staleAtLoad };
};

test('a passive viewer that only received remote edits never sends a deletion when it reloads', async () => {
  const { server, a, b, staleAtLoad } = await passiveSetup();
  const before = clone(server.objects);
  const opsBefore = server.ops.length;
  assert.deepEqual(b.objects, before);
  assert.equal(b.controller.flushOnUnload(staleAtLoad), false);
  assert.equal(b.sent || 0, 0);
  await wait(20);
  assert.equal(server.objects.length, before.length);
  assert.deepEqual(server.objects, before);
  assert.equal(server.ops.length, opsBefore);
  assert.deepEqual(ids(server.objects), ['shape_a', 'text_a', 'shape_b', 'conn_ab', 'shape_c', 'stroke_1', 'shape_meta', 'conn_new', 'stroke_2']);
  assert.deepEqual(find(server.objects, 'shape_meta').metadata, { tags: ['keep', 'remote'], nested: { deep: { value: 8 } } });
  assert.equal(find(server.objects, 'stroke_1').metadata.nested.width, 3);
  assert.equal(find(server.objects, 'conn_new').targetShapeId, 'shape_meta');
  assert.equal(a.controller.getState().knownRevision, server.revision);
});

test('a passive viewer leaving the board saves nothing and keeps every remote change', async () => {
  const { server, b, staleAtLoad } = await passiveSetup();
  const before = clone(server.objects);
  const revision = server.revision;
  assert.deepEqual(await b.controller.persist(staleAtLoad, { final: true }), { ok: true, skipped: true });
  b.controller.dispose();
  assert.deepEqual(server.objects, before);
  assert.equal(server.revision, revision);
  assert.equal(server.saves.length, 0);
});

test('an unavailable or disposed canvas skips the final save instead of using an old snapshot', async () => {
  const { server, b, staleAtLoad } = await passiveSetup();
  const before = clone(server.objects);
  b.edit(patch('shape_b', { left: 999 }));
  b.detached = true;
  assert.deepEqual(await b.controller.persist(staleAtLoad, { final: true }), { ok: false, skipped: true, code: 'NO_CANVAS' });
  assert.equal(b.controller.flushOnUnload(staleAtLoad), false);
  b.detached = false;
  b.controller.dispose();
  assert.deepEqual(await b.controller.persist(staleAtLoad, { final: true }), { ok: false, skipped: true, code: 'NO_CANVAS' });
  assert.equal(b.controller.flushOnUnload(), false);
  assert.deepEqual(server.objects, before);
  assert.equal(server.saves.length, 0);
});

test('a local edit made just before navigation is sent from the live canvas with every remote change kept', async () => {
  const { server, b, staleAtLoad } = await passiveSetup();
  const pending = b.commit(patch('shape_c', { left: 777 }));
  const result = await b.controller.persist(staleAtLoad, { final: true });
  assert.deepEqual(result, { ok: true, operation: true });
  b.controller.dispose();
  await pending;
  assert.equal(find(server.objects, 'shape_c').left, 777);
  assert.equal(server.objects.length, richBoard().length + 2);
  assert.equal(find(server.objects, 'shape_a').left, 140);
  assert.equal(server.saves.length, 0);
  assert.equal(server.ops.filter((op) => op.from === 'B').length, 1);
});

test('an unload flush sends only the live local edit, and a stale navigation save merges instead of overwriting', async () => {
  const { server, a, b } = await passiveSetup();
  b.edit(patch('shape_b', { top: 61 }));
  assert.equal(b.controller.flushOnUnload({ version: '7.4.0', objects: [] }), true);
  await wait(10);
  assert.equal(find(server.objects, 'shape_b').top, 61);
  assert.equal(server.objects.length, richBoard().length + 2);

  const c = createClient('C', server);
  c.hold = true;
  await a.commit(patch('shape_meta', { left: 321 }));
  c.edit(patch('shape_c', { top: 42 }));
  const result = await c.controller.persist(null, { final: true });
  assert.equal(result.ok, true);
  assert.equal(find(server.objects, 'shape_meta').left, 321);
  assert.equal(find(server.objects, 'shape_c').top, 42);
  assert.equal(server.objects.length, richBoard().length + 2);
});

test('a collaborator drag preview alone never makes a leaving viewer save anything', async () => {
  const { server, b } = await passiveSetup();
  const before = clone(server.objects);
  b.edit(patch('shape_b', { left: 612, top: 77 }));
  b.controller.notePreview(['shape_b']);
  assert.deepEqual(await b.controller.persist(null, { final: true }), { ok: true, skipped: true });
  assert.equal(b.controller.flushOnUnload(), false);
  assert.deepEqual(server.objects, before);
  assert.equal(server.saves.length, 0);
});

test('an unload while offline or too large falls back to a revision-checked save of the live canvas only', async () => {
  const { server, a, b } = await passiveSetup();
  b.connected = false;
  b.edit(patch('shape_c', { top: 88 }));
  assert.equal(b.controller.flushOnUnload(), true);
  assert.equal(b.unloadSaves, 1);
  assert.deepEqual(server.saves.at(-1), { from: 'B', baseRevision: server.revision - 1 });
  assert.equal(find(server.objects, 'shape_c').top, 88);
  assert.equal(server.objects.length, richBoard().length + 2);

  const c = createClient('C', server);
  c.hold = true;
  await a.commit(patch('shape_a', { left: 141 }));
  c.connected = false;
  c.edit(patch('shape_b', { top: 99 }));
  const revision = server.revision;
  assert.equal(c.controller.flushOnUnload(), true);
  assert.equal(server.revision, revision);
  assert.equal(find(server.objects, 'shape_a').left, 141);
  assert.equal(server.objects.length, richBoard().length + 2);
});

const journalStore = () => ({ records: {} });
const pendingEntries = (store) => Object.values(store.records).flatMap((record) => record.entries || []);

test('acknowledged operations leave nothing in the pending journal, and a refused edit stays kept as a draft', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  const b = createClient('B', server);
  await a.commit(patch('shape_a', { left: 31 }));
  assert.deepEqual(pendingEntries(store), []);
  a.hold = true;
  await b.commit(patch('shape_b', { left: 32 }));
  const stale = await a.commit(patch('shape_c', { left: 33 }));
  assert.equal(stale.mode, 'operation');
  assert.equal(find(server.objects, 'shape_c').left, 33);
  assert.deepEqual(pendingEntries(store), []);
  a.release();
  a.failOps.push('FORBIDDEN');
  await a.commit(patch('shape_a', { left: 34 }));
  assert.equal(pendingEntries(store).length, 1);
  assert.equal(pendingEntries(store)[0].op.upserts[0].data.left, 34);
  a.controller.dispose();
});

test('an operation committed but not acknowledged before the tab closed is never applied twice after reload', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.failOps.push('COMMIT_THEN_TIMEOUT');
  const result = await a.commit(patch('shape_a', { left: 41 }));
  assert.deepEqual([result.mode, result.code], ['pending', 'ACK_TIMEOUT']);
  assert.equal(pendingEntries(store).length, 1);
  a.controller.dispose();
  const revision = server.revision;
  const reloaded = createClient('A2', server, {}, { journalStore: store, instanceId: 'inst_a2' });
  assert.deepEqual(await reloaded.controller.recoverPending(), { recovered: 0, conflicts: 0, kept: 0 });
  assert.equal(server.revision, revision);
  assert.equal(find(server.objects, 'shape_a').left, 41);
  assert.deepEqual(pendingEntries(store), []);
  reloaded.controller.dispose();
});

test('an operation in flight when the tab closes is recovered, and the edit made after it is held back and replayed in order', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  const b = createClient('B', server);
  a.stall = true;
  a.commit(patch('shape_a', { left: 51 }));
  await wait(30);
  assert.equal(a.stalled.length, 1);
  a.edit(patch('shape_a', { top: 52 }));
  a.edit(patch('shape_b', { left: 53 }));
  const sentBefore = a.sent || 0;
  assert.equal(a.controller.flushOnUnload(), true);
  assert.equal(a.sent || 0, sentBefore);
  const entries = pendingEntries(store);
  assert.equal(entries.length, 2);
  assert.deepEqual([entries[1].op.baseRevision, entries[1].after], [1, entries[0].op.opId]);
  a.controller.dispose();
  assert.equal(server.revision, 0);

  const reloaded = createClient('A2', server, {}, { journalStore: store, instanceId: 'inst_a2' });
  const recovery = await reloaded.controller.recoverPending();
  await settle(reloaded, b);
  assert.deepEqual(recovery, { recovered: 2, conflicts: 0, kept: 0 });
  assert.equal(find(server.objects, 'shape_a').left, 51);
  assert.equal(find(server.objects, 'shape_a').top, 52);
  assert.equal(find(server.objects, 'shape_b').left, 53);
  assert.equal(server.revision, 2);
  assert.deepEqual(reloaded.objects, server.objects);
  assert.deepEqual(b.objects, server.objects);
  assert.deepEqual(pendingEntries(store), []);
  reloaded.controller.dispose();
});

test('when the in-flight operation does commit, the held-back edit is replayed exactly once', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.stall = true;
  a.commit(patch('shape_a', { left: 61 }));
  await wait(30);
  a.edit(patch('shape_c', { left: 62 }));
  a.controller.flushOnUnload();
  const [inFlight] = a.stalled;
  server.operation(a, inFlight.payload);
  a.controller.dispose();
  assert.equal(server.revision, 1);
  const reloaded = createClient('A2', server, {}, { journalStore: store, instanceId: 'inst_a2' });
  assert.deepEqual(await reloaded.controller.recoverPending(), { recovered: 1, conflicts: 0, kept: 0 });
  assert.equal(find(server.objects, 'shape_a').left, 61);
  assert.equal(find(server.objects, 'shape_c').left, 62);
  assert.equal(server.revision, 2);
  const again = createClient('A3', server, {}, { journalStore: store, instanceId: 'inst_a3' });
  assert.deepEqual(await again.controller.recoverPending(), { recovered: 0, conflicts: 0, kept: 0 });
  assert.equal(server.revision, 2);
  reloaded.controller.dispose();
  again.controller.dispose();
});

test('a held-back edit is not applied blindly when a collaborator took the predicted revision', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  const b = createClient('B', server);
  a.stall = true;
  a.commit(patch('shape_a', { left: 63 }));
  await wait(30);
  a.edit(patch('shape_b', { left: 64 }));
  a.controller.flushOnUnload();
  a.controller.dispose();
  await b.commit(patch('shape_b', { left: 465, top: 9 }));
  assert.equal(server.revision, 1);
  const reloaded = createClient('A2', server, {}, { journalStore: store, instanceId: 'inst_a2' });
  const recovery = await reloaded.controller.recoverPending();
  assert.equal(find(server.objects, 'shape_a').left, 63);
  assert.deepEqual([find(server.objects, 'shape_b').left, find(server.objects, 'shape_b').top], [465, 9]);
  assert.equal(recovery.conflicts, 1);
  assert.deepEqual(pendingEntries(store), []);
  reloaded.controller.dispose();
});

test('a recovered operation that went stale applies only objects nobody else changed and reports the rest', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  const b = createClient('B', server);
  a.stall = true;
  a.commit((objects) => patch('shape_b', { left: 71 })(patch('shape_a', { left: 72 })(objects)));
  await wait(30);
  a.controller.dispose();
  await b.commit(patch('shape_b', { left: 499 }));
  const reloaded = createClient('A2', server, {}, { journalStore: store, instanceId: 'inst_a2' });
  const recovery = await reloaded.controller.recoverPending();
  assert.deepEqual(recovery, { recovered: 1, conflicts: 1, kept: 0 });
  assert.equal(find(server.objects, 'shape_a').left, 72);
  assert.equal(find(server.objects, 'shape_b').left, 499);
  assert.deepEqual(reloaded.recoveries, [{ recovered: 1, conflicts: 1, kept: 0, held: 1 }]);
  assert.deepEqual(pendingEntries(store), []);
  assert.deepEqual(Object.values(store.records).flatMap((record) => record.held).map((item) => [item.id, item.mine.left]), [['shape_b', 71]]);
  reloaded.controller.dispose();
});

test('a recovered change that already reached the board another way is not applied again', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  const b = createClient('B', server);
  a.stall = true;
  a.commit(patch('shape_a', { left: 81 }));
  await wait(30);
  a.controller.dispose();
  await b.commit(patch('shape_a', { left: 81 }));
  const opsBefore = server.ops.length;
  const reloaded = createClient('A2', server, {}, { journalStore: store, instanceId: 'inst_a2' });
  assert.deepEqual(await reloaded.controller.recoverPending(), { recovered: 0, conflicts: 0, kept: 0 });
  assert.equal(server.ops.length, opsBefore + 1);
  assert.equal(server.revision, 1);
  assert.deepEqual(pendingEntries(store), []);
  reloaded.controller.dispose();
});

test('pending operations of another open tab are left alone until that tab stops beating', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, { foreignJournalAgeMs: 200 }, { journalStore: store, instanceId: 'inst_a' });
  a.stall = true;
  a.commit(patch('shape_a', { left: 91 }));
  await wait(30);
  const other = createClient('B', server, { foreignJournalAgeMs: 200 }, { journalStore: store, instanceId: 'inst_b' });
  assert.deepEqual(await other.controller.recoverPending(), { recovered: 0, conflicts: 0, kept: 0 });
  assert.equal(pendingEntries(store).length, 1);
  assert.equal(server.revision, 0);
  other.controller.dispose();
  store.records.inst_a.beat = Date.now() - 1000;
  const later = createClient('C', server, { foreignJournalAgeMs: 200 }, { journalStore: store, instanceId: 'inst_c' });
  assert.equal((await later.controller.recoverPending()).recovered, 1);
  assert.equal(find(server.objects, 'shape_a').left, 91);
  later.controller.dispose();
  a.controller.dispose();
});

test('leaving through the app waits for the in-flight operation and pending edits before the final save', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, { editDelayMs: 500 }, { journalStore: store, instanceId: 'inst_a' });
  a.commit(patch('shape_a', { left: 101 }));
  assert.equal(a.controller.hasUnsavedWork(), true);
  await a.controller.drain();
  assert.equal(a.controller.hasUnsavedWork(), false);
  assert.equal(find(server.objects, 'shape_a').left, 101);
  assert.deepEqual(await a.controller.persist(null, { final: true }), { ok: true, skipped: true });
  assert.deepEqual(pendingEntries(store), []);
  assert.equal(a.controller.canRecover(), true);
  const noJournal = createClient('N', server);
  assert.equal(noJournal.controller.canRecover(), false);
  a.controller.dispose();
});

test('a final save made while an operation is in flight waits for it and sends only the newer edit', async () => {
  const server = createServer();
  const a = createClient('A', server);
  a.stall = true;
  a.commit(patch('shape_a', { left: 111 }));
  await wait(30);
  a.edit(patch('shape_c', { left: 112 }));
  const final = a.controller.persist(null, { final: true });
  const [inFlight] = a.stalled;
  a.stall = false;
  inFlight.resolve(server.operation(a, inFlight.payload));
  assert.deepEqual(await final, { ok: true, operation: true });
  assert.equal(find(server.objects, 'shape_a').left, 111);
  assert.equal(find(server.objects, 'shape_c').left, 112);
  assert.equal(server.revision, 2);
  assert.equal(server.saves.length, 0);
});

test('a failed final save keeps the change journaled and the next visit restores it', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.edit(patch('shape_c', { top: 121 }));
  a.connected = false;
  a.saveFails = true;
  const result = await a.controller.persist(null, { final: true });
  assert.equal(result.ok, false);
  assert.equal(pendingEntries(store).length, 1);
  a.controller.dispose();
  const reloaded = createClient('A2', server, {}, { journalStore: store, instanceId: 'inst_a2' });
  assert.equal((await reloaded.controller.recoverPending()).recovered, 1);
  assert.equal(find(server.objects, 'shape_c').top, 121);
  assert.deepEqual(pendingEntries(store), []);
  reloaded.controller.dispose();
});

test('a journal that cannot be written turns the leave warning back on and keeps unsaved work visible', async () => {
  const server = createServer();
  const store = journalStore();
  store.failWrites = true;
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.stall = true;
  a.commit(patch('shape_a', { left: 131 }));
  await wait(30);
  assert.equal(a.controller.canRecover(), false);
  assert.equal(a.controller.hasUnsavedWork(), true);
  a.controller.dispose();
});

test('recovery that meets a disconnected socket keeps every entry for later instead of dropping it', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.stall = true;
  a.commit(patch('shape_a', { left: 141 }));
  await wait(30);
  a.controller.dispose();
  const reloaded = createClient('A2', server, {}, { journalStore: store, instanceId: 'inst_a2' });
  reloaded.connected = false;
  assert.deepEqual(await reloaded.controller.recoverPending(), { recovered: 0, conflicts: 0, kept: 1 });
  assert.equal(pendingEntries(store).length, 1);
  reloaded.connected = true;
  assert.equal((await reloaded.controller.recoverPending()).recovered, 1);
  assert.equal(find(server.objects, 'shape_a').left, 141);
  reloaded.controller.dispose();
});

const legacyClient = (name, serverBoard, baseObjects) => {
  const client = createClient(name, createServer(), {}, { getBoard: () => serverBoard() });
  client.objects = clone(baseObjects);
  client.controller.load({ revision: 1, objects: clone(baseObjects), enabled: false });
  client.controller.markLoaded();
  return client;
};

test('legacy: reconnecting merges edits missed while offline without losing local work', async () => {
  const base = [{ id: 'base', left: 1 }];
  const theirs = [...base, { id: 'theirs', left: 2 }];
  const b = legacyClient('B', () => ({ revision: 2, objects: clone(theirs) }), base);
  b.objects.push({ id: 'mine', left: 3 });
  await b.controller.reconnect();
  assert.deepEqual(b.objects.map((object) => object.id).sort(), ['base', 'mine', 'theirs']);
  assert.equal(b.saveRequests, 1);
});

test('legacy: a save made while the socket is down merges first, so it cannot erase newer work', async () => {
  const base = [{ id: 'base', left: 1 }];
  const theirs = [...base, { id: 'theirs', left: 2 }];
  const saved = [];
  const b = legacyClient('B', () => ({ revision: 2, objects: clone(theirs) }), base);
  b.server.saveBoard = (client, body) => { saved.push(body.canvasData.objects.map((object) => object.id)); return { ok: true, revision: 3 }; };
  b.connected = false;
  b.objects.push({ id: 'mine', left: 3 });
  const result = await b.controller.persist({ objects: clone(b.objects) });
  assert.equal(result.ok, true);
  assert.deepEqual(saved[0].sort(), ['base', 'mine', 'theirs']);
});

test('legacy: another session saving triggers a merge instead of leaving this session stale', async () => {
  const base = [{ id: 'base', left: 1 }];
  const theirs = [...base, { id: 'theirs', left: 2 }];
  const b = legacyClient('B', () => ({ revision: 2, objects: clone(theirs) }), base);
  b.controller.receiveRevision({ revision: 2 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(b.objects.map((object) => object.id).sort(), ['base', 'theirs']);
});

test('legacy: a board joined before loading finishes resynchronises once it has loaded', async () => {
  const base = [{ id: 'base', left: 1 }];
  const theirs = [...base, { id: 'theirs', left: 2 }];
  const client = createClient('B', createServer(), {}, { getBoard: () => ({ revision: 2, objects: clone(theirs) }) });
  client.objects = clone(base);
  client.controller.load({ revision: 1, objects: clone(base), enabled: false });
  await client.controller.reconnect();
  assert.deepEqual(client.objects.map((object) => object.id), ['base']);
  client.controller.markLoaded();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(client.objects.map((object) => object.id).sort(), ['base', 'theirs']);
});

test('legacy: a stale save is refused, merged with the newer board and retried without losing either side', async () => {
  const base = [{ id: 'base', left: 1 }];
  const board = { revision: 2, objects: [...clone(base), { id: 'theirs', left: 2 }] };
  const bodies = [];
  const b = legacyClient('B', () => ({ revision: board.revision, objects: clone(board.objects) }), base);
  b.server.saveBoard = (client, body) => {
    bodies.push(body.ifRevision);
    if (body.ifRevision !== board.revision) return { ok: false, code: 'CANVAS_CHANGED', currentRevision: board.revision };
    board.objects = clone(body.canvasData.objects);
    board.revision += 1;
    return { ok: true, revision: board.revision };
  };
  b.objects.push({ id: 'mine', left: 3 });
  const result = await b.controller.persist({ objects: clone(b.objects) });
  assert.equal(result.ok, true);
  assert.deepEqual(bodies, [1, 2]);
  assert.deepEqual(board.objects.map((object) => object.id).sort(), ['base', 'mine', 'theirs']);
  assert.deepEqual(b.objects.map((object) => object.id).sort(), ['base', 'mine', 'theirs']);
});

const legacyWithJournal = (records, getBoard, base, instanceId) => {
  const client = createClient('B', createServer(), {}, { getBoard, journalStore: records, instanceId });
  client.objects = clone(base);
  client.controller.load({ revision: 1, objects: clone(base), enabled: false });
  client.controller.markLoaded();
  return client;
};

test('legacy: the final save after leaving merges a conflict from its captured snapshot', async () => {
  const base = [{ id: 'base', left: 1 }];
  const board = { revision: 2, objects: [...clone(base), { id: 'theirs', left: 2 }] };
  const b = legacyClient('B', () => ({ revision: board.revision, objects: clone(board.objects) }), base);
  b.server.saveBoard = (client, body) => {
    if (body.ifRevision !== board.revision) return { ok: false, code: 'CANVAS_CHANGED' };
    board.objects = clone(body.canvasData.objects);
    board.revision += 1;
    return { ok: true, revision: board.revision };
  };
  const live = { version: '7', objects: [...clone(base), { id: 'mine', left: 3 }] };
  b.objects = [];
  b.detached = true;
  const result = await b.controller.persist(live, { final: true });
  assert.equal(result.ok, true);
  assert.deepEqual(board.objects.map((object) => object.id).sort(), ['base', 'mine', 'theirs']);
});

test('legacy: a final save that fails is kept and recovered on the next load', async () => {
  const base = [{ id: 'base', left: 1 }];
  const board = { revision: 2, objects: [...clone(base), { id: 'theirs', left: 2 }] };
  const records = { records: {} };
  const getBoard = () => ({ revision: board.revision, objects: clone(board.objects) });
  const first = legacyWithJournal(records, getBoard, base, 'first');
  first.saveFails = true;
  const failed = await first.controller.persist({ version: '7', objects: [...clone(base), { id: 'mine', left: 3 }] }, { final: true });
  assert.equal(failed.ok, false);
  assert.equal(Object.keys(records.records).length, 1);
  const next = legacyWithJournal(records, getBoard, clone(board.objects), 'second');
  next.server.saveBoard = (client, body) => {
    if (body.ifRevision !== board.revision) return { ok: false, code: 'CANVAS_CHANGED' };
    board.objects = clone(body.canvasData.objects);
    board.revision += 1;
    return { ok: true, revision: board.revision };
  };
  const summary = await next.controller.recoverPending();
  assert.equal(summary.recovered, 1);
  assert.deepEqual(board.objects.map((object) => object.id).sort(), ['base', 'mine', 'theirs']);
  assert.deepEqual(next.objects.map((object) => object.id).sort(), ['base', 'mine', 'theirs']);
  assert.equal(next.recoveries.length, 1);
  assert.equal(Object.keys(records.records).length, 0);
});

test('legacy: unloading with unsaved work keeps a snapshot and sends a revision-checked save', () => {
  const base = [{ id: 'base', left: 1 }];
  const records = { records: {} };
  const b = legacyWithJournal(records, () => ({ revision: 1, objects: clone(base) }), base, 'unload');
  const sent = [];
  b.server.saveBoard = (client, body) => { sent.push(body); return { ok: true, revision: 2 }; };
  b.objects.push({ id: 'mine', left: 3 });
  assert.equal(b.controller.flushOnUnload(), true);
  assert.equal(sent[0].ifRevision, 1);
  assert.equal(Object.keys(records.records).length, 1);
});

test('legacy: a remote edit to an object with unsaved local changes reports a conflict, and only then', () => {
  const base = [{ id: 'one', left: 1 }, { id: 'two', left: 2 }];
  const b = legacyClient('B', () => ({ revision: 1, objects: clone(base) }), base);
  b.controller.noteRemoteEdit(['one']);
  assert.deepEqual(b.conflicts, []);
  b.objects[0].left = 50;
  b.controller.noteRemoteEdit(['two']);
  assert.deepEqual(b.conflicts, []);
  b.controller.noteRemoteEdit(['one']);
  assert.deepEqual(b.conflicts, ['one']);
});

test('an object that cannot be prepared does not stop a merge or block valid objects', async () => {
  const base = [{ id: 'base', left: 1 }];
  const theirs = [...base, { id: 'good', left: 2 }, { id: 'bad', left: 3 }];
  const b = legacyClient('B', () => ({ revision: 2, objects: clone(theirs) }), base);
  b.unpreparable = ['bad'];
  await b.controller.reconnect();
  assert.ok(b.objects.some((object) => object.id === 'good'));
  assert.equal(b.unrestorable, 1);
  assert.equal(b.syncErrors.length, 0);
  assert.equal(b.controller.getState().knownRevision, 2);
});

test('an acknowledged edit replaced by a collaborator soon after reports a conflict, and other objects do not', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const b = createClient('B', server);
  const [first, second] = a.objects;
  a.objects[0].left = 500;
  await a.controller.submitLocalChanges();
  await settle(a, b);
  b.objects.find((object) => object.id === second.id).left = 600;
  await b.controller.submitLocalChanges();
  await settle(a, b);
  assert.deepEqual(a.conflicts, []);
  b.objects.find((object) => object.id === first.id).left = 700;
  await b.controller.submitLocalChanges();
  await settle(a, b);
  assert.deepEqual(a.conflicts, [first.id]);
  assert.deepEqual(a.objects, server.objects);
});

test('legacy: a kept snapshot that differs only in stacking order is not reported as recovered work', async () => {
  const base = [{ id: 'one', left: 1 }, { id: 'two', left: 2 }];
  const records = { records: {} };
  const getBoard = () => ({ revision: 1, objects: clone(base) });
  const first = legacyWithJournal(records, getBoard, base, 'first');
  first.objects.reverse();
  assert.equal(first.controller.flushOnUnload(), true);
  const next = legacyWithJournal(records, getBoard, base, 'second');
  const summary = await next.controller.recoverPending();
  assert.equal(summary.recovered, 0);
  assert.equal(next.recoveries.length, 0);
  assert.equal(Object.keys(records.records).length, 0);
});

const heldItems = (store) => Object.values(store.records).flatMap((record) => record.held || []);

const killTab = (client, store) => {
  const survived = clone(store.records);
  client.controller.dispose();
  store.records = survived;
};

const fakeStorage = () => {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); }
  };
};

test('an edit is kept durably the moment it happens and cleared only once the server accepts it', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.edit(patch('shape_a', { left: 201 }));
  a.controller.noteLocalChange();
  assert.equal(pendingEntries(store).length, 1);
  assert.equal(pendingEntries(store)[0].op.upserts[0].data.left, 201);
  a.stall = true;
  const pending = a.controller.submitLocalChanges();
  await wait(30);
  assert.equal(pendingEntries(store).length, 1);
  const held = a.stalled.shift();
  held.resolve(server.operation(a, held.payload));
  await pending;
  assert.deepEqual(pendingEntries(store), []);
  a.controller.dispose();
});

test('a tab killed with no unload event still recovers its edit once on reopening', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.edit(patch('shape_a', { left: 202 }));
  a.controller.noteLocalChange();
  killTab(a, store);
  assert.equal(Object.values(store.records)[0].ended, false);
  assert.equal(server.revision, 0);
  const reopened = createClient('A2', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a2' });
  assert.deepEqual(await reopened.controller.recoverPending(), { recovered: 1, conflicts: 0, kept: 0 });
  assert.equal(find(server.objects, 'shape_a').left, 202);
  assert.equal(server.revision, 1);
  assert.equal(find(reopened.objects, 'shape_a').left, 202);
  const again = createClient('A3', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a3' });
  assert.deepEqual(await again.controller.recoverPending(), { recovered: 0, conflicts: 0, kept: 0 });
  assert.equal(server.revision, 1);
  assert.deepEqual(Object.keys(store.records), []);
  reopened.controller.dispose();
  again.controller.dispose();
});

test('an edit stays kept while a refused save is waiting on a merge', async () => {
  const server = createServer();
  const store = journalStore();
  let release = null;
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a', getBoard: () => new Promise((resolve) => { release = () => resolve(server.getBoard()); }) });
  a.failOps.push('STALE_REVISION');
  const pending = a.commit(patch('shape_a', { left: 203 }));
  await wait(30);
  assert.ok(release);
  assert.equal(pendingEntries(store).length, 1);
  assert.equal(pendingEntries(store)[0].op.upserts[0].data.left, 203);
  release();
  await pending;
  assert.equal(find(server.objects, 'shape_a').left, 203);
  assert.deepEqual(pendingEntries(store), []);
  a.controller.dispose();
});

test('a draft whose save was accepted before cleanup finished is removed without saving again', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.edit(patch('shape_a', { left: 204 }));
  a.controller.noteLocalChange();
  const uncleaned = clone(store.records);
  await a.controller.submitLocalChanges();
  a.controller.dispose();
  store.records = uncleaned;
  const revision = server.revision;
  const reopened = createClient('A2', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a2' });
  assert.deepEqual(await reopened.controller.recoverPending(), { recovered: 0, conflicts: 0, kept: 0 });
  assert.equal(server.revision, revision);
  assert.deepEqual(reopened.recoveries, []);
  assert.deepEqual(Object.keys(store.records), []);
  reopened.controller.dispose();
});

test('a draft that cannot reach the server is kept, reported as kept and sent after reconnecting', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.edit(patch('shape_a', { left: 205 }));
  a.controller.noteLocalChange();
  killTab(a, store);
  const reopened = createClient('A2', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a2' });
  reopened.connected = false;
  assert.deepEqual(await reopened.controller.recoverPending(), { recovered: 0, conflicts: 0, kept: 1 });
  assert.deepEqual(reopened.recoveries, []);
  assert.equal(reopened.recoveryState.kept, 1);
  assert.equal(pendingEntries(store).length, 1);
  reopened.connected = true;
  assert.deepEqual(await reopened.controller.recoverPending(), { recovered: 1, conflicts: 0, kept: 0 });
  assert.equal(find(server.objects, 'shape_a').left, 205);
  assert.equal(reopened.recoveryState.kept, 0);
  reopened.controller.dispose();
});

test('damaged journal records are removed and reported without blocking a good one', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.edit(patch('shape_a', { left: 206 }));
  a.controller.noteLocalChange();
  killTab(a, store);
  store.records.bad_json = null;
  store.records.bad_shape = { ended: true, entries: 5 };
  store.records.bad_entry = { ended: true, entries: [{ op: { opId: 1, upserts: 'x' } }, null] };
  const reopened = createClient('A2', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a2' });
  assert.deepEqual(await reopened.controller.recoverPending(), { recovered: 1, conflicts: 0, kept: 0 });
  assert.equal(find(server.objects, 'shape_a').left, 206);
  assert.equal(reopened.recoveryState.damaged, 4);
  assert.deepEqual(Object.keys(store.records), []);
  reopened.controller.dispose();
});

test('a conflicting draft never overwrites newer work and is kept until the user chooses', async () => {
  for (const [choice, expected] of [['mine', 207], ['discard', 499]]) {
    const server = createServer();
    const store = journalStore();
    const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
    const b = createClient('B', server);
    a.edit(patch('shape_a', { left: 207 }));
    a.controller.noteLocalChange();
    killTab(a, store);
    await b.commit(patch('shape_a', { left: 499 }));
    const reopened = createClient('A2', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a2' });
    assert.deepEqual(await reopened.controller.recoverPending(), { recovered: 0, conflicts: 1, kept: 0 });
    assert.equal(find(server.objects, 'shape_a').left, 499);
    assert.deepEqual(heldItems(store).map((item) => [item.id, item.mine.left]), [['shape_a', 207]]);
    assert.equal(reopened.recoveryState.held, 1);
    const later = createClient('A3', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a3' });
    await later.controller.recoverPending();
    assert.equal(later.recoveryState.held, 1);
    assert.equal(find(server.objects, 'shape_a').left, 499);
    assert.equal((await later.controller.resolveHeld(choice)).ok, true);
    assert.equal(find(server.objects, 'shape_a').left, expected);
    assert.equal(find(later.objects, 'shape_a').left, expected);
    assert.deepEqual(Object.keys(store.records), []);
    [b, reopened, later].forEach((client) => client.controller.dispose());
  }
});

test('a conflict on one part of a linked element holds back the whole element', async () => {
  const server = createServer();
  server.objects = [shape('part_shape', { elementId: 'el_1' }), label('part_text', 'part_shape', { elementId: 'el_1' })];
  server.revision = 1;
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  const b = createClient('B', server);
  a.edit((objects) => objects.map((object) => ({ ...object, left: 300 })));
  a.controller.noteLocalChange();
  killTab(a, store);
  await b.commit(patch('part_text', { text: 'theirs' }));
  const reopened = createClient('A2', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a2' });
  await reopened.controller.recoverPending();
  assert.notEqual(find(server.objects, 'part_shape').left, 300);
  assert.notEqual(find(server.objects, 'part_text').left, 300);
  assert.equal(find(server.objects, 'part_text').text, 'theirs');
  assert.deepEqual(heldItems(store).map((item) => item.id).sort(), ['part_shape', 'part_text']);
  [b, reopened].forEach((client) => client.controller.dispose());
});

test('legacy: a killed tab recovers its edit, keeps newer work and clears the record after the save is accepted', async () => {
  const base = [{ id: 'one', left: 1 }, { id: 'two', left: 2 }];
  const board = { revision: 1, objects: clone(base) };
  const records = { records: {} };
  const getBoard = () => ({ revision: board.revision, objects: clone(board.objects) });
  const first = legacyWithJournal(records, getBoard, base, 'first');
  first.objects = [{ id: 'one', left: 100 }, { id: 'two', left: 200 }, { id: 'mine', left: 3 }];
  first.controller.noteLocalChange();
  assert.equal(pendingEntries(records).length, 1);
  killTab(first, records);
  board.objects = [{ id: 'one', left: 999 }, { id: 'two', left: 2 }, { id: 'theirs', left: 4 }];
  board.revision = 2;
  const saves = [];
  const next = createClient('B', createServer(), { foreignJournalAgeMs: 0 }, { getBoard, journalStore: records, instanceId: 'second' });
  next.objects = clone(board.objects);
  next.server.saveBoard = (client, body) => {
    saves.push(body.ifRevision);
    if (body.ifRevision !== board.revision) return { ok: false, code: 'CANVAS_CHANGED' };
    board.objects = clone(body.canvasData.objects);
    board.revision += 1;
    return { ok: true, revision: board.revision };
  };
  next.controller.load({ revision: 2, objects: clone(board.objects), enabled: false });
  next.controller.markLoaded();
  const summary = await next.controller.recoverPending();
  assert.deepEqual(summary, { recovered: 2, conflicts: 1, kept: 0 });
  assert.deepEqual(saves, [2]);
  assert.deepEqual(board.objects.map((object) => [object.id, object.left]).sort(), [['mine', 3], ['one', 999], ['theirs', 4], ['two', 200]]);
  assert.deepEqual(heldItems(records).map((item) => [item.id, item.mine.left]), [['one', 100]]);
  assert.deepEqual(pendingEntries(records), []);
  next.controller.dispose();
});

test('legacy: a tab that is still open keeps its draft and another tab does not take it', async () => {
  const base = [{ id: 'one', left: 1 }];
  const records = { records: {} };
  const getBoard = () => ({ revision: 1, objects: clone(base) });
  const first = legacyWithJournal(records, getBoard, base, 'first');
  first.objects = [{ id: 'one', left: 100 }];
  first.controller.noteLocalChange();
  const next = legacyWithJournal(records, getBoard, base, 'second');
  let saved = 0;
  next.server.saveBoard = () => { saved += 1; return { ok: true, revision: 2 }; };
  assert.deepEqual(await next.controller.recoverPending(), { recovered: 0, conflicts: 0, kept: 0 });
  assert.equal(saved, 0);
  assert.equal(pendingEntries(records).length, 1);
  first.controller.dispose();
  next.controller.dispose();
});

test('the journal keeps each account and board apart and stores no credentials', () => {
  const storage = fakeStorage();
  const mine = createPendingJournal({ boardId: 'board_1', userId: 'user_a', storage });
  const record = { ended: true, entries: [{ savedAt: 1, op: { opId: 'op_1', baseRevision: 1, upserts: [{ id: 'x', data: { id: 'x' } }], deletes: [] }, base: {} }] };
  mine.write('inst_a', record);
  assert.deepEqual(mine.list().map((row) => row.instanceId), ['inst_a']);
  assert.equal(countPendingChanges(mine), 1);
  assert.deepEqual(createPendingJournal({ boardId: 'board_1', userId: 'user_b', storage }).list(), []);
  assert.deepEqual(createPendingJournal({ boardId: 'board_2', userId: 'user_a', storage }).list(), []);
  assert.equal(createPendingJournal({ boardId: 'board_1', userId: undefined, storage }), null);
  storage.setItem(storage.key(0), '{not json');
  assert.deepEqual(mine.list(), [{ instanceId: 'inst_a', record: null }]);
  assert.equal(countPendingChanges(mine), 0);
  mine.remove('inst_a');
  assert.equal(storage.length, 0);
});

test('a browser that cannot keep a draft warns once and reports that it cannot recover', () => {
  const server = createServer();
  const store = journalStore();
  store.failWrites = true;
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.edit(patch('shape_a', { left: 208 }));
  a.controller.noteLocalChange();
  a.edit(patch('shape_a', { left: 209 }));
  a.controller.noteLocalChange();
  assert.equal(a.journalWarnings, 1);
  assert.equal(a.controller.canRecover(), false);
  assert.equal(a.controller.hasUnsavedWork(), true);
  a.controller.dispose();
});

test('legacy: a draft is cleared only after the server accepts the save, and an edit made during the save stays kept', async () => {
  const base = [{ id: 'one', left: 1 }, { id: 'two', left: 2 }];
  const records = { records: {} };
  const board = { revision: 1, objects: clone(base) };
  const first = legacyWithJournal(records, () => ({ revision: board.revision, objects: clone(board.objects) }), base, 'first');
  let finishSave = null;
  first.server.saveBoard = (client, body) => new Promise((resolve) => {
    finishSave = () => {
      board.objects = clone(body.canvasData.objects);
      board.revision += 1;
      resolve({ ok: true, revision: board.revision });
    };
  });
  first.edit(patch('one', { left: 100 }));
  first.controller.noteLocalChange();
  const saving = first.controller.persist({ version: '7', objects: clone(first.objects) });
  await wait(20);
  assert.equal(pendingEntries(records).length, 1);
  first.edit(patch('two', { left: 200 }));
  first.controller.noteLocalChange();
  finishSave();
  await saving;
  const kept = pendingEntries(records);
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].op.upserts.map((upsert) => upsert.id), ['two']);
  const finishing = first.controller.persist({ version: '7', objects: clone(first.objects) });
  await wait(20);
  finishSave();
  await finishing;
  assert.deepEqual(pendingEntries(records), []);
  first.controller.dispose();
});

const keptEntry = (opId, id, left) => ({ savedAt: 1, op: { opId, baseRevision: 0, kind: 'edit', upserts: [{ id, data: { id, left }, unset: [] }], deletes: [] }, base: {} });

test('discarding held work reports the changes still retained and keeps them in the journal', async () => {
  const server = createServer();
  const store = journalStore();
  store.records.dead_held = { ended: true, beat: 1, entries: [], held: [{ id: 'shape_a', mine: { id: 'shape_a', left: 1 } }] };
  store.records.dead_mixed = { ended: true, beat: 1, entries: [keptEntry('op_mixed', 'shape_c', 7)], held: [{ id: 'shape_c', mine: { id: 'shape_c', left: 8 } }] };
  store.records.dead_kept = { ended: true, beat: 1, entries: [keptEntry('op_kept', 'shape_b', 5)] };
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  assert.equal((await a.controller.resolveHeld('discard')).ok, true);
  assert.deepEqual(a.recoveryState, { kept: 2, held: 0, heldOrder: 0, damaged: 0 });
  assert.deepEqual(pendingEntries(store).map((entry) => entry.op.opId).sort(), ['op_kept', 'op_mixed']);
  assert.deepEqual(heldItems(store), []);
  assert.equal(store.records.dead_held, undefined);
  a.controller.dispose();
});

test('invalid held items are reported as damaged, never applied, and valid ones in the same record stay held', async () => {
  const server = createServer();
  const store = journalStore();
  store.records.dead = { ended: true, beat: 1, entries: [], held: [
    { id: 5 },
    null,
    { id: 'shape_b', mine: 'not an object' },
    { id: 'shape_c', mine: { id: 'a_different_object', left: 901 } },
    { id: 'shape_a', mine: { id: 'shape_a', left: 900 } }
  ] };
  const a = createClient('A', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a' });
  await a.controller.recoverPending();
  assert.deepEqual(a.recoveryState, { kept: 0, held: 1, heldOrder: 0, damaged: 4 });
  assert.deepEqual(store.records.dead.held.map((item) => item.id), ['shape_a']);
  const later = createClient('A2', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a2' });
  await later.controller.recoverPending();
  assert.deepEqual(later.recoveryState, { kept: 0, held: 1, heldOrder: 0, damaged: 0 });
  assert.equal((await later.controller.resolveHeld('mine')).ok, true);
  assert.equal(find(server.objects, 'shape_a').left, 900);
  assert.equal(find(server.objects, 'a_different_object'), undefined);
  assert.notEqual(find(server.objects, 'shape_c').left, 901);
  assert.deepEqual(Object.keys(store.records), []);
  [a, later].forEach((client) => client.controller.dispose());
});

test('a record with a damaged held list still recovers its valid entries', async () => {
  const server = createServer();
  const store = journalStore();
  store.records.dead = { ended: true, beat: 1, entries: [keptEntry('op_ok', 'shape_a', 77)], held: 'broken' };
  const a = createClient('A', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a' });
  await a.controller.recoverPending();
  assert.equal(find(server.objects, 'shape_a').left, 77);
  assert.equal(a.recoveryState.damaged, 1);
  assert.deepEqual(Object.keys(store.records), []);
  a.controller.dispose();
});

const bringFirstToTop = (objects) => [...objects.slice(1), objects[0]];
const orderIds = (objects) => objects.map((object) => object.id);

test('an order-only edit is kept and restored, and the server order matches the client', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.edit(bringFirstToTop);
  const wanted = orderIds(a.objects);
  a.controller.noteLocalChange();
  assert.deepEqual(pendingEntries(store)[0].op.order, wanted);
  killTab(a, store);
  const reopened = createClient('A2', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a2' });
  assert.equal((await reopened.controller.recoverPending()).recovered, 1);
  assert.deepEqual(orderIds(server.objects), wanted);
  assert.deepEqual(orderIds(reopened.objects), wanted);
  assert.deepEqual(Object.keys(store.records), []);
  reopened.controller.dispose();
});

test('a stale order-only edit is restored without overwriting an unrelated newer addition', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  const b = createClient('B', server);
  const moved = a.objects[0].id;
  a.edit(bringFirstToTop);
  a.controller.noteLocalChange();
  killTab(a, store);
  await b.commit((objects) => [...objects, shape('from_b')]);
  const reopened = createClient('A2', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a2' });
  const summary = await reopened.controller.recoverPending();
  assert.deepEqual(summary, { recovered: 1, conflicts: 0, kept: 0 });
  const ids = orderIds(server.objects);
  assert.equal(ids.filter((id) => id === 'from_b').length, 1);
  assert.ok(ids.filter((id) => id !== 'from_b').at(-1) === moved);
  assert.deepEqual(orderIds(reopened.objects), ids);
  assert.deepEqual(Object.keys(store.records), []);
  [b, reopened].forEach((client) => client.controller.dispose());
});

test('a real order conflict keeps the newer order on the server and holds mine until the user chooses', async () => {
  for (const choice of ['mine', 'discard']) {
    const server = createServer();
    const store = journalStore();
    const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
    const b = createClient('B', server);
    a.edit(bringFirstToTop);
    const mine = orderIds(a.objects);
    a.controller.noteLocalChange();
    killTab(a, store);
    await b.commit((objects) => [objects.at(-1), ...objects.slice(0, -1)]);
    const theirs = orderIds(server.objects);
    const reopened = createClient('A2', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a2' });
    assert.deepEqual(await reopened.controller.recoverPending(), { recovered: 0, conflicts: 1, kept: 0 });
    assert.deepEqual(orderIds(server.objects), theirs);
    assert.deepEqual(reopened.recoveryState, { kept: 0, held: 0, heldOrder: 1, damaged: 0 });
    assert.deepEqual(Object.values(store.records)[0].heldOrder, mine);
    assert.equal((await reopened.controller.resolveHeld(choice)).ok, true);
    assert.deepEqual(orderIds(server.objects), choice === 'mine' ? mine : theirs);
    assert.deepEqual(orderIds(reopened.objects), orderIds(server.objects));
    assert.deepEqual(Object.keys(store.records), []);
    assert.deepEqual(reopened.recoveryState, { kept: 0, held: 0, heldOrder: 0, damaged: 0 });
    [b, reopened].forEach((client) => client.controller.dispose());
  }
});

test('legacy: an order-only edit is restored by an accepted save, and a real conflict is held', async () => {
  for (const collaboratorMoved of [false, true]) {
    const base = [{ id: 'one', left: 1 }, { id: 'two', left: 2 }, { id: 'three', left: 3 }];
    const board = { revision: 1, objects: clone(base) };
    const records = { records: {} };
    const getBoard = () => ({ revision: board.revision, objects: clone(board.objects) });
    const first = legacyWithJournal(records, getBoard, base, 'first');
    first.edit(bringFirstToTop);
    const mine = orderIds(first.objects);
    first.controller.noteLocalChange();
    killTab(first, records);
    if (collaboratorMoved) {
      board.objects = [clone(base[2]), clone(base[0]), clone(base[1])];
      board.revision = 2;
    }
    const theirs = orderIds(board.objects);
    const next = createClient('B', createServer(), { foreignJournalAgeMs: 0 }, { getBoard, journalStore: records, instanceId: 'second' });
    next.objects = clone(board.objects);
    next.server.saveBoard = (client, body) => {
      if (body.ifRevision !== board.revision) return { ok: false, code: 'CANVAS_CHANGED' };
      board.objects = clone(body.canvasData.objects);
      board.revision += 1;
      return { ok: true, revision: board.revision };
    };
    next.controller.load({ revision: board.revision, objects: clone(board.objects), enabled: false });
    next.controller.markLoaded();
    await next.controller.recoverPending();
    assert.deepEqual(orderIds(board.objects), collaboratorMoved ? theirs : mine);
    assert.equal(next.recoveryState.heldOrder, collaboratorMoved ? 1 : 0);
    assert.equal(Object.keys(records.records).length, collaboratorMoved ? 1 : 0);
    next.controller.dispose();
  }
});

test('acknowledging an earlier operation cannot clear an edit made while it was in flight', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.stall = true;
  const pending = a.commit(patch('shape_a', { left: 210 }));
  await wait(30);
  a.edit(patch('shape_b', { left: 211 }));
  a.controller.noteLocalChange();
  assert.deepEqual(pendingEntries(store).map((entry) => Boolean(entry.after)), [false, true]);
  const held = a.stalled.shift();
  a.stall = false;
  a.connected = false;
  held.resolve(server.operation(a, held.payload));
  await pending;
  const left = pendingEntries(store);
  assert.equal(left.length, 1);
  assert.deepEqual(left[0].op.upserts.map((upsert) => [upsert.id, upsert.data.left]), [['shape_b', 211]]);
  a.controller.dispose();
});

test('a draft written with operations on is recovered through the guarded save when operations are off', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.edit(patch('shape_a', { left: 220 }));
  a.controller.noteLocalChange();
  killTab(a, store);
  const board = { revision: server.revision + 5, objects: patch('shape_b', { left: 999 })(clone(server.objects)) };
  const saves = [];
  const next = createClient('B', createServer(), { foreignJournalAgeMs: 0 }, { getBoard: () => ({ revision: board.revision, objects: clone(board.objects) }), journalStore: store, instanceId: 'second' });
  next.objects = clone(board.objects);
  next.server.saveBoard = (client, body) => {
    saves.push({ ifRevision: body.ifRevision, baseRevision: body.baseRevision });
    if (body.ifRevision !== board.revision) return { ok: false, code: 'CANVAS_CHANGED' };
    board.objects = clone(body.canvasData.objects);
    board.revision += 1;
    return { ok: true, revision: board.revision };
  };
  next.controller.load({ revision: board.revision, objects: clone(board.objects), enabled: false });
  next.controller.markLoaded();
  assert.equal((await next.controller.recoverPending()).recovered, 1);
  assert.deepEqual(saves, [{ ifRevision: board.revision - 1, baseRevision: undefined }]);
  assert.equal(find(board.objects, 'shape_a').left, 220);
  assert.equal(find(board.objects, 'shape_b').left, 999);
  assert.deepEqual(Object.keys(store.records), []);
  next.controller.dispose();
});

test('a draft written with operations off is recovered through a revision-checked operation when operations are on', async () => {
  const server = createServer();
  const store = journalStore();
  const base = clone(server.objects);
  const writer = createClient('W', createServer(), {}, { getBoard: () => ({ revision: 0, objects: clone(base) }), journalStore: store, instanceId: 'writer' });
  writer.objects = clone(base);
  writer.controller.load({ revision: 0, objects: clone(base), enabled: false });
  writer.controller.markLoaded();
  writer.edit(patch('shape_a', { left: 221 }));
  writer.controller.noteLocalChange();
  killTab(writer, store);
  const b = createClient('B', server);
  await b.commit(patch('shape_b', { left: 998 }));
  const reopened = createClient('A2', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a2' });
  assert.deepEqual(await reopened.controller.recoverPending(), { recovered: 1, conflicts: 0, kept: 0 });
  assert.equal(find(server.objects, 'shape_a').left, 221);
  assert.equal(find(server.objects, 'shape_b').left, 998);
  assert.ok(server.ops.some((op) => op.from === 'A2'));
  assert.deepEqual(Object.keys(store.records), []);
  [b, reopened].forEach((client) => client.controller.dispose());
});

test('a draft reuses the snapshot the page already took and keeps its in-flight ordering', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  a.stall = true;
  const pending = a.commit(patch('shape_a', { left: 230 }));
  await wait(30);
  const taken = patch('shape_b', { left: 231 })(clone(a.objects));
  a.detached = true;
  a.controller.noteLocalChange(taken);
  a.detached = false;
  const entries = pendingEntries(store);
  assert.equal(entries.length, 2);
  assert.equal(Boolean(entries[1].after), true);
  assert.deepEqual(entries[1].op.upserts.map((upsert) => [upsert.id, upsert.data.left]), [['shape_b', 231]]);
  const held = a.stalled.shift();
  held.resolve(server.operation(a, held.payload));
  await pending;
  a.controller.dispose();
});

test('legacy: a draft reuses the snapshot the page already took', () => {
  const base = [{ id: 'one', left: 1 }];
  const records = { records: {} };
  const first = legacyWithJournal(records, () => ({ revision: 1, objects: clone(base) }), base, 'first');
  first.detached = true;
  first.controller.noteLocalChange([{ id: 'one', left: 240 }]);
  first.detached = false;
  assert.deepEqual(pendingEntries(records)[0].op.upserts.map((upsert) => [upsert.id, upsert.data.left]), [['one', 240]]);
  first.controller.dispose();
});

test('edits made in one interaction and before an earlier save returns all reach the server once', async () => {
  const server = createServer();
  const a = createClient('A', server);
  a.stall = true;
  const first = a.commit(patch('shape_a', { left: 301 }));
  await wait(30);
  a.edit(patch('shape_b', { left: 302 }));
  a.edit(patch('shape_c', { left: 303 }));
  const second = a.controller.submitLocalChanges();
  await wait(20);
  a.stall = false;
  const held = a.stalled.shift();
  held.resolve(server.operation(a, held.payload));
  await Promise.all([first, second]);
  await a.controller.idle();
  assert.deepEqual(['shape_a', 'shape_b', 'shape_c'].map((id) => find(server.objects, id).left), [301, 302, 303]);
  assert.equal(new Set(server.objects.map((object) => object.id)).size, server.objects.length);
  a.controller.dispose();
});

test('a shared snapshot object is never written to by a later edit or by acknowledgement', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const frozen = (objects) => objects.map((object) => Object.freeze(object));
  a.objects = frozen(a.objects);
  await a.commit((objects) => objects.map((object) => (object.id === 'shape_a' ? Object.freeze({ ...object, left: 305 }) : object)));
  await a.commit((objects) => [...objects].reverse());
  assert.equal(find(server.objects, 'shape_a').left, 305);
  a.controller.dispose();
});

test('an edit made while recovery is pending is kept and both changes reach the server', async () => {
  const server = createServer();
  const store = journalStore();
  const dead = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  dead.edit(patch('shape_a', { left: 306 }));
  dead.controller.noteLocalChange();
  killTab(dead, store);
  const reopened = createClient('A2', server, { foreignJournalAgeMs: 0 }, { journalStore: store, instanceId: 'inst_a2' });
  const recovering = reopened.controller.recoverPending();
  reopened.edit(patch('shape_b', { left: 307 }));
  reopened.controller.noteLocalChange();
  const saving = reopened.controller.submitLocalChanges();
  await Promise.all([recovering, saving]);
  await reopened.controller.idle();
  assert.equal(find(server.objects, 'shape_a').left, 306);
  assert.equal(find(server.objects, 'shape_b').left, 307);
  assert.deepEqual(Object.keys(store.records), []);
  reopened.controller.dispose();
});

test('a change noted while the board is loading is not journaled or sent and cannot erase the board', async () => {
  const server = createServer();
  const store = journalStore();
  const a = createClient('A', server, {}, { journalStore: store, instanceId: 'inst_a' });
  const revision = server.revision;
  const objects = clone(server.objects);
  a.controller.load({ revision, objects, enabled: true });
  a.objects = [];
  a.controller.noteLocalChange([]);
  assert.deepEqual(pendingEntries(store), []);
  assert.equal(server.revision, revision);
  a.objects = clone(objects);
  a.controller.markLoaded();
  a.edit(patch('shape_a', { left: 308 }));
  await a.controller.submitLocalChanges();
  assert.equal(find(server.objects, 'shape_a').left, 308);
  assert.equal(server.objects.length, objects.length);
  a.controller.dispose();
});
