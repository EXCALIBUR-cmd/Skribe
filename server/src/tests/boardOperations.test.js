import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import mongoose from 'mongoose';
import config from '../config/env.js';
import Board from '../models/Board.js';
import User from '../models/User.js';
import boardService from '../services/board.service.js';
import boardController from '../controllers/board.controller.js';
import { initSocketIO } from '../sockets/index.js';
import { OPERATION_RATE_LIMIT, boardRoomName, registerBoardHandlers } from '../sockets/boardHandlers.js';
import { OPERATION_LIMITS, applyCanvasOperation, commitCanvasOperation, validateCanvasOperation } from '../services/boardOperation.service.js';

const TEST_DB_NAME = `skribe_board_ops_test_${process.pid}_${Date.now()}`;
const TEST_MONGO_BASE = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
let mongoAvailable = false;
try {
  await mongoose.connect(`${TEST_MONGO_BASE}/${TEST_DB_NAME}`, { serverSelectionTimeoutMS: 1500 });
  mongoAvailable = true;
} catch {
  mongoAvailable = false;
}
const needsMongo = { skip: mongoAvailable ? false : `MongoDB is not reachable at ${TEST_MONGO_BASE}` };
const originalCollabFlag = config.collabOperationsEnabled;
config.collabOperationsEnabled = true;

const io = initSocketIO(http.createServer());
const emitted = [];
io.to = (room) => ({ emit: (event, data) => emitted.push({ room, event, data }) });

test.after(async () => {
  config.collabOperationsEnabled = originalCollabFlag;
  io.close();
  if (mongoAvailable && mongoose.connection.name === TEST_DB_NAME) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});

const ownerId = new mongoose.Types.ObjectId();
const memberId = new mongoose.Types.ObjectId();
const strangerId = new mongoose.Types.ObjectId();

const shape = (id, extra = {}) => ({ type: 'rect', id, left: 10, top: 20, width: 100, height: 60, elementId: id.replace(/^shape_/, ''), ...extra });
const label = (id, parentShapeId) => ({ type: 'textbox', id, text: 'Label', elementId: parentShapeId.replace(/^shape_/, ''), parentShapeId });
const startingObjects = () => [shape('shape_a', { attachedTextId: 'text_a' }), label('text_a', 'shape_a'), shape('shape_b')];

const createBoard = async (objects = startingObjects()) => {
  const board = await Board.create({ owner: ownerId, members: [memberId], title: 'ops test', canvasData: { version: '7.4.0', objects } });
  return board._id.toString();
};

let opCounter = 0;
const operation = (baseRevision, changes = {}) => ({ opId: `op_test_${(opCounter += 1)}_${Date.now()}`, baseRevision, kind: 'undo', upserts: [], deletes: [], ...changes });
const stored = async (boardId) => Board.findById(boardId).select('+recentOperations').lean();
const storedIds = async (boardId) => (await stored(boardId)).canvasData.objects.map((object) => object.id);

const fakeSocket = (userId, boardId, { joined = true } = {}) => {
  const handlers = new Map();
  const broadcasts = [];
  const socket = {
    id: `sock_${opCounter}_${Math.random().toString(36).slice(2, 8)}`,
    user: { id: userId.toString() },
    data: {},
    rooms: new Set(joined ? [boardRoomName(boardId)] : []),
    on: (event, handler) => handlers.set(event, handler),
    emit: () => {},
    to: (room) => ({ emit: (event, data) => broadcasts.push({ room, event, data }) })
  };
  registerBoardHandlers({ to: () => ({ emit: () => {} }) }, socket);
  const send = (payload) => new Promise((resolve) => handlers.get('canvas:op')(payload, resolve));
  return { socket, broadcasts, send };
};

const fakeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

