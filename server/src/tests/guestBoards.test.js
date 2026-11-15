import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
import { guestBoardAddressLimiter, guestJoinAddressLimiter, joinAttemptAddressLimiter, joinAttemptBoardLimiter } from '../middleware/rateLimit.middleware.js';
import Asset from '../models/Asset.js';
import { generateAccessToken } from '../utils/jwt.js';
import { COOKIE_NAME } from '../utils/cookieOptions.js';

const TEST_SECRET = 'skribe-test-only-jwt-secret-for-guest-board-tests-0001';
const TEST_DB_NAME = `skribe_guest_test_${process.pid}_${Date.now()}`;
const TEST_MONGO_BASE = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
config.jwtSecret = TEST_SECRET;
const originalCollabFlag = config.collabOperationsEnabled;
config.collabOperationsEnabled = true;
const originalGroqKey = config.groqMessCleanupApiKey;
config.groqMessCleanupApiKey = 'test-only-groq-key';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const realFetch = globalThis.fetch;
const groq = { calls: 0, reply: null };
globalThis.fetch = async (url, init) => {
  if (String(url) !== GROQ_URL) return realFetch(url, init);
  groq.calls += 1;
  return groq.reply();
};

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
  config.groqMessCleanupApiKey = originalGroqKey;
  globalThis.fetch = realFetch;
  clients.forEach((client) => client.disconnect());
  io.close();
  await new Promise((resolve) => httpServer.close(resolve));
  if (mongoAvailable && mongoose.connection.name === TEST_DB_NAME) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const resetJoinAttempts = () => { joinAttemptAddressLimiter.reset(); joinAttemptBoardLimiter.reset(); };
