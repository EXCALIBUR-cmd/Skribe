import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import app from '../app.js';
import Board from '../models/Board.js';
import User from '../models/User.js';
import boardService from '../services/board.service.js';
import { generateAccessToken } from '../utils/jwt.js';
import { initSocketIO } from '../sockets/index.js';
import { boardRoomName } from '../sockets/boardHandlers.js';
import { CANVAS_BACKGROUNDS, DEFAULT_PREFERENCES } from '../constants/preferences.js';

const TEST_DB_NAME = `skribe_preferences_test_${process.pid}_${Date.now()}`;
const TEST_MONGO_BASE = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
let mongoAvailable = false;
try {
  await mongoose.connect(`${TEST_MONGO_BASE}/${TEST_DB_NAME}`, { serverSelectionTimeoutMS: 1500 });
  mongoAvailable = true;
} catch {
  mongoAvailable = false;
}
const needsMongo = { skip: mongoAvailable ? false : `MongoDB is not reachable at ${TEST_MONGO_BASE}` };

const io = initSocketIO(http.createServer());
const emitted = [];
io.to = (room) => ({ emit: (event, data) => emitted.push({ room, event, data }) });

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v1`;

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  io.close();
  if (mongoAvailable && mongoose.connection.name === TEST_DB_NAME) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});

let userCounter = 0;
const createUser = async () => {
  userCounter += 1;
  const user = await User.create({ name: `Pref User ${userCounter}`, email: `pref${userCounter}_${Date.now()}@example.com`, password: 'hashed-not-used' });
  return { user, token: generateAccessToken({ id: user.id, email: user.email }) };
};

const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const createBoard = (ownerId, members = []) => Board.create({ owner: ownerId, members, title: 'pref board', canvasData: { version: '7.4.0', objects: [{ type: 'rect', id: 'shape_a', fill: '#000000', stroke: '#1e293b', left: 1, top: 2 }] } });

test('a new user gets the default preferences from /auth/me', needsMongo, async () => {
  const { token } = await createUser();
  const res = await call('/auth/me', { token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.user.preferences, DEFAULT_PREFERENCES);
});

test('a legacy user document without preferences reads back the defaults', needsMongo, async () => {
  const { insertedId } = await User.collection.insertOne({ name: 'Legacy', email: `legacy_${Date.now()}@example.com`, provider: 'local', password: 'x' });
  const legacy = await User.findById(insertedId);
  assert.deepEqual(legacy.toJSON().preferences, DEFAULT_PREFERENCES);
});

test('preferences update persists and only affects the authenticated user', needsMongo, async () => {
  const alice = await createUser();
  const bob = await createUser();
  const res = await call('/auth/me/preferences', { method: 'PATCH', token: alice.token, body: { appearance: 'dark', language: 'hi', landingPage: 'lastBoard', reduceMotion: true } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.preferences, { appearance: 'dark', language: 'hi', landingPage: 'lastBoard', reduceMotion: true });

  const aliceStored = await User.findById(alice.user._id).lean();
  const bobStored = await User.findById(bob.user._id).lean();
  assert.equal(aliceStored.preferences.appearance, 'dark');
  assert.equal(bobStored.preferences?.appearance ?? DEFAULT_PREFERENCES.appearance, 'system');

  const partial = await call('/auth/me/preferences', { method: 'PATCH', token: alice.token, body: { appearance: 'light' } });
  assert.deepEqual(partial.body.data.preferences, { appearance: 'light', language: 'hi', landingPage: 'lastBoard', reduceMotion: true });
});

test('a client-supplied user id in the payload cannot redirect the update to another user', needsMongo, async () => {
  const alice = await createUser();
  const bob = await createUser();
  const res = await call('/auth/me/preferences', { method: 'PATCH', token: alice.token, body: { appearance: 'dark', userId: bob.user.id } });
  assert.equal(res.status, 400);
  assert.equal((await User.findById(bob.user._id).lean()).preferences?.appearance ?? 'system', 'system');
});

test('invalid preference payloads are rejected without changing anything', needsMongo, async () => {
  const { user, token } = await createUser();
  const cases = [
    { appearance: 'sepia' },
    { language: 'fr' },
    { landingPage: '/admin' },
    { reduceMotion: 'yes' },
    { unknown: true },
    {},
    ['appearance']
  ];
  for (const body of cases) {
    const res = await call('/auth/me/preferences', { method: 'PATCH', token, body });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
  assert.deepEqual((await User.findById(user._id)).toJSON().preferences, DEFAULT_PREFERENCES);
});

test('preference endpoints require authentication', needsMongo, async () => {
  assert.equal((await call('/auth/me/preferences', { method: 'PATCH', body: { appearance: 'dark' } })).status, 401);
  assert.equal((await call('/auth/me/landing')).status, 401);
  const expired = jwt.sign({ id: new mongoose.Types.ObjectId().toString() }, config.jwtSecret, { expiresIn: -10 });
  assert.equal((await call('/auth/me/preferences', { method: 'PATCH', token: expired, body: { appearance: 'dark' } })).status, 401);
});

test('opening a board records it as the user\'s last opened board', needsMongo, async () => {
  const { user, token } = await createUser();
  const board = await createBoard(user._id);
  const res = await call(`/boards/${board.id}`, { token });
  assert.equal(res.status, 200);
  assert.equal(String((await User.findById(user._id).lean()).lastOpenedBoard), board.id);
});

test('landing resolves to the last opened board only when it is preferred, exists and is accessible', needsMongo, async () => {
  const { user, token } = await createUser();
  const other = await createUser();
  const own = await createBoard(user._id);
  await call(`/boards/${own.id}`, { token });

  assert.equal((await call('/auth/me/landing', { token })).body.data.path, '/boards');

  await call('/auth/me/preferences', { method: 'PATCH', token, body: { landingPage: 'lastBoard' } });
  assert.equal((await call('/auth/me/landing', { token })).body.data.path, `/board/${own.id}`);

  await Board.updateOne({ _id: own._id }, { isDeleted: true });
  assert.equal((await call('/auth/me/landing', { token })).body.data.path, '/boards');

  const shared = await createBoard(other.user._id, [user._id]);
  await call(`/boards/${shared.id}`, { token });
  assert.equal((await call('/auth/me/landing', { token })).body.data.path, `/board/${shared.id}`);

  await Board.updateOne({ _id: shared._id }, { members: [] });
  assert.equal((await call('/auth/me/landing', { token })).body.data.path, '/boards');

  const fresh = await createUser();
  await call('/auth/me/preferences', { method: 'PATCH', token: fresh.token, body: { landingPage: 'lastBoard' } });
  assert.equal((await call('/auth/me/landing', { token: fresh.token })).body.data.path, '/boards');
});

test('every palette background persists on the board, broadcasts to the room and leaves canvas data untouched', needsMongo, async () => {
  const owner = await createUser();
  const member = await createUser();
  const board = await createBoard(owner.user._id, [member.user._id]);
  const before = await Board.findById(board._id).lean();

  for (const key of CANVAS_BACKGROUNDS) {
    emitted.length = 0;
    const res = await call(`/boards/${board.id}`, { method: 'PATCH', token: member.token, body: { canvasBackground: key } });
    assert.equal(res.status, 200, key);
    assert.equal(res.body.data.board.canvasBackground, key);
    assert.deepEqual(emitted, [{ room: boardRoomName(board.id), event: 'board:preferences', data: { boardId: board.id, canvasBackground: key } }]);
  }

  const after = await Board.findById(board._id).lean();
  assert.deepEqual(after.canvasData, before.canvasData);
  assert.equal(after.canvasRevision, before.canvasRevision);
  assert.equal((await call(`/boards/${board.id}`, { token: owner.token })).body.data.board.canvasBackground, CANVAS_BACKGROUNDS.at(-1));
});

test('invalid or unauthorised background changes are refused', needsMongo, async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const board = await createBoard(owner.user._id);
  emitted.length = 0;

  assert.equal((await call(`/boards/${board.id}`, { method: 'PATCH', token: owner.token, body: { canvasBackground: '#ff0000' } })).status, 400);
  await assert.rejects(boardService.updateBoard(board.id, stranger.user.id, { canvasBackground: 'midnight' }), { statusCode: 403 });
  assert.equal((await Board.findById(board._id).lean()).canvasBackground, 'default');
  assert.deepEqual(emitted, []);
});