test('validateCanvasOperation accepts a well-formed operation and normalises it', () => {
  const result = validateCanvasOperation({
    boardId: 'ignored',
    opId: 'op_valid_0001',
    baseRevision: 3,
    kind: 'redo',
    upserts: [{ id: 'shape_a', data: { id: 'shape_a', type: 'rect', left: 5, metadata: { nested: { depth: [1, 2] } } } }],
    deletes: ['shape_b'],
    order: ['shape_a', 'text_a']
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.op, {
    opId: 'op_valid_0001',
    baseRevision: 3,
    kind: 'redo',
    upserts: [{ id: 'shape_a', data: { id: 'shape_a', type: 'rect', left: 5, metadata: { nested: { depth: [1, 2] } } }, unset: [] }],
    deletes: ['shape_b'],
    order: ['shape_a', 'text_a']
  });
});

test('validateCanvasOperation rejects malformed, unsafe and oversized operations', () => {
  const good = { opId: 'op_valid_0002', baseRevision: 0, kind: 'undo', upserts: [{ id: 'a', data: { id: 'a', type: 'rect' } }], deletes: [] };
  let deep = { id: 'a', type: 'rect' };
  for (let level = 0; level < OPERATION_LIMITS.maxDepth + 2; level += 1) deep = { id: 'a', type: 'rect', child: deep };
  const cases = [
    null,
    [],
    { ...good, opId: 'short' },
    { ...good, opId: 'has spaces in it' },
    { ...good, baseRevision: -1 },
    { ...good, baseRevision: 1.5 },
    { ...good, baseRevision: '1' },
    { ...good, kind: 'delete' },
    { ...good, upserts: 'nope' },
    { ...good, upserts: [{ data: { id: 'a', type: 'rect' } }] },
    { ...good, upserts: [{ id: 'a', data: { id: 'b' } }] },
    { ...good, upserts: [{ id: 'a', data: { id: 'a', type: 'rect' } }, { id: 'a', data: { id: 'a', type: 'rect' } }] },
    { ...good, upserts: [{ id: 'a', data: { id: 'a', left: 1 } }] },
    { ...good, upserts: [{ id: 'a', data: { id: 'a', type: 'rect' }, unset: ['left'] }] },
    { ...good, upserts: [{ id: 'a', data: { id: 'a', type: 'rect' }, unset: ['__proto__'] }] },
    { ...good, deletes: ['a'] },
    { ...good, upserts: [{ id: 'a', data: { id: 'a', type: 'rect', metadata: { $where: 'sleep(1)' } } }] },
    { ...good, upserts: [{ id: 'a', data: JSON.parse('{"id":"a","type":"rect","__proto__":{"polluted":true}}') }] },
    { ...good, upserts: [{ id: 'a', data: { id: 'a', type: 'rect', constructor: { prototype: {} } } }] },
    { ...good, upserts: [{ id: 'a', data: deep }] },
    { ...good, order: ['a', 'a'] },
    { ...good, deletes: Array.from({ length: OPERATION_LIMITS.maxDeletes + 1 }, (_, index) => `d${index}`) },
    { opId: 'op_valid_0003', baseRevision: 0, kind: 'undo' }
  ];
  cases.forEach((payload, index) => {
    const result = validateCanvasOperation(payload);
    assert.equal(result.ok, false, `case ${index} should be rejected`);
    assert.equal(result.code, 'INVALID_OPERATION', `case ${index} code`);
  });
  const oversized = validateCanvasOperation({ ...good, upserts: [{ id: 'a', data: { id: 'a', type: 'rect', blob: 'x'.repeat(OPERATION_LIMITS.maxBytes) } }] });
  assert.deepEqual([oversized.ok, oversized.code], [false, 'OPERATION_TOO_LARGE']);
  assert.equal({}.polluted, undefined);
});

test('applyCanvasOperation replaces snapshots, removes fields and links, deletes and reorders', () => {
  const canvasData = { version: '7.4.0', background: 'transparent', objects: startingObjects() };
  const untouched = canvasData.objects[2];
  const result = applyCanvasOperation(canvasData, {
    upserts: [
      { id: 'text_a', data: { type: 'textbox', id: 'text_a', text: 'Detached', elementId: 'a', parentShapeId: 'shape_a' }, unset: ['parentShapeId'] },
      { id: 'shape_c', data: { type: 'rect', id: 'shape_c', metadata: { role: 'shape', nested: { keep: [1, { deep: true }] } } }, unset: [] }
    ],
    deletes: ['shape_a'],
    order: ['shape_c', 'shape_b', 'text_a']
  });
  assert.equal(result.ok, true);
  assert.equal(result.canvasData.background, 'transparent');
  assert.deepEqual(result.canvasData.objects.map((object) => object.id), ['shape_c', 'shape_b', 'text_a']);
  const text = result.canvasData.objects.find((object) => object.id === 'text_a');
  assert.equal(text.text, 'Detached');
  assert.equal('parentShapeId' in text, false);
  assert.deepEqual(result.canvasData.objects[0].metadata, { role: 'shape', nested: { keep: [1, { deep: true }] } });
  assert.equal(result.canvasData.objects[1], untouched);
  assert.deepEqual(canvasData.objects.map((object) => object.id), ['shape_a', 'text_a', 'shape_b']);

  const mismatch = applyCanvasOperation(canvasData, { upserts: [], deletes: [], order: ['shape_a', 'shape_b'] });
  assert.deepEqual(mismatch, { ok: false, code: 'ORDER_MISMATCH' });
});

test('operations commit in sequence and advance the board revision atomically', needsMongo, async () => {
  const boardId = await createBoard();
  const first = await commitCanvasOperation({ boardId, userId: ownerId, op: operation(0, { upserts: [{ id: 'shape_b', data: shape('shape_b', { left: 300 }), unset: [] }] }) });
  assert.deepEqual(first, { status: 'committed', revision: 1 });
  const second = await commitCanvasOperation({ boardId, userId: memberId, op: operation(1, { deletes: ['shape_b'] }) });
  assert.deepEqual(second, { status: 'committed', revision: 2 });

  const board = await stored(boardId);
  assert.equal(board.canvasRevision, 2);
  assert.equal(board.lastOperationRevision, 2);
  assert.deepEqual(board.recentOperations.map((entry) => entry.revision), [1, 2]);
  assert.deepEqual(board.canvasData.objects.map((object) => object.id), ['shape_a', 'text_a']);
  assert.equal(board.canvasData.objects[1].parentShapeId, 'shape_a');
});

test('a duplicate operation is acknowledged with its original revision and never applied twice', needsMongo, async () => {
  const boardId = await createBoard();
  const op = operation(0, { upserts: [{ id: 'shape_b', data: shape('shape_b', { left: 400 }), unset: [] }] });
  assert.deepEqual(await commitCanvasOperation({ boardId, userId: ownerId, op }), { status: 'committed', revision: 1 });
  const before = await stored(boardId);
  assert.deepEqual(await commitCanvasOperation({ boardId, userId: ownerId, op }), { status: 'duplicate', revision: 1 });
  const after = await stored(boardId);
  assert.equal(after.canvasRevision, 1);
  assert.deepEqual(after.canvasData, before.canvasData);
  assert.equal(after.recentOperations.length, 1);
});

test('a stale operation is rejected with the current revision and changes nothing', needsMongo, async () => {
  const boardId = await createBoard();
  await commitCanvasOperation({ boardId, userId: ownerId, op: operation(0, { deletes: ['shape_b'] }) });
  const before = await stored(boardId);
  const stale = await commitCanvasOperation({ boardId, userId: ownerId, op: operation(0, { deletes: ['shape_a'] }) });
  assert.deepEqual(stale, { status: 'stale', currentRevision: 1 });
  assert.deepEqual((await stored(boardId)).canvasData, before.canvasData);
});

test('only owners and members can commit, and deleted boards are not found', needsMongo, async () => {
  const boardId = await createBoard();
  assert.deepEqual(await commitCanvasOperation({ boardId, userId: strangerId, op: operation(0, { deletes: ['shape_b'] }) }), { status: 'forbidden' });
  assert.equal((await stored(boardId)).canvasRevision, 0);
  await Board.updateOne({ _id: boardId }, { $set: { isDeleted: true } });
  assert.deepEqual(await commitCanvasOperation({ boardId, userId: ownerId, op: operation(0, { deletes: ['shape_b'] }) }), { status: 'not_found' });
});

test('concurrent operations on the same revision commit exactly once', needsMongo, async () => {
  const boardId = await createBoard();
  const contenders = Array.from({ length: 8 }, (_, index) => operation(0, { upserts: [{ id: 'shape_b', data: shape('shape_b', { left: 1000 + index }), unset: [] }] }));
  const results = await Promise.all(contenders.map((op) => commitCanvasOperation({ boardId, userId: ownerId, op })));
  const committed = results.filter((result) => result.status === 'committed');
  assert.equal(committed.length, 1);
  assert.ok(results.filter((result) => result.status !== 'committed').every((result) => result.status === 'stale' && result.currentRevision === 1));
  const board = await stored(boardId);
  assert.equal(board.canvasRevision, 1);
  const winner = contenders[results.indexOf(committed[0])];
  assert.equal(board.canvasData.objects.find((object) => object.id === 'shape_b').left, winner.upserts[0].data.left);
});

test('boards saved before revisions existed start at revision zero', needsMongo, async () => {
  const { insertedId } = await Board.collection.insertOne({ owner: ownerId, members: [], title: 'legacy', canvasData: { version: '6.5.1', objects: startingObjects() }, isDeleted: false, isArchived: false });
  const boardId = insertedId.toString();
  assert.equal('canvasRevision' in (await Board.collection.findOne({ _id: insertedId })), false);
  const result = await commitCanvasOperation({ boardId, userId: ownerId, op: operation(0, { deletes: ['shape_b'] }) });
  assert.deepEqual(result, { status: 'committed', revision: 1 });
});

test('with the flag on, unversioned canvas saves are refused on every board without writing', needsMongo, async () => {
  const boardId = await createBoard();
  const fresh = await stored(boardId);
  await assert.rejects(
    boardService.updateBoard(boardId, ownerId, { canvasData: { version: '7.4.0', objects: [shape('shape_x')] } }),
    (err) => err.statusCode === 409 && err.code === 'REVISION_REQUIRED' && err.currentRevision === 0
  );
  assert.deepEqual((await stored(boardId)).canvasData, fresh.canvasData);
  const first = await boardService.updateBoard(boardId, memberId, { baseRevision: 0, canvasData: { version: '7.4.0', objects: [shape('shape_x'), shape('shape_y')] } });
  assert.equal(first.canvasRevision, 1);

  await commitCanvasOperation({ boardId, userId: ownerId, op: operation(1, { deletes: ['shape_y'] }) });
  const before = await stored(boardId);
  await assert.rejects(
    boardService.updateBoard(boardId, ownerId, { canvasData: { version: '7.4.0', objects: [] } }),
    (err) => err.statusCode === 409 && err.code === 'REVISION_REQUIRED' && err.currentRevision === 2
  );
  assert.deepEqual((await stored(boardId)).canvasData, before.canvasData);
  const renamed = await boardService.updateBoard(boardId, ownerId, { title: 'Metadata only' });
  assert.equal(renamed.title, 'Metadata only');
  assert.equal((await stored(boardId)).canvasRevision, 2);
});

test('revision-aware saves compare and set, and stale saves get 409 without writing', needsMongo, async () => {
  const boardId = await createBoard();
  const saved = await boardService.updateBoard(boardId, ownerId, { baseRevision: 0, canvasData: { version: '7.4.0', objects: [shape('shape_x')] } });
  assert.equal(saved.canvasRevision, 1);
  const before = await stored(boardId);
  await assert.rejects(
    boardService.updateBoard(boardId, ownerId, { baseRevision: 0, canvasData: { version: '7.4.0', objects: [] } }),
    (err) => err.statusCode === 409 && err.code === 'STALE_REVISION' && err.currentRevision === 1
  );
  assert.deepEqual((await stored(boardId)).canvasData, before.canvasData);
});

test('board updates ignore revision, ownership and deletion fields sent by clients', needsMongo, async () => {
  const boardId = await createBoard();
  const saved = await boardService.updateBoard(boardId, ownerId, {
    baseRevision: 0,
    canvasData: { version: '7.4.0', objects: [shape('shape_x')] },
    canvasRevision: 99,
    lastOperationRevision: 0,
    recentOperations: [{ opId: 'op_forged_0001', revision: 50 }],
    isDeleted: true,
    owner: strangerId.toString(),
    title: '  Renamed  '
  });
  const board = await stored(boardId);
  assert.equal(saved.canvasRevision, 1);
  assert.equal(board.canvasRevision, 1);
  assert.equal(board.isDeleted, false);
  assert.equal(board.owner.toString(), ownerId.toString());
  assert.deepEqual(board.recentOperations, []);
  assert.equal(board.title, 'Renamed');
});

test('a legacy save racing a committed operation never lets both succeed', needsMongo, async () => {
  for (let round = 0; round < 5; round += 1) {
    const boardId = await createBoard();
    const [save, commit] = await Promise.allSettled([
      boardService.updateBoard(boardId, ownerId, { canvasData: { version: '7.4.0', objects: [shape('shape_x')] } }),
      commitCanvasOperation({ boardId, userId: memberId, op: operation(0, { deletes: ['shape_b'] }) })
    ]);
    const saveWon = save.status === 'fulfilled';
    const opWon = commit.status === 'fulfilled' && commit.value.status === 'committed';
    assert.equal(Number(saveWon) + Number(opWon), 1, `round ${round}`);
    const board = await stored(boardId);
    assert.equal(board.canvasRevision, 1);
    assert.deepEqual(board.canvasData.objects.map((object) => object.id), saveWon ? ['shape_x'] : ['shape_a', 'text_a']);
  }
});

test('the canvas:op socket handler acknowledges, broadcasts once and reports explicit failures', needsMongo, async () => {
  const boardId = await createBoard();
  const sender = fakeSocket(ownerId, boardId);
  const payload = { boardId, ...operation(0, { kind: 'apply', upserts: [{ id: 'shape_b', data: shape('shape_b', { left: 77 }), unset: ['elementId'] }], order: ['shape_b', 'shape_a', 'text_a'] }) };

  assert.deepEqual(await sender.send(payload), { ok: true, revision: 1 });
  assert.equal(sender.broadcasts.length, 1);
  assert.deepEqual(sender.broadcasts[0], {
    room: boardRoomName(boardId),
    event: 'canvas:op-committed',
    data: {
      boardId,
      opId: payload.opId,
      revision: 1,
      baseRevision: 0,
      op: { kind: 'apply', upserts: payload.upserts, deletes: [], order: payload.order },
      senderSocketId: sender.socket.id
    }
  });
  assert.deepEqual(await storedIds(boardId), ['shape_b', 'shape_a', 'text_a']);
  assert.equal('elementId' in (await stored(boardId)).canvasData.objects[0], false);

  assert.deepEqual(await sender.send(payload), { ok: true, duplicate: true, revision: 1 });
  assert.equal(sender.broadcasts.length, 1);
  assert.deepEqual(await sender.send({ boardId, ...operation(0, { deletes: ['shape_a'] }) }), { ok: false, code: 'STALE_REVISION', currentRevision: 1 });
  assert.deepEqual(await sender.send({ boardId, ...operation(1, { order: ['shape_a'] }) }), { ok: false, code: 'ORDER_MISMATCH', currentRevision: 1 });
  assert.deepEqual(await sender.send({ boardId, opId: 'bad id' }), { ok: false, code: 'INVALID_OPERATION' });
  assert.deepEqual(await sender.send({ ...payload, boardId: 'not-an-object-id' }), { ok: false, code: 'INVALID_OPERATION' });
  assert.deepEqual(await fakeSocket(ownerId, boardId, { joined: false }).send({ boardId, ...operation(1, { deletes: ['shape_a'] }) }), { ok: false, code: 'NOT_IN_ROOM' });
  assert.deepEqual(await fakeSocket(strangerId, boardId).send({ boardId, ...operation(1, { deletes: ['shape_a'] }) }), { ok: false, code: 'FORBIDDEN' });
  assert.equal(sender.broadcasts.length, 1);
  assert.equal((await stored(boardId)).canvasRevision, 1);
});

test('the canvas:op handler rate-limits each socket', needsMongo, async () => {
  const boardId = await createBoard();
  const client = fakeSocket(ownerId, boardId);
  const replies = [];
  for (let index = 0; index <= OPERATION_RATE_LIMIT.limit; index += 1) {
    replies.push(await client.send({ boardId, opId: 'bad id' }));
  }
  assert.ok(replies.slice(0, OPERATION_RATE_LIMIT.limit).every((reply) => reply.code === 'INVALID_OPERATION'));
  assert.deepEqual(replies[OPERATION_RATE_LIMIT.limit], { ok: false, code: 'RATE_LIMITED' });
});

test('the board PATCH controller returns 409 bodies and announces each saved revision', needsMongo, async () => {
  const boardId = await createBoard();
  emitted.length = 0;
  const ok = fakeResponse();
  await boardController.update({ user: { id: ownerId.toString() }, params: { id: boardId }, body: { baseRevision: 0, canvasData: { version: '7.4.0', objects: [] } } }, ok, (err) => { throw err; });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.data.board.canvasRevision, 1);
  assert.deepEqual(emitted, [{ room: boardRoomName(boardId), event: 'board:revision', data: { boardId, revision: 1, source: 'save' } }]);

  const conflict = fakeResponse();
  await boardController.update({ user: { id: ownerId.toString() }, params: { id: boardId }, body: { baseRevision: 0, canvasData: { version: '7.4.0', objects: [] } } }, conflict, (err) => { throw err; });
  assert.equal(conflict.statusCode, 409);
  assert.deepEqual(conflict.body, { success: false, message: 'The board changed since this version was loaded', errors: { code: 'STALE_REVISION', currentRevision: 1 } });
  assert.equal(emitted.length, 1);

  const rename = fakeResponse();
  await boardController.update({ user: { id: ownerId.toString() }, params: { id: boardId }, body: { title: 'Only a title' } }, rename, (err) => { throw err; });
  assert.equal(rename.statusCode, 200);
  assert.equal(emitted.length, 1);
  assert.equal((await stored(boardId)).canvasRevision, 1);
});