test.beforeEach(() => { guestBoardAddressLimiter.reset(); guestJoinAddressLimiter.reset(); resetJoinAttempts(); });

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

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const createLink = (boardId, token) => call('POST', `/boards/${boardId}/share-link`, { token });
const joinBoard = (boardId, secret, token) => call('POST', `/boards/${boardId}/join`, { token, body: { secret } });
const workspace = { version: 1, board: { objects: [{ id: 't1', type: 'text', text: 'Notes', position: { x: 1, y: 1 }, size: { width: 10, height: 10 } }] } };
const screenshot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const plan = { version: 1, workspaceType: 'notes', hierarchy: [{ type: 'document_root', titleObjectId: 't1', sections: ['section_1'] }], sections: [{ id: 'section_1', type: 'notes', titleObjectId: 't1', purpose: 'Notes', layoutHint: 'grid', objectIds: ['t1'] }], relationships: [] };
const groqOk = () => new Response(JSON.stringify({ model: 'test', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(plan) }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const groqDown = () => new Response(JSON.stringify({ error: { message: 'upstream down' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
const cleanup = (boardId, token) => call('POST', '/mess-cleanup/analyze', { token, body: { workspaceModel: workspace, image: screenshot, ...(boardId ? { boardId } : {}) } });
const captureLogs = async (fn) => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
};
const objectsOf = (count, prefix = 'o') => Array.from({ length: count }, (_, index) => ({ id: `${prefix}_${index}`, type: 'rect', left: index, top: 1, width: 5, height: 5 }));

test('the guest owner creates a share link whose secret is returned once and stored only as a hash', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const res = await createLink(boardId, mine.token);
  assert.equal(res.status, 200);
  const { secret } = res.body.data;
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
  const stored = await Board.findById(boardId).select('+shareLinkHash').lean();
  assert.equal(stored.shareLinkHash, sha256(secret));
  assert.ok(!JSON.stringify(stored).includes(secret), 'the raw secret was stored');
  const fetched = await call('GET', `/boards/${boardId}`, { token: mine.token });
  assert.ok(!('shareLinkHash' in fetched.body.data.board), 'the hash was sent to the client');
  assert.equal(fetched.body.data.board.hasShareLink, true);
  assert.ok(!JSON.stringify(fetched.body).includes(sha256(secret)));
});

test('anyone with the link joins and draws: a visitor without a session becomes a guest, a signed-in user becomes a member', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const { secret } = (await createLink(boardId, mine.token)).body.data;
  const visitor = await joinBoard(boardId, secret);
  assert.equal(visitor.status, 200);
  assert.ok(visitor.token, 'the visitor got no guest session');
  const visitorClaims = jwt.verify(visitor.token, TEST_SECRET);
  assert.equal(visitorClaims.role, 'guest');
  assert.notEqual(visitorClaims.guestId, jwt.verify(mine.token, TEST_SECRET).guestId);
  assert.equal(visitor.body.data.board.id, boardId);
  assert.equal((await call('GET', `/boards/${boardId}`, { token: visitor.token })).status, 200);
  assert.equal(await Board.countDocuments({ ownerGuestId: visitorClaims.guestId }), 0);
  const visitorSocket = await connectWith(visitor.token);
  assert.equal(await join(visitorSocket, boardId), 'joined');
  const ack = await new Promise((resolve) => visitorSocket.emit('canvas:op', { boardId, opId: `op_visitor_${Date.now()}`, baseRevision: 0, kind: 'edit', upserts: [{ id: 'shape_v', data: { id: 'shape_v', type: 'rect', left: 1, top: 1, width: 5, height: 5 }, unset: [] }], deletes: [] }, resolve));
  assert.equal(ack?.ok, true, JSON.stringify(ack));
  const { user, token: userToken } = await makeUser('linkjoiner');
  const member = await joinBoard(boardId, secret, userToken);
  assert.equal(member.status, 200);
  assert.equal(member.token, null, 'a signed-in user had their session replaced');
  const stored = await Board.findById(boardId).lean();
  assert.ok(stored.members.some((id) => String(id) === String(user._id)));
  assert.ok(stored.guestMembers.includes(visitorClaims.guestId));
  assert.equal((await call('GET', `/boards/${boardId}`, { token: userToken })).status, 200);
  const again = await joinBoard(boardId, secret, visitor.token);
  assert.equal(again.status, 200);
  assert.equal((await Board.findById(boardId).lean()).guestMembers.filter((id) => id === visitorClaims.guestId).length, 1);
});

test('a wrong secret, a board without a link and normal boards are all refused', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const before = await joinBoard(boardId, 'x'.repeat(43));
  assert.equal(before.status, 403);
  assert.equal(before.body.errors?.code, 'INVALID_SHARE_LINK');
  assert.equal(before.token, null, 'a refused visitor still got a guest session');
  await createLink(boardId, mine.token);
  const wrong = await joinBoard(boardId, 'y'.repeat(43));
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.errors?.code, 'INVALID_SHARE_LINK');
  assert.equal((await joinBoard(boardId, 123)).status, 403);
  const { user, token } = await makeUser('normallink');
  const normal = await boardService.createBoard(user._id, { title: 'Normal' });
  const refused = await createLink(normal.id, token);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.errors?.code, 'SHARE_LINKS_UNAVAILABLE');
  assert.equal((await joinBoard(normal.id, 'z'.repeat(43))).status, 403);
});

test('revoking rotates the secret: the old link stops admitting people, the new one works, and only the owner can rotate', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const first = (await createLink(boardId, mine.token)).body.data.secret;
  const early = await joinBoard(boardId, first);
  assert.equal(early.status, 200);
  assert.equal((await createLink(boardId, early.token)).status, 403);
  const second = (await createLink(boardId, mine.token)).body.data.secret;
  assert.notEqual(second, first);
  const stale = await joinBoard(boardId, first);
  assert.equal(stale.status, 403);
  assert.equal(stale.body.errors?.code, 'INVALID_SHARE_LINK');
  assert.equal((await joinBoard(boardId, second)).status, 200);
  assert.equal((await call('GET', `/boards/${boardId}`, { token: early.token })).status, 200);
});

test('an expired guest board refuses both joining and rotating its link', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const { secret } = (await createLink(boardId, mine.token)).body.data;
  await Board.updateOne({ _id: boardId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const late = await joinBoard(boardId, secret);
  assert.equal(late.status, 404);
  assert.equal(late.token, null);
  assert.equal((await createLink(boardId, mine.token)).status, 404);
});

test('visitors who join through links are rate limited when they need a new guest session', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const { secret } = (await createLink(boardId, mine.token)).body.data;
  for (let i = 0; i < 20; i += 1) assert.equal((await joinBoard(boardId, secret)).status, 200, `join ${i + 1}`);
  resetJoinAttempts();
  const blocked = await joinBoard(boardId, secret);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.token, null);
  assert.equal((await joinBoard(boardId, secret, mine.token)).status, 200);
});

