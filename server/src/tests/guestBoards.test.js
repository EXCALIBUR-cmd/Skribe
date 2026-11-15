import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { io as connectClient } from 'socket.io-client';
import config from '../config/env.js';
import app from '../app.js';
import Board, { ensureGuestBoardIndexes } from '../models/Board.js';
import User from '../models/User.js';
import boardService from '../services/board.service.js';
import { initSocketIO } from '../sockets/index.js';
import { guestBoardAddressLimiter } from '../middleware/rateLimit.middleware.js';
import { generateAccessToken } from '../utils/jwt.js';
import { COOKIE_NAME } from '../utils/cookieOptions.js';

const TEST_SECRET = 'skribe-test-only-jwt-secret-for-guest-board-tests-0001';
const TEST_DB_NAME = `skribe_guest_test_${process.pid}_${Date.now()}`;
const TEST_MONGO_BASE = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
config.jwtSecret = TEST_SECRET;
const originalCollabFlag = config.collabOperationsEnabled;
config.collabOperationsEnabled = true;

let mongoAvailable = false;
try {
  await mongoose.connect(`${TEST_MONGO_BASE}/${TEST_DB_NAME}`, { serverSelectionTimeoutMS: 1500, autoIndex: false });
  mongoAvailable = true;
} catch {
  mongoAvailable = false;
}
const needsMongo = { skip: mongoAvailable ? false : `MongoDB is not reachable at ${TEST_MONGO_BASE}` };
if (mongoAvailable) await ensureGuestBoardIndexes();

const httpServer = http.createServer(app);
const io = initSocketIO(httpServer);
await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${httpServer.address().port}`;
const clients = [];

test.after(async () => {
  config.collabOperationsEnabled = originalCollabFlag;
  clients.forEach((client) => client.disconnect());
  io.close();
  await new Promise((resolve) => httpServer.close(resolve));
  if (mongoAvailable && mongoose.connection.name === TEST_DB_NAME) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test.beforeEach(() => guestBoardAddressLimiter.reset());

const call = async (method, path, { token, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.cookie = `${COOKIE_NAME}=${token}`;
  const res = await fetch(`${base}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return { status: res.status, body: await res.json().catch(() => null), setCookie, token: match ? match[1] : null };
};

const startGuest = (token) => call('POST', '/auth/guest', { token });

const makeUser = async (label) => {
  const user = await User.create({ name: label, email: `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.com`, password: 'Verify12345!' });
  return { user, token: generateAccessToken({ id: String(user._id) }) };
};

const connectWith = async (token) => {
  const client = connectClient(base, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { cookie: `${COOKIE_NAME}=${token}` } });
  clients.push(client);
  await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
  return client;
};

const join = (client, boardId) => new Promise((resolve) => {
  const done = (value) => { clearTimeout(timer); client.off('board-joined', onJoined); client.off('board-error', onError); resolve(value); };
  const onJoined = (event) => { if (event?.boardId === boardId) done('joined'); };
  const onError = (event) => { if (event?.event === 'join-board') done(`refused: ${event.message}`); };
  const timer = setTimeout(() => done('timeout'), 4000);
  client.on('board-joined', onJoined);
  client.on('board-error', onError);
  client.emit('join-board', { boardId });
});

test('starting a guest session issues a 24-hour guest token and a guest board that expires in 24 hours', needsMongo, async () => {
  const before = Date.now();
  const res = await startGuest();
  assert.equal(res.status, 201);
  assert.ok(res.token, 'no session cookie was set');
  assert.match(res.setCookie, /HttpOnly/i);
  const claims = jwt.verify(res.token, TEST_SECRET);
  assert.equal(claims.role, 'guest');
  assert.match(claims.guestId, /^guest_[a-f0-9]{24}$/);
  assert.match(claims.name, /^Guest-\d{4}$/);
  assert.equal(claims.id, undefined);
  assert.equal(claims.exp - claims.iat, 24 * 60 * 60);
  const { board, user } = res.body.data;
  assert.equal(user.role, 'guest');
  assert.equal(user.id, claims.guestId);
  assert.equal(board.isGuest, true);
  assert.equal(board.ownerGuestId, claims.guestId);
  const stored = await Board.findById(board.id).lean();
  assert.ok(stored.expiresAt instanceof Date, 'expiresAt is not stored as a date');
  const dayMs = 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(stored.expiresAt.getTime() - (before + dayMs)) < 60 * 1000, `expiresAt ${stored.expiresAt.toISOString()} is not 24 hours after creation`);
  assert.equal(stored.isGuest, true);
  assert.equal(stored.owner ?? null, null);
});

