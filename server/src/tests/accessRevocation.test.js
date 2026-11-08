import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { io as connectClient } from 'socket.io-client';
import config from '../config/env.js';
import Board from '../models/Board.js';
import User from '../models/User.js';
import boardController from '../controllers/board.controller.js';
import boardRepository from '../repositories/board.repository.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { initSocketIO } from '../sockets/index.js';
import { boardRoomName } from '../sockets/boardHandlers.js';
import { MIN_PRODUCTION_JWT_SECRET_LENGTH, assertJwtSecret, generateAccessToken, verifyAccessToken } from '../utils/jwt.js';
import { COOKIE_NAME } from '../utils/cookieOptions.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEST_SECRET = 'skribe-test-only-jwt-secret-for-revocation-tests-0001';
const TEST_DB_NAME = `skribe_revocation_test_${process.pid}_${Date.now()}`;
const TEST_MONGO_BASE = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
config.jwtSecret = TEST_SECRET;
const originalCollabFlag = config.collabOperationsEnabled;
config.collabOperationsEnabled = true;

let mongoAvailable = false;
try {
  await mongoose.connect(`${TEST_MONGO_BASE}/${TEST_DB_NAME}`, { serverSelectionTimeoutMS: 1500 });
  mongoAvailable = true;
} catch {
  mongoAvailable = false;
}
const needsMongo = { skip: mongoAvailable ? false : `MongoDB is not reachable at ${TEST_MONGO_BASE}` };

const httpServer = http.createServer();
const io = initSocketIO(httpServer);
await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
const port = httpServer.address().port;
const clients = [];