test('join attempts are limited to 20 per 10 minutes from one address, even with the right secret afterwards', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const { secret } = (await createLink(boardId, mine.token)).body.data;
  for (let i = 0; i < 20; i += 1) assert.equal((await joinBoard(boardId, 'q'.repeat(43))).status, 403, `attempt ${i + 1}`);
  const blocked = await joinBoard(boardId, secret);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.errors?.code, 'RATE_LIMITED');
  assert.equal(blocked.token, null);
  const other = await startGuest();
  assert.equal((await joinBoard(other.body.data.board.id, secret)).status, 429, 'the address limit is per address, across boards');
});

test('join attempts on one board are limited to 60 per 10 minutes across addresses, without affecting other boards', () => {
  const res = () => ({ statusCode: 200, body: null, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const attempt = (board, ip) => { let passed = false; const r = res(); joinAttemptBoardLimiter({ ip, params: { id: board } }, r, () => { passed = true; }); return passed ? 'passed' : r.statusCode; };
  for (let i = 0; i < 60; i += 1) assert.equal(attempt('board_a', `10.0.0.${i}`), 'passed', `attempt ${i + 1}`);
  assert.equal(attempt('board_a', '10.0.1.1'), 429);
  assert.equal(attempt('board_b', '10.0.1.1'), 'passed');
});

test('joining a guest board through its link is logged as guest_invited_someone', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const { secret } = (await createLink(boardId, mine.token)).body.data;
  const events = await captureLogs(() => joinBoard(boardId, secret));
  const event = events.find((entry) => entry.event === 'guest_invited_someone');
  assert.ok(event, 'no guest_invited_someone event');
  assert.equal(event.boardId, boardId);
  assert.equal(event.ownerGuestId, jwt.verify(mine.token, TEST_SECRET).guestId);
  assert.equal(event.joinedAs, 'guest');
  assert.ok(!JSON.stringify(event).includes(secret), 'the secret was logged');
});

test('Mess Cleanup allows 3 uses per guest board, enforced on the server', needsMongo, async () => {
  groq.reply = groqOk;
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  let events = [];
  for (let i = 1; i <= 3; i += 1) {
    let res;
    events = events.concat(await captureLogs(async () => { res = await cleanup(boardId, mine.token); }));
    assert.equal(res.status, 200, `use ${i}: ${JSON.stringify(res.body)}`);
  }
  const callsBefore = groq.calls;
  const fourth = await cleanup(boardId, mine.token);
  assert.equal(fourth.status, 403);
  assert.equal(fourth.body.errors?.code, 'GUEST_CLEANUP_LIMIT');
  assert.equal(fourth.body.message, 'Sign up free to keep using Mess Cleanup.');
  assert.equal(groq.calls, callsBefore, 'the AI was called after the limit');
  assert.equal((await Board.findById(boardId).lean()).cleanupUses, 3);
  const used = events.filter((entry) => entry.event === 'guest_used_cleanup');
  assert.deepEqual(used.map((entry) => entry.uses), [1, 2, 3]);
  assert.ok(used.every((entry) => entry.boardId === boardId));
});

test('concurrent Mess Cleanup requests on a guest board never exceed 3 uses', needsMongo, async () => {
  groq.reply = groqOk;
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const results = await Promise.all(Array.from({ length: 6 }, () => cleanup(boardId, mine.token)));
  assert.equal(results.filter((res) => res.status === 200).length, 3, results.map((res) => res.status).join(','));
  assert.equal(results.filter((res) => res.body?.errors?.code === 'GUEST_CLEANUP_LIMIT').length, 3);
  assert.equal((await Board.findById(boardId).lean()).cleanupUses, 3);
});

test('a failed Mess Cleanup call gives the use back, and guests must name a board they can use', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  groq.reply = groqDown;
  const failed = await cleanup(boardId, mine.token);
  assert.ok(failed.status >= 500, `status ${failed.status}`);
  assert.equal((await Board.findById(boardId).lean()).cleanupUses, 0);
  groq.reply = groqOk;
  const missing = await cleanup(null, mine.token);
  assert.equal(missing.status, 400);
  assert.equal(missing.body.errors?.code, 'BOARD_REQUIRED');
  const other = await startGuest();
  assert.equal((await cleanup(other.body.data.board.id, mine.token)).status, 403);
  assert.equal((await Board.findById(other.body.data.board.id).lean()).cleanupUses, 0);
  const invalid = await call('POST', '/mess-cleanup/analyze', { token: mine.token, body: { boardId, workspaceModel: {}, image: screenshot } });
  assert.equal(invalid.status, 400);
  assert.equal((await Board.findById(boardId).lean()).cleanupUses, 0, 'an invalid request used up a cleanup');
});