test('with the protocol flag off, operations and revision-aware saves are refused and legacy saves keep working', needsMongo, async () => {
  const boardId = await createBoard();
  config.collabOperationsEnabled = false;
  try {
    assert.deepEqual(await fakeSocket(ownerId, boardId).send({ boardId, ...operation(0, { deletes: ['shape_b'] }) }), { ok: false, code: 'OPERATIONS_DISABLED' });
    await assert.rejects(
      boardService.updateBoard(boardId, ownerId, { baseRevision: 0, canvasData: { version: '7.4.0', objects: [] } }),
      (err) => err.statusCode === 400 && err.code === 'REVISION_PROTOCOL_DISABLED'
    );
    const refused = fakeResponse();
    await boardController.update({ user: { id: ownerId.toString() }, params: { id: boardId }, body: { baseRevision: 0, canvasData: { version: '7.4.0', objects: [] } } }, refused, (err) => { throw err; });
    assert.equal(refused.statusCode, 400);
    assert.deepEqual(refused.body.errors, { code: 'REVISION_PROTOCOL_DISABLED' });
    const legacy = await boardService.updateBoard(boardId, ownerId, { canvasData: { version: '7.4.0', objects: [shape('shape_x')] } });
    assert.equal(legacy.canvasRevision, 1);
    assert.equal((await stored(boardId)).lastOperationRevision, 0);
  } finally {
    config.collabOperationsEnabled = true;
  }
});