test.after(async () => {
  config.collabOperationsEnabled = originalCollabFlag;
  clients.forEach((client) => client.disconnect());
  io.close();
  await new Promise((resolve) => httpServer.close(resolve));
  if (mongoAvailable && mongoose.connection.name === TEST_DB_NAME) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const fakeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

const runServer = (env, waitFor = null) => new Promise((resolve) => {
  const child = spawn(process.execPath, ['src/server.js'], { cwd: SERVER_DIR, windowsHide: true, env: { ...process.env, PORT: '0', MONGODB_URI: `${TEST_MONGO_BASE}/${TEST_DB_NAME}_startup`, ...env } });
  let output = '';
  let started = false;
  const finish = (exitCode) => resolve({ exitCode, started, output });
  const timer = setTimeout(() => { child.kill(); }, 20000);
  const onData = (chunk) => {
    output += chunk;
    if (waitFor && !started && output.includes(waitFor)) {
      started = true;
      child.kill();
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => { clearTimeout(timer); finish(code); });
});

test('the JWT secret must be set, and production refuses placeholders and short secrets', () => {
  for (const missing of ['', '   ', null]) assert.throws(() => assertJwtSecret(missing, { production: false }), /JWT_SECRET is not set/);
  assert.throws(() => assertJwtSecret('fallback_jwt_secret_dev_key', { production: true }), /placeholder/);
  assert.throws(() => assertJwtSecret('a'.repeat(MIN_PRODUCTION_JWT_SECRET_LENGTH - 1), { production: true }), /at least 32/);
  assert.equal(assertJwtSecret('a'.repeat(MIN_PRODUCTION_JWT_SECRET_LENGTH), { production: true }), true);
  assert.equal(assertJwtSecret('local-dev-secret', { production: false }), true);
});

test('tokens verify only with the configured secret, and a token signed with any other secret cannot authenticate', async () => {
  const token = generateAccessToken({ id: new mongoose.Types.ObjectId().toString() });
  assert.ok(verifyAccessToken(token).id);
  assert.equal(jwt.verify(token, TEST_SECRET).id, verifyAccessToken(token).id);
  for (const forged of [jwt.sign({ id: new mongoose.Types.ObjectId().toString() }, 'fallback_jwt_secret_dev_key'), jwt.sign({ id: new mongoose.Types.ObjectId().toString() }, `${TEST_SECRET}x`)]) {
    assert.throws(() => verifyAccessToken(forged), /invalid signature/);
    const res = fakeResponse();
    await authenticate({ cookies: { [COOKIE_NAME]: forged }, headers: {} }, res, () => assert.fail('a forged token must not authenticate'));
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.errors.code, 'UNAUTHENTICATED');
  }
  config.jwtSecret = '';
  try {
    assert.throws(() => generateAccessToken({ id: 'x' }), /JWT_SECRET is not set/);
    assert.throws(() => verifyAccessToken(token), /JWT_SECRET is not set/);
  } finally {
    config.jwtSecret = TEST_SECRET;
  }
});

test('the server refuses to start without a valid secret and starts with one, never printing it', needsMongo, async () => {
  const missing = await runServer({ JWT_SECRET: '', NODE_ENV: 'test' });
  assert.equal(missing.exitCode, 1);
  assert.match(missing.output, /\[ServerStartError\] JWT_SECRET is not set/);
  assert.equal(missing.output.includes('Server running'), false);
  const weak = 'short-production-secret';
  const production = await runServer({ JWT_SECRET: weak, NODE_ENV: 'production' });
  assert.equal(production.exitCode, 1);
  assert.match(production.output, /at least 32 characters in production/);
  assert.equal(production.output.includes(weak), false);
  const strong = `strong-${'k'.repeat(40)}`;
  const valid = await runServer({ JWT_SECRET: strong, NODE_ENV: 'test' }, 'Server running');
  assert.equal(valid.started, true);
  assert.equal(valid.output.includes(strong), false);
  assert.equal(valid.output.includes('ServerStartError'), false);
});

const connectAs = async (userId) => {
  const client = connectClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { cookie: `${COOKIE_NAME}=${generateAccessToken({ id: String(userId) })}` } });
  clients.push(client);
  await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
  return client;
};
const nextEvent = (client, event, predicate = () => true, ms = 3000) => new Promise((resolve) => {
  const handler = (payload) => {
    if (!predicate(payload)) return;
    clearTimeout(timer);
    client.off(event, handler);
    resolve(payload);
  };
  const timer = setTimeout(() => { client.off(event, handler); resolve(null); }, ms);
  client.on(event, handler);
});
const join = async (client, boardId) => {
  const joined = nextEvent(client, 'board-joined', (e) => e?.boardId === boardId);
  const refused = nextEvent(client, 'board-error', (e) => e?.event === 'join-board');
  const revoked = nextEvent(client, 'board:access-revoked', (e) => e?.boardId === boardId);
  client.emit('join-board', { boardId });
  return Promise.race([joined.then((e) => (e ? 'joined' : null)), refused.then((e) => (e ? `refused: ${e.message}` : null)), revoked.then((e) => (e ? 'revoked' : null))].map((p) => p.then((v) => v || new Promise(() => {})))).catch(() => null);
};
const inRoom = (client, boardId) => Boolean(io.sockets.sockets.get(client.id)?.rooms.has(boardRoomName(boardId)));
const relay = (sender, boardId, objectId) => sender.emit('canvas:object-added', { boardId, objectId, objectData: { id: objectId, type: 'rect' } });
const receives = (client, boardId, objectId, ms = 600) => nextEvent(client, 'canvas:object-added', (e) => e?.boardId === boardId && e?.objectId === objectId, ms).then(Boolean);
const remove = async (boardId, ownerId, collaboratorId) => {
  const res = fakeResponse();
  await boardController.removeCollaborator({ user: { id: String(ownerId) }, params: { id: boardId, userId: String(collaboratorId) } }, res, (err) => { throw err; });
  return res;
};