test('the guest board indexes exist even though automatic index builds are off, and normal boards never expire', needsMongo, async () => {
  const indexes = await Board.collection.indexes();
  const ttl = indexes.find((index) => index.key?.expiresAt === 1);
  assert.ok(ttl, 'no index on expiresAt');
  assert.equal(ttl.expireAfterSeconds, 0);
  const single = indexes.find((index) => index.key?.ownerGuestId === 1);
  assert.ok(single?.unique, 'ownerGuestId is not unique');
  assert.deepEqual(single.partialFilterExpression, { isGuest: true });
  await ensureGuestBoardIndexes();
  const { user } = await makeUser('normalowner');
  const normal = await boardService.createBoard(user._id, { title: 'Normal' });
  const stored = await Board.findById(normal.id).lean();
  assert.equal(stored.expiresAt ?? null, null);
  assert.equal(stored.isGuest, false);
});

test('a guest can have only one active board, including under concurrent requests', needsMongo, async () => {
  const first = await startGuest();
  const again = await startGuest(first.token);
  assert.equal(again.status, 200);
  assert.equal(again.body.data.board.id, first.body.data.board.id);
  const burst = await Promise.all(Array.from({ length: 3 }, () => startGuest(first.token)));
  burst.forEach((res) => {
    assert.ok([200, 201].includes(res.status), `status ${res.status}`);
    assert.equal(res.body.data.board.id, first.body.data.board.id);
  });
  const { guestId } = jwt.verify(first.token, TEST_SECRET);
  assert.equal(await Board.countDocuments({ ownerGuestId: guestId }), 1);
});

test('concurrent first requests from a brand-new guest token still create one board', needsMongo, async () => {
  const token = generateAccessToken({ role: 'guest', guestId: `guest_${'a1'.repeat(12)}`, name: 'Guest-1111' }, '24h');
  const burst = await Promise.all(Array.from({ length: 5 }, () => startGuest(token)));
  const ids = new Set(burst.map((res) => res.body?.data?.board?.id));
  assert.equal(ids.size, 1, `statuses ${burst.map((res) => res.status).join(',')}`);
  assert.equal(await Board.countDocuments({ ownerGuestId: `guest_${'a1'.repeat(12)}` }), 1);
});

test('guest board creation is limited to 5 per hour from one address', needsMongo, async () => {
  for (let i = 0; i < 5; i += 1) assert.equal((await startGuest()).status, 201);
  const blocked = await startGuest();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.errors?.code, 'RATE_LIMITED');
});

test('a signed-in account cannot start a guest session and keeps its own session', needsMongo, async () => {
  const { token } = await makeUser('signedin');
  const res = await startGuest(token);
  assert.equal(res.status, 409);
  assert.equal(res.body.errors?.code, 'ALREADY_SIGNED_IN');
  assert.equal(res.token, null);
});