test('registered collaborators on a guest board share its cleanup limit, and normal boards are unlimited', needsMongo, async () => {
  groq.reply = groqOk;
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const { secret } = (await createLink(boardId, mine.token)).body.data;
  const { user, token } = await makeUser('cleanupmember');
  await joinBoard(boardId, secret, token);
  await Board.updateOne({ _id: boardId }, { $set: { cleanupUses: 3 } });
  const blocked = await cleanup(boardId, token);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.errors?.code, 'GUEST_CLEANUP_LIMIT');
  const normal = await boardService.createBoard(user._id, { title: 'Normal' });
  for (let i = 0; i < 4; i += 1) assert.equal((await cleanup(normal.id, token)).status, 200);
  assert.equal((await cleanup(null, token)).status, 200);
});

test('a guest board holds at most 500 objects over both sockets and saves, while normal boards are not capped', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  await Board.updateOne({ _id: boardId }, { $set: { 'canvasData.objects': objectsOf(499) } });
  const socket = await connectWith(mine.token);
  assert.equal(await join(socket, boardId), 'joined');
  const op = (id, revision) => ({ boardId, opId: `op_cap_${id}_${Date.now()}`, baseRevision: revision, kind: 'edit', upserts: [{ id, data: { id, type: 'rect', left: 1, top: 1, width: 5, height: 5 }, unset: [] }], deletes: [] });
  const fills = await new Promise((resolve) => socket.emit('canvas:op', op('cap_500', 0), resolve));
  assert.equal(fills?.ok, true, JSON.stringify(fills));
  const over = await new Promise((resolve) => socket.emit('canvas:op', op('cap_501', 1), resolve));
  assert.equal(over?.ok, false);
  assert.equal(over?.code, 'GUEST_OBJECT_LIMIT');
  assert.equal((await Board.findById(boardId).lean()).canvasData.objects.length, 500);
  const edit = await new Promise((resolve) => socket.emit('canvas:op', op('o_0', 1), resolve));
  assert.equal(edit?.ok, true, 'editing an existing object at the cap was refused');
  const save = await call('PATCH', `/boards/${boardId}`, { token: mine.token, body: { canvasData: { version: '6.5.1', objects: objectsOf(501) }, baseRevision: 2 } });
  assert.equal(save.status, 403);
  assert.equal(save.body.errors?.code, 'GUEST_OBJECT_LIMIT');
  const { user, token } = await makeUser('bignormal');
  const normal = await boardService.createBoard(user._id, { title: 'Big' });
  const bigSave = await call('PATCH', `/boards/${normal.id}`, { token, body: { canvasData: { version: '6.5.1', objects: objectsOf(600) }, baseRevision: 0 } });
  assert.equal(bigSave.status, 200, JSON.stringify(bigSave.body));
});

test('images cannot be uploaded to a guest board, even by a registered collaborator', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const { secret } = (await createLink(boardId, mine.token)).body.data;
  const { token } = await makeUser('uploader');
  await joinBoard(boardId, secret, token);
  const png = Buffer.from(screenshot.split(',')[1], 'base64');
  const res = await realFetch(`${base}/api/v1/assets/images?boardId=${boardId}`, { method: 'POST', headers: { cookie: `${COOKIE_NAME}=${token}`, 'Content-Type': 'image/png', 'x-file-name': 'a.png' }, body: png });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.errors?.code, 'GUEST_UPLOADS_DISABLED');
});

