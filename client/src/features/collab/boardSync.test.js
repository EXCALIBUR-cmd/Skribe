import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCanvasOperation, buildCanvasOperation, conflictUndoObjects, mergeThreeWay, OPERATION_BYTE_LIMIT } from './boardSync.js';
import { createBoardSyncController } from './boardSyncController.js';

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

const createClient = (name, server, overrides = {}, { normalize = (objects) => objects, getBoard = null, onPrepare = null } = {}) => {
  const client = { name, server, connected: true, busy: false, objects: [], undoBase: null, merges: [], conflicts: [], legacyBroadcasts: 0, saveRequests: 0, hold: null, held: [] };
  const canvas = {
    serialize: () => clone(client.objects),
    snapshot: () => ({ version: '7.4.0', objects: clone(client.objects) }),
    prepare: async (objects) => {
      if (onPrepare) await onPrepare(objects);
      return new Map(objects.map((object) => [object.id, clone(object)]));
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
    api: { getBoard: async () => (getBoard ? getBoard() : server.getBoard()), saveBoard: async (body) => server.saveBoard(client, clone(body)) },
    socket: { emitOperation: async (payload) => (client.connected ? server.operation(client, clone(payload)) : { ok: false, code: 'DISCONNECTED' }) },
    canvas,
    notify: (kind, detail) => { if (kind === 'conflict') client.conflicts.push(...detail.ids); },
    requestSave: () => { client.saveRequests += 1; },
    options: { pullDelayMs: 5, gapTimeoutMs: 20, idlePollMs: 2, ...overrides }
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

test('an oversized or rejected operation falls back to a compare-and-set save of the merged board', async () => {
  const server = createServer();
  const a = createClient('A', server);
  const big = 'x'.repeat(OPERATION_BYTE_LIMIT);
  const result = await a.history('apply', patch('shape_b', { blob: big }));
  assert.deepEqual([result.mode, result.reason], ['save', 'OPERATION_TOO_LARGE']);
  assert.equal(server.ops.length, 0);
  assert.equal(a.saveRequests, 1);
  assert.equal(a.controller.getState().hasLocalChanges, true);
  assert.equal((await a.save()).ok, true);
  assert.equal(find(server.objects, 'shape_b').blob.length, OPERATION_BYTE_LIMIT);
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
  assert.deepEqual(await a.controller.persist(null, { final: true }), { ok: false, code: 'NO_CANVAS' });
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
  b.controller.dispose();
  const result = await b.save({ final: true });
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