test('a guest reaches its own board and nothing else over the REST API', needsMongo, async () => {
  const mine = await startGuest();
  const other = await startGuest();
  const { user, token: ownerToken } = await makeUser('restowner');
  const normal = await boardService.createBoard(user._id, { title: 'Private' });
  const boardId = mine.body.data.board.id;
  assert.equal((await call('GET', `/boards/${boardId}`, { token: mine.token })).status, 200);
  const renamed = await call('PATCH', `/boards/${boardId}`, { token: mine.token, body: { title: 'Guest sketch' } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.board.title, 'Guest sketch');
  assert.equal((await call('GET', `/boards/${normal.id}`, { token: mine.token })).status, 403);
  assert.equal((await call('GET', `/boards/${other.body.data.board.id}`, { token: mine.token })).status, 403);
  assert.equal((await call('GET', `/boards/${boardId}`, { token: ownerToken })).status, 403);
  const me = await call('GET', '/auth/me', { token: mine.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.role, 'guest');
  const blocked = [
    ['GET', '/boards'],
    ['POST', '/boards', { title: 'x' }],
    ['DELETE', `/boards/${boardId}`],
    ['GET', `/boards/${boardId}/collaborators`],
    ['POST', `/boards/${boardId}/collaborators`, { email: 'a@example.com' }],
    ['POST', '/mess-cleanup/analyze', {}],
    ['POST', '/ai-assistant/generate', {}],
    ['POST', '/sidekick/chat', {}],
    ['POST', '/voice-commands/interpret', {}],
    ['POST', '/assets/images', {}],
    ['GET', '/assets/usage'],
    ['PATCH', '/auth/me/preferences', { theme: 'dark' }],
    ['GET', '/auth/me/landing']
  ];
  for (const [method, path, body] of blocked) {
    const res = await call(method, path, { token: mine.token, body });
    assert.equal(res.status, 403, `${method} ${path} returned ${res.status}`);
    assert.equal(res.body.errors?.code, 'GUEST_NOT_ALLOWED', `${method} ${path}`);
  }
});

test('a guest socket joins only its own guest board and can commit drawing operations to it', needsMongo, async () => {
  const mine = await startGuest();
  const other = await startGuest();
  const { user } = await makeUser('socketowner');
  const normal = await boardService.createBoard(user._id, { title: 'Private' });
  const boardId = mine.body.data.board.id;
  const socket = await connectWith(mine.token);
  assert.equal(await join(socket, boardId), 'joined');
  assert.match(await join(socket, normal.id), /^refused/);
  assert.match(await join(socket, other.body.data.board.id), /^refused/);
  const ack = await new Promise((resolve) => socket.emit('canvas:op', { boardId, opId: `op_guest_${Date.now()}`, baseRevision: 0, kind: 'edit', upserts: [{ id: 'shape_g', data: { id: 'shape_g', type: 'rect', left: 1, top: 1, width: 5, height: 5 }, unset: [] }], deletes: [] }, resolve));
  assert.equal(ack?.ok, true, JSON.stringify(ack));
  const stored = await Board.findById(boardId).lean();
  assert.ok(stored.canvasData.objects.some((object) => object.id === 'shape_g'));
});

test('an expired guest board is refused before the TTL sweep removes it', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  await Board.updateOne({ _id: boardId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const res = await call('GET', `/boards/${boardId}`, { token: mine.token });
  assert.equal(res.status, 404);
  const saved = await call('PATCH', `/boards/${boardId}`, { token: mine.token, body: { title: 'late' } });
  assert.equal(saved.status, 404);
  const socket = await connectWith(mine.token);
  assert.match(await join(socket, boardId), /^refused/);
});

test('a guest whose board has expired gets a fresh identity and a new board instead of the expired one', needsMongo, async () => {
  const first = await startGuest();
  await Board.updateOne({ _id: first.body.data.board.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const again = await startGuest(first.token);
  assert.equal(again.status, 201);
  assert.notEqual(again.body.data.board.id, first.body.data.board.id);
  assert.ok(again.token, 'no new guest session was issued');
  assert.notEqual(jwt.verify(again.token, TEST_SECRET).guestId, jwt.verify(first.token, TEST_SECRET).guestId);
  assert.equal((await call('GET', `/boards/${again.body.data.board.id}`, { token: again.token })).status, 200);
});

test('a forged or malformed guest token is rejected', needsMongo, async () => {
  const forged = jwt.sign({ role: 'guest', guestId: `guest_${'b2'.repeat(12)}`, name: 'Guest-2222' }, 'not-the-server-secret', { expiresIn: '24h' });
  assert.equal((await call('GET', '/auth/me', { token: forged })).status, 401);
  const malformed = generateAccessToken({ role: 'guest', guestId: '507f1f77bcf86cd799439011', name: 'Guest-3333' }, '24h');
  assert.equal((await call('GET', '/auth/me', { token: malformed })).status, 401);
  await assert.rejects(connectWith(malformed));
});

test('guest board creation is logged as a structured event without the token or address', needsMongo, async () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  let res;
  try {
    res = await startGuest();
  } finally {
    console.log = original;
  }
  const event = lines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((entry) => entry?.event === 'guest_board_created');
  assert.ok(event, 'no guest_board_created event was logged');
  assert.equal(event.boardId, res.body.data.board.id);
  assert.equal(event.guestId, jwt.verify(res.token, TEST_SECRET).guestId);
  const text = lines.join('\n');
  assert.ok(!text.includes(res.token), 'the token was logged');
  assert.ok(!/127\.0\.0\.1|::1|::ffff/.test(text.split('\n').filter((line) => line.includes('guest_board_created')).join('\n')), 'the address was logged');
});