const imageObject = (extra = {}) => ({ id: 'img_1', type: 'image', left: 1, top: 1, width: 10, height: 10, src: 'https://ik.imagekit.io/skribe/a.png', ...extra });

test('a guest board refuses image content over sockets and saves, including images copied from another board', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const socket = await connectWith(mine.token);
  assert.equal(await join(socket, boardId), 'joined');
  const send = (data, revision = 0) => new Promise((resolve) => socket.emit('canvas:op', { boardId, opId: `op_img_${Math.random().toString(16).slice(2)}`, baseRevision: revision, kind: 'edit', upserts: [{ id: data.id, data, unset: [] }], deletes: [] }, resolve));
  for (const data of [imageObject(), imageObject({ type: 'Image' }), imageObject({ src: undefined, assetId: 'asset_123' }), { id: 'grp', type: 'group', objects: [imageObject()] }, { id: 'rect_src', type: 'rect', src: 'data:image/png;base64,AAAA' }]) {
    const ack = await send(data);
    assert.equal(ack?.ok, false, JSON.stringify(data));
    assert.equal(ack?.code, 'GUEST_IMAGES_DISABLED', JSON.stringify(data));
  }
  assert.equal((await send({ id: 'plain', type: 'rect', left: 1, top: 1, width: 5, height: 5 }))?.ok, true);
  const save = await call('PATCH', `/boards/${boardId}`, { token: mine.token, body: { canvasData: { version: '6.5.1', objects: [imageObject()] }, baseRevision: 1 } });
  assert.equal(save.status, 403);
  assert.equal(save.body.errors?.code, 'GUEST_IMAGES_DISABLED');
  const stored = await Board.findById(boardId).lean();
  assert.ok(!stored.canvasData.objects.some((object) => object.type === 'image'));
});

test('an image asset from another board is never attached to a guest board', needsMongo, async () => {
  const { user, token } = await makeUser('assetowner');
  const source = await boardService.createBoard(user._id, { title: 'Source' });
  const assetId = `asset_${Date.now()}`;
  const url = `https://ik.imagekit.io/skribe/${assetId}.png`;
  await Asset.collection.insertOne({ assetId, url, owner: user._id, board: new mongoose.Types.ObjectId(source.id), boards: [new mongoose.Types.ObjectId(source.id)], status: 'attached', createdAt: new Date(), updatedAt: new Date() });
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const { secret } = (await createLink(boardId, mine.token)).body.data;
  await joinBoard(boardId, secret, token);
  const pasted = await call('PATCH', `/boards/${boardId}`, { token, body: { canvasData: { version: '6.5.1', objects: [imageObject({ src: url, assetId })] }, baseRevision: 0 } });
  assert.equal(pasted.status, 403);
  assert.equal(pasted.body.errors?.code, 'GUEST_IMAGES_DISABLED');
  const memberSocket = await connectWith(token);
  assert.equal(await join(memberSocket, boardId), 'joined');
  const ack = await new Promise((resolve) => memberSocket.emit('canvas:op', { boardId, opId: `op_paste_${Date.now()}`, baseRevision: 0, kind: 'edit', upserts: [{ id: 'img_paste', data: imageObject({ id: 'img_paste', src: url, assetId }), unset: [] }], deletes: [] }, resolve));
  assert.equal(ack?.code, 'GUEST_IMAGES_DISABLED');
  const asset = await Asset.collection.findOne({ assetId });
  assert.ok(!(asset.boards || []).some((id) => String(id) === boardId), 'the asset was attached to the guest board');
  assert.notEqual(String(asset.board), boardId);
});