test('removing a collaborator cuts their live sessions off that board at once, without touching anyone else', needsMongo, async () => {
  const [owner, member, removed] = await Promise.all(['Owner Person', 'Member Person', 'Removed Person'].map((name, i) => User.create({ name, email: `rev_${i}_${Date.now()}@test.local`, password: 'password123' })));
  const boardA = String((await Board.create({ owner: owner._id, members: [member._id, removed._id], title: 'A', canvasData: { objects: [] } }))._id);
  const boardB = String((await Board.create({ owner: owner._id, members: [removed._id], title: 'B', canvasData: { objects: [] } }))._id);
  const ownerSocket = await connectAs(owner._id);
  const memberSocket = await connectAs(member._id);
  const removedSocket = await connectAs(removed._id);
  assert.equal(await join(ownerSocket, boardA), 'joined');
  assert.equal(await join(ownerSocket, boardB), 'joined');
  assert.equal(await join(memberSocket, boardA), 'joined');
  assert.equal(await join(removedSocket, boardA), 'joined');
  assert.equal(await join(removedSocket, boardB), 'joined');

  const before = [receives(memberSocket, boardA, 'pre'), receives(removedSocket, boardA, 'pre')];
  relay(ownerSocket, boardA, 'pre');
  assert.deepEqual(await Promise.all(before), [true, true]);

  const revokedNotice = nextEvent(removedSocket, 'board:access-revoked', (e) => e?.boardId === boardA);
  const leftNotice = nextEvent(memberSocket, 'board:user:left', (e) => e?.boardId === boardA);
  const res = await remove(boardA, owner._id, removed._id);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(await revokedNotice, { boardId: boardA });
  assert.equal(inRoom(removedSocket, boardA), false);
  assert.equal(inRoom(removedSocket, boardB), true);
  assert.equal(String((await leftNotice)?.user?.id ?? (await leftNotice)?.userId ?? ''), String(removed._id));

  const after = [receives(memberSocket, boardA, 'post'), receives(removedSocket, boardA, 'post')];
  relay(ownerSocket, boardA, 'post');
  assert.deepEqual(await Promise.all(after), [true, false]);

  const opSeenByMember = nextEvent(memberSocket, 'canvas:op-committed', (e) => e?.boardId === boardA);
  const opSeenByRemoved = nextEvent(removedSocket, 'canvas:op-committed', (e) => e?.boardId === boardA, 800);
  const ack = await new Promise((resolve) => ownerSocket.emit('canvas:op', { boardId: boardA, opId: `op_rev_${Date.now()}`, baseRevision: 0, kind: 'edit', upserts: [{ id: 'shape_x', data: { id: 'shape_x', type: 'rect', left: 1, top: 1, width: 5, height: 5 }, unset: [] }], deletes: [] }, resolve));
  assert.equal(ack.ok, true);
  assert.ok(await opSeenByMember);
  assert.equal(await opSeenByRemoved, null);

  assert.match(await join(removedSocket, boardA), /^refused: You do not have permission/);
  assert.equal(inRoom(removedSocket, boardA), false);
  const freshSocket = await connectAs(removed._id);
  assert.match(await join(freshSocket, boardA), /^refused: You do not have permission/);
  assert.equal(inRoom(freshSocket, boardA), false);

  const otherBoard = receives(removedSocket, boardB, 'b-still');
  relay(ownerSocket, boardB, 'b-still');
  assert.equal(await otherBoard, true);
  assert.equal(await join(freshSocket, boardB), 'joined');
  assert.equal(inRoom(ownerSocket, boardA), true);
  assert.equal(inRoom(memberSocket, boardA), true);
});

test('a join already in flight when the collaborator is removed does not leave them in the room', needsMongo, async () => {
  const [owner, removed] = await Promise.all(['Race Owner', 'Race Removed'].map((name, i) => User.create({ name, email: `race_${i}_${Date.now()}@test.local`, password: 'password123' })));
  const board = String((await Board.create({ owner: owner._id, members: [removed._id], title: 'Race', canvasData: { objects: [] } }))._id);
  const socket = await connectAs(removed._id);
  const original = boardRepository.findBoardById;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let staleReadDone;
  const staleRead = new Promise((resolve) => { staleReadDone = resolve; });
  let armed = true;
  boardRepository.findBoardById = async (id) => {
    if (!armed) return original.call(boardRepository, id);
    armed = false;
    const stale = await original.call(boardRepository, id);
    staleReadDone();
    await gate;
    return stale;
  };
  try {
    const outcome = join(socket, board);
    await staleRead;
    assert.equal((await remove(board, owner._id, removed._id)).statusCode, 200);
    release();
    assert.equal(await outcome, 'revoked');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(inRoom(socket, board), false);
  } finally {
    boardRepository.findBoardById = original;
  }
});