test('a revision-aware save also switches the board to revision-required saves', needsMongo, async () => {
  const boardId = await createBoard();
  await boardService.updateBoard(boardId, ownerId, { baseRevision: 0, canvasData: { version: '7.4.0', objects: [shape('shape_x')] } });
  const before = await stored(boardId);
  assert.equal(before.lastOperationRevision, 1);
  await assert.rejects(
    boardService.updateBoard(boardId, memberId, { canvasData: { version: '7.4.0', objects: [] } }),
    (err) => err.statusCode === 409 && err.code === 'REVISION_REQUIRED' && err.currentRevision === 1
  );
  assert.deepEqual((await stored(boardId)).canvasData, before.canvasData);
});

test('the operation log is not loaded by ordinary board reads', needsMongo, async () => {
  const boardId = await createBoard();
  await commitCanvasOperation({ boardId, userId: ownerId, op: operation(0, { deletes: ['shape_b'] }) });
  const ordinary = await Board.findById(boardId).lean();
  assert.equal('recentOperations' in ordinary, false);
  assert.equal((await stored(boardId)).recentOperations.length, 1);
});

test('with the flag off, plain saves work again on a board that was switched, so the flag can be rolled back', needsMongo, async () => {
  const boardId = await createBoard();
  await commitCanvasOperation({ boardId, userId: ownerId, op: operation(0, { deletes: ['shape_b'] }) });
  config.collabOperationsEnabled = false;
  try {
    const saved = await boardService.updateBoard(boardId, ownerId, { canvasData: { version: '7.4.0', objects: [shape('shape_x')] } });
    assert.equal(saved.canvasRevision, 2);
    assert.deepEqual(await storedIds(boardId), ['shape_x']);
  } finally {
    config.collabOperationsEnabled = true;
  }
});

test('board fetches report whether collaboration operations are enabled', needsMongo, async () => {
  const viewer = await User.create({ name: 'Fetch Owner', email: `fetch_owner_${Date.now()}@example.test`, password: 'not-a-real-password-1' });
  const created = await Board.create({ owner: viewer._id, members: [], title: 'fetch test', canvasData: { version: '7.4.0', objects: startingObjects() } });
  const boardId = created._id.toString();
  const viewerId = viewer._id.toString();
  const fetchWith = async (flag) => {
    config.collabOperationsEnabled = flag;
    const res = fakeResponse();
    await boardController.getById({ user: { id: viewerId }, params: { id: boardId } }, res, (err) => { throw err; });
    return res.body.data.collaboration;
  };
  try {
    assert.deepEqual(await fetchWith(true), { operationsEnabled: true });
    assert.deepEqual(await fetchWith(false), { operationsEnabled: false });
  } finally {
    config.collabOperationsEnabled = true;
  }
});