const register = (label, token) => call('POST', '/auth/register', { token, body: { name: label, email: `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.com`, password: 'Verify12345!' } });
const nextEventOf = (client, event, ms = 4000) => new Promise((resolve) => {
  const timer = setTimeout(() => { client.off(event, handler); resolve(null); }, ms);
  const handler = (payload) => { clearTimeout(timer); client.off(event, handler); resolve(payload); };
  client.on(event, handler);
});
const opFor = (boardId, id, revision) => ({ boardId, opId: `op_${id}_${Math.random().toString(16).slice(2)}`, baseRevision: revision, kind: 'edit', upserts: [{ id, data: { id, type: 'rect', left: 1, top: 1, width: 5, height: 5 }, unset: [] }], deletes: [] });
const emitOp = (socket, op) => new Promise((resolve) => socket.emit('canvas:op', op, resolve));

test('signing up from a guest board transfers it to the new account and keeps its content, link and members', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const guestId = jwt.verify(mine.token, TEST_SECRET).guestId;
  await Board.updateOne({ _id: boardId }, { $set: { 'canvasData.objects': objectsOf(3, 'keep'), cleanupUses: 2 } });
  const { secret } = (await createLink(boardId, mine.token)).body.data;
  const visitor = await joinBoard(boardId, secret);
  const { user: memberUser, token: memberToken } = await makeUser('keepmember');
  await joinBoard(boardId, secret, memberToken);
  const hashBefore = (await Board.findById(boardId).select('+shareLinkHash').lean()).shareLinkHash;
  let res;
  const events = await captureLogs(async () => { res = await register('converter', mine.token); });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.token, 'no account session was issued');
  const account = jwt.verify(res.token, TEST_SECRET);
  assert.ok(account.id, 'the new session is not an account session');
  assert.deepEqual(res.body.data.claimedBoardIds, [boardId]);
  const stored = await Board.findById(boardId).select('+shareLinkHash').lean();
  assert.equal(String(stored.owner), String(account.id));
  assert.equal(stored.isGuest, false);
  assert.equal(stored.expiresAt, undefined);
  assert.equal(stored.ownerGuestId, undefined);
  assert.equal(stored.shareLinkHash, hashBefore);
  assert.deepEqual(stored.canvasData.objects.map((object) => object.id), ['keep_0', 'keep_1', 'keep_2']);
  assert.ok(stored.members.some((id) => String(id) === String(memberUser._id)));
  assert.ok(stored.guestMembers.includes(jwt.verify(visitor.token, TEST_SECRET).guestId));
  assert.equal((await call('GET', `/boards/${boardId}`, { token: res.token })).status, 200);
  assert.ok((await call('GET', '/boards', { token: res.token })).body.data.boards.some((board) => board.id === boardId));
  const event = events.find((entry) => entry.event === 'guest_converted_to_account');
  assert.ok(event, 'no guest_converted_to_account event');
  assert.equal(event.guestId, guestId);
  assert.equal(event.userId, String(account.id));
  assert.deepEqual(event.ownedBoards, [boardId]);
  assert.equal(event.via, 'register');
  const indexes = await Board.collection.indexes();
  assert.ok(indexes.some((index) => index.name === 'guest_board_expiry'), 'the TTL index is gone');
});

test('logging in to an existing account from a guest board transfers the board the same way', needsMongo, async () => {
  const email = `existing.${Date.now()}@example.com`;
  const created = await call('POST', '/auth/register', { body: { name: 'Existing', email, password: 'Verify12345!' } });
  const accountId = jwt.verify(created.token, TEST_SECRET).id;
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const res = await call('POST', '/auth/login', { token: mine.token, body: { email, password: 'Verify12345!' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.claimedBoardIds, [boardId]);
  const stored = await Board.findById(boardId).lean();
  assert.equal(String(stored.owner), String(accountId));
  assert.equal(stored.isGuest, false);
  assert.equal(stored.expiresAt, undefined);
});

test('converting mid-session keeps collaborators drawing, notifies them, and keeps the link working', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  const { secret } = (await createLink(boardId, mine.token)).body.data;
  const { token: memberToken } = await makeUser('midmember');
  await joinBoard(boardId, secret, memberToken);
  const guestVisitor = await joinBoard(boardId, secret);
  const memberSocket = await connectWith(memberToken);
  const guestSocket = await connectWith(guestVisitor.token);
  assert.equal(await join(memberSocket, boardId), 'joined');
  assert.equal(await join(guestSocket, boardId), 'joined');
  assert.equal((await emitOp(memberSocket, opFor(boardId, 'before_1', 0)))?.ok, true);
  const memberNotice = nextEventOf(memberSocket, 'board:converted');
  const guestNotice = nextEventOf(guestSocket, 'board:converted');
  const converted = await register('midowner', mine.token);
  assert.equal(converted.status, 201);
  assert.deepEqual(await memberNotice, { boardId });
  assert.deepEqual(await guestNotice, { boardId });
  assert.equal((await emitOp(memberSocket, opFor(boardId, 'after_member', 1)))?.ok, true, 'the registered member was locked out');
  assert.equal((await emitOp(guestSocket, opFor(boardId, 'after_guest', 2)))?.ok, true, 'the guest member was locked out');
  assert.equal((await call('GET', `/boards/${boardId}`, { token: memberToken })).status, 200);
  assert.equal((await call('GET', `/boards/${boardId}`, { token: guestVisitor.token })).status, 200);
  const latecomer = await joinBoard(boardId, secret);
  assert.equal(latecomer.status, 200, 'the share link stopped working after conversion');
  const ownerSocket = await connectWith(converted.token);
  assert.equal(await join(ownerSocket, boardId), 'joined');
  assert.equal((await emitOp(ownerSocket, opFor(boardId, 'after_owner', 3)))?.ok, true);
  const rotated = await createLink(boardId, converted.token);
  assert.equal(rotated.status, 200);
  assert.equal((await joinBoard(boardId, secret)).status, 403, 'the old secret still works after the new owner rotated it');
  const stored = await Board.findById(boardId).lean();
  assert.deepEqual(stored.canvasData.objects.map((object) => object.id), ['before_1', 'after_member', 'after_guest', 'after_owner']);
});

test('a guest who joined someone else\'s board keeps access after signing up', needsMongo, async () => {
  const owner = await startGuest();
  const boardId = owner.body.data.board.id;
  const { secret } = (await createLink(boardId, owner.token)).body.data;
  const visitor = await joinBoard(boardId, secret);
  const visitorGuestId = jwt.verify(visitor.token, TEST_SECRET).guestId;
  const res = await register('visitorconverts', visitor.token);
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.data.claimedBoardIds, []);
  const accountId = jwt.verify(res.token, TEST_SECRET).id;
  const stored = await Board.findById(boardId).lean();
  assert.ok(stored.members.some((id) => String(id) === String(accountId)));
  assert.ok(!stored.guestMembers.includes(visitorGuestId));
  assert.equal(stored.isGuest, true, 'the owner\'s guest board was converted by someone else');
  assert.equal(stored.ownerGuestId, jwt.verify(owner.token, TEST_SECRET).guestId);
  assert.equal((await call('GET', `/boards/${boardId}`, { token: res.token })).status, 200);
});

test('expired boards, forged guest tokens and plain sign-ups claim nothing', needsMongo, async () => {
  const mine = await startGuest();
  const boardId = mine.body.data.board.id;
  await Board.updateOne({ _id: boardId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const late = await register('lateconverter', mine.token);
  assert.equal(late.status, 201);
  assert.deepEqual(late.body.data.claimedBoardIds, []);
  const stored = await Board.findById(boardId).lean();
  assert.equal(stored.isGuest, true);
  assert.equal(stored.owner ?? null, null);
  const other = await startGuest();
  const otherId = other.body.data.board.id;
  const forged = jwt.sign({ role: 'guest', guestId: jwt.verify(other.token, TEST_SECRET).guestId, name: 'Guest-9999' }, 'not-the-server-secret', { expiresIn: '24h' });
  const forgedRes = await register('forger', forged);
  assert.equal(forgedRes.status, 201);
  assert.deepEqual(forgedRes.body.data.claimedBoardIds, []);
  assert.equal((await Board.findById(otherId).lean()).isGuest, true, 'a forged guest token claimed a board');
  const plain = await register('plainuser');
  assert.equal(plain.status, 201);
  assert.deepEqual(plain.body.data.claimedBoardIds, []);
});
